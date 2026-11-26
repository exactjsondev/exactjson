import type { MiddlewareHandler } from "hono";
import type { Network, PaymentRequired } from "@x402/core/types";
import type { PaywallProvider, RoutesConfig, x402ResourceServer } from "@x402/core/server";
import { CATALOG, SERVICE_NAME, getEndpointByPath, toHttpInputSchema } from "../config/catalog";
import { applyHtmlSecurityHeaders } from "../lib/securityHeaders";
import { renderPaywallHtml } from "../routes/landingHtml";
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
  baseUrl: string,
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
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: {
          error: "Payment required",
          protocol: "x402-v2",
          endpoint: entry.path,
          price_usd: entry.priceAmount,
          network,
          asset: "USDC",
          pay_only_on_success: true,
          how_to_pay:
            "Inspect the base64 PAYMENT-REQUIRED header (curl -i) and retry with PAYMENT-SIGNATURE via @x402/fetch, or connect via MCP: npx -y exactjson-mcp",
          docs: `${baseUrl}/#quickstart`,
          openapi: `${baseUrl}/openapi.json`,
        },
      }),
      extensions: {
        ...declareDiscoveryExtension({
          input: entry.exampleQueryParams,
          inputSchema: toHttpInputSchema(entry.inputSchema),
          output: {
            example: entry.outputExample,
            schema: entry.outputSchema,
          },
        }),
      },
    };
  }

  const paywallProvider: PaywallProvider = {
    generateHtml(paymentRequired: PaymentRequired): string {
      const requestedUrl = paymentRequired.resource?.url || baseUrl;
      let pathname = "/";
      try {
        pathname = new URL(requestedUrl).pathname;
      } catch {
        pathname = "/";
      }
      const matched = getEndpointByPath(pathname) ?? CATALOG[0]!;
      return renderPaywallHtml(matched, baseUrl, network, requestedUrl);
    },
  };

  // Explicitly pass syncFacilitatorOnStart = false (5th arg) and manage initialize() safely below
  const middleware = paymentMiddleware(routes, resourceServer, undefined, paywallProvider, false);

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
  baseUrl: string,
  cdpApiKeyId: string | undefined,
  cdpApiKeySecret: string | undefined
): Promise<MemoizedX402Instance> {
  const cacheKey = `${network}:${payTo}:${baseUrl}`;
  const existing = isolateInstances.get(cacheKey);
  if (existing) {
    return existing;
  }

  let creating = isolateCreationPromises.get(cacheKey);
  if (!creating) {
    creating = buildX402Instance(network, payTo, baseUrl, cdpApiKeyId, cdpApiKeySecret)
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

const FACILITATOR_RETRY_DELAY_MS = 150;

export function classifyFacilitatorInitError(err: unknown): string {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  const names: string[] = [];
  const statuses: number[] = [];

  let current: unknown = err;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth++) {
    if (seen.has(current)) break;
    seen.add(current);

    if (current instanceof Error) {
      names.push(current.name);
      messages.push(current.message);
    } else if (typeof current === "string") {
      messages.push(current);
    }

    if (typeof current === "object") {
      const obj = current as { status?: unknown; statusCode?: unknown; cause?: unknown };
      if (typeof obj.status === "number") statuses.push(obj.status);
      if (typeof obj.statusCode === "number") statuses.push(obj.statusCode);
      current = obj.cause;
    } else {
      break;
    }
  }

  const combinedMsg = messages.join(" ");
  if (
    names.includes("AbortError") ||
    /timeout|timed out|abort/i.test(combinedMsg)
  ) {
    return "FACILITATOR_INIT_TIMEOUT";
  }
  if (statuses.includes(401) || /\b401\b|unauthorized/i.test(combinedMsg)) {
    return "FACILITATOR_INIT_401";
  }
  if (statuses.includes(403) || /\b403\b|forbidden/i.test(combinedMsg)) {
    return "FACILITATOR_INIT_403";
  }
  if (statuses.includes(429) || /\b429\b|rate limit|too many requests/i.test(combinedMsg)) {
    return "FACILITATOR_INIT_429";
  }
  if (
    statuses.some((s) => s >= 500 && s <= 599) ||
    /\b5\d{2}\b/.test(combinedMsg)
  ) {
    return "FACILITATOR_INIT_5XX";
  }
  return "FACILITATOR_INIT_ERROR";
}

async function initializeWithRetry(resourceServer: x402ResourceServer): Promise<void> {
  try {
    await resourceServer.initialize();
  } catch (firstErr) {
    const kind = classifyFacilitatorInitError(firstErr);
    if (kind === "FACILITATOR_INIT_401" || kind === "FACILITATOR_INIT_403") {
      throw firstErr;
    }
    await new Promise((resolve) => setTimeout(resolve, FACILITATOR_RETRY_DELAY_MS));
    await resourceServer.initialize();
  }
}

async function ensureInitialized(instance: MemoizedX402Instance): Promise<void> {
  if (instance.initialized) {
    return;
  }
  if (!instance.initPromise) {
    instance.initPromise = initializeWithRetry(instance.resourceServer)
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
  // Never import @x402/* or contact facilitator for unmatched /v1/* paths or unsupported methods
  const endpoint = c.get("matched_endpoint") ?? getEndpointByPath(c.req.path);
  const methodMatches =
    endpoint !== undefined &&
    (c.req.method === endpoint.method ||
      (endpoint.method === "GET" && c.req.method === "HEAD"));
  if (!endpoint || !methodMatches) {
    return next();
  }

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

  const configuredBaseUrl = c.env.PUBLIC_BASE_URL?.trim();
  const baseUrl =
    configuredBaseUrl && configuredBaseUrl.length > 0
      ? configuredBaseUrl.replace(/\/+$/, "")
      : new URL(c.req.url).origin;

  let instance: MemoizedX402Instance;
  try {
    instance = await getOrCreateInstance(
      network,
      payTo,
      baseUrl,
      c.env.CDP_API_KEY_ID,
      c.env.CDP_API_KEY_SECRET
    );
    await ensureInitialized(instance);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Facilitator initialization failed";
    console.error("x402 facilitator error:", detail);
    c.set("upstream_error", classifyFacilitatorInitError(err));
    return c.json(
      {
        error: "FACILITATOR_UNAVAILABLE",
        message: "x402 facilitator temporarily unavailable. No payment was charged.",
      },
      502
    );
  }

  const response = await instance.middleware(c, next);
  const targetRes = response instanceof Response ? response : c.res;
  const contentType = targetRes.headers.get("content-type") || "";
  if (targetRes.status === 402) {
    targetRes.headers.set("Cache-Control", "no-store");
    if (contentType.includes("text/html")) {
      applyHtmlSecurityHeaders(targetRes.headers);
    }
  }
  return response;
};
