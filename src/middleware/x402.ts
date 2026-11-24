import type { MiddlewareHandler } from "hono";
import type { Network } from "@x402/core/types";
import type { RoutesConfig, x402ResourceServer } from "@x402/core/server";
import { CATALOG, SERVICE_NAME } from "../config/catalog";
import type { AppBindings } from "../types";

interface MemoizedX402Instance {
  resourceServer: x402ResourceServer;
  middleware: MiddlewareHandler;
  initialized: boolean;
  initPromise: Promise<void> | null;
}

const isolateInstances = new Map<string, MemoizedX402Instance>();
const isolateCreationPromises = new Map<string, Promise<MemoizedX402Instance>>();

async function buildX402Instance(
  network: Network,
  payTo: string,
  cdpApiKeyId: string | undefined,
  cdpApiKeySecret: string | undefined
): Promise<MemoizedX402Instance> {
  // Dynamic imports keep free/discovery/dashboard routes near 0ms cold-start CPU
  const [
    { paymentMiddleware },
    { HTTPFacilitatorClient, x402ResourceServer },
    { ExactEvmScheme },
    { declareDiscoveryExtension, bazaarResourceServerExtension },
    { createFacilitatorConfig },
  ] = await Promise.all([
    import("@x402/hono"),
    import("@x402/core/server"),
    import("@x402/evm/exact/server"),
    import("@x402/extensions/bazaar"),
    import("@coinbase/x402"),
  ]);

  const facilitatorConfig = createFacilitatorConfig(cdpApiKeyId, cdpApiKeySecret);
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);

  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  const routes: RoutesConfig = {};
  for (const entry of CATALOG) {
    routes[entry.routeKey] = {
      accepts: {
        scheme: "exact",
        price: entry.priceFormatted,
        network,
        payTo,
      },
      description: entry.description,
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
      tags: [...entry.tags],
      extensions: {
        ...declareDiscoveryExtension({
          input: entry.exampleQueryParams,
          inputSchema: entry.inputSchema,
          output: {
            example: entry.outputExample,
            schema: entry.outputSchema,
          },
        }),
      },
    };
  }

  // Explicitly pass syncFacilitatorOnStart = false (5th arg) and manage initialize() safely below
  const middleware = paymentMiddleware(routes, resourceServer, undefined, undefined, false);

  return {
    resourceServer,
    middleware,
    initialized: false,
    initPromise: null,
  };
}

async function getOrCreateInstance(
  network: Network,
  payTo: string,
  cdpApiKeyId: string | undefined,
  cdpApiKeySecret: string | undefined
): Promise<MemoizedX402Instance> {
  const cacheKey = `${network}:${payTo}`;
  const existing = isolateInstances.get(cacheKey);
  if (existing) {
    return existing;
  }

  let creating = isolateCreationPromises.get(cacheKey);
  if (!creating) {
    creating = buildX402Instance(network, payTo, cdpApiKeyId, cdpApiKeySecret)
      .then((instance) => {
        isolateInstances.set(cacheKey, instance);
        isolateCreationPromises.delete(cacheKey);
        return instance;
      })
      .catch((err) => {
        isolateCreationPromises.delete(cacheKey);
        throw err;
      });
    isolateCreationPromises.set(cacheKey, creating);
  }

  return creating;
}

async function ensureInitialized(instance: MemoizedX402Instance): Promise<void> {
  if (instance.initialized) {
    return;
  }
  if (!instance.initPromise) {
    instance.initPromise = instance.resourceServer
      .initialize()
      .then(() => {
        instance.initialized = true;
      })
      .catch((err) => {
        // Reset in-flight promise on rejection so transient network failures never poison the isolate
        instance.initPromise = null;
        throw err;
      });
  }
  await instance.initPromise;
}

/**
 * Lazy per-isolate x402 V2 paywall middleware mounted strictly on /v1/*.
 */
export const x402PaywallMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const network = c.env.X402_NETWORK as Network;
  const payTo = c.env.X402_PAY_TO?.trim();

  if (!network || !payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo) || /^0x0{40}$/i.test(payTo)) {
    c.set("upstream_error", "X402_MISCONFIGURED");
    return c.json(
      {
        error: "SERVER_MISCONFIGURED",
        message: "X402_NETWORK and a non-zero EVM X402_PAY_TO address must be configured.",
      },
      500
    );
  }

  try {
    const instance = await getOrCreateInstance(
      network,
      payTo,
      c.env.CDP_API_KEY_ID,
      c.env.CDP_API_KEY_SECRET
    );
    await ensureInitialized(instance);
    return await instance.middleware(c, next);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Facilitator initialization failed";
    console.error("x402 facilitator error:", detail);
    c.set("upstream_error", "FACILITATOR_INIT_ERROR");
    return c.json(
      {
        error: "FACILITATOR_UNAVAILABLE",
        message: "x402 facilitator temporarily unavailable. No payment was charged.",
      },
      502
    );
  }
};
