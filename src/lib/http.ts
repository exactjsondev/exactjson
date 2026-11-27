import { USER_AGENT } from "../config/catalog";

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 3500;

export class UpstreamError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly provider: string;

  constructor(provider: string, code: string, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "UpstreamError";
    this.provider = provider;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type UpstreamProviderId =
  | "RUGCHECK"
  | "GOPLUS"
  | "HONEYPOT_IS"
  | "DEXSCREENER"
  | "GECKOTERMINAL"
  | "KYBERSWAP"
  | "HYPERLIQUID"
  | "DYDX"
  | "KRAKEN"
  | "POLYMARKET"
  | "KALSHI"
  | "DERIBIT"
  | "TREASURY"
  | "NYFED"
  | "DEPS_DEV"
  | "OSV"
  | "NPM_REGISTRY"
  | "PYPI"
  | "CRATES_IO"
  | "FIRST_EPSS"
  | "CISA_KEV"
  | "MITRE_CVE"
  | "CF_DOH"
  | "CF_SECURITY_DOH"
  | "IANA_RDAP"
  | "RDAP"
  | "STATUSPAGE"
  | "ENDOFLIFE"
  | "HF_HUB"
  | "OONI"
  | "AWC"
  | "FAA_NAS"
  | "NOAA_SWPC"
  | "CELESTRAK"
  | "GDACS"
  | "USGS"
  | "NASA_EONET"
  | "MET_NORWAY"
  | "US_CENSUS"
  | "EPA_TRI"
  | "GOVUK_FCDO"
  | "NAGER_DATE"
  | "NASA_POWER";

export interface FetchJsonOptions<T = unknown> {
  provider: UpstreamProviderId;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  allow404?: boolean;
  empty204Value?: T;
  fetchImpl?: typeof fetch;
}

export type FetchJsonResult<T> =
  | { status: "ok"; data: T }
  | { status: "not_found" };

export async function fetchJsonWithTimeout<T>(
  url: string,
  options: FetchJsonOptions<T>
): Promise<FetchJsonResult<T>> {
  const {
    provider,
    method = "GET",
    body,
    headers: customHeaders,
    timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    allow404 = false,
    empty204Value,
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    ...(customHeaders ?? {}),
  };

  let serializedBody: string | undefined;
  if (method === "POST" && body !== undefined) {
    headers["Content-Type"] = "application/json";
    serializedBody = JSON.stringify(body);
  }

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: serializedBody,
      signal: controller.signal,
    });

    if (response.status === 404 && allow404) {
      return { status: "not_found" };
    }

    if (response.status === 204 && empty204Value !== undefined) {
      return { status: "ok", data: empty204Value };
    }

    if (!response.ok) {
      const code =
        response.status === 403
          ? `${provider}_403`
          : response.status === 429
            ? `${provider}_429`
            : response.status >= 500
              ? `${provider}_5XX`
              : `${provider}_${response.status}`;

      throw new UpstreamError(
        provider,
        code,
        `${provider} returned HTTP ${response.status}`,
        response.status
      );
    }

    try {
      const data = (await response.json()) as T;
      return { status: "ok", data };
    } catch {
      throw new UpstreamError(
        provider,
        `${provider}_BAD_JSON`,
        `${provider} returned invalid JSON`,
        response.status
      );
    }
  } catch (err) {
    if (err instanceof UpstreamError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError(
        provider,
        `${provider}_TIMEOUT`,
        `${provider} timed out after ${timeoutMs}ms`,
        null
      );
    }
    throw new UpstreamError(
      provider,
      `${provider}_NETWORK_ERROR`,
      `${provider} request failed`,
      null
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchTextOptions {
  provider: UpstreamProviderId;
  headers?: Record<string, string>;
  timeoutMs?: number;
  allow404?: boolean;
  allow204?: boolean;
  fetchImpl?: typeof fetch;
}

export async function fetchTextWithTimeout(
  url: string,
  options: FetchTextOptions
): Promise<FetchJsonResult<string>> {
  const {
    provider,
    headers: customHeaders,
    timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    allow404 = false,
    allow204 = false,
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/xml, text/xml, text/csv, text/plain, */*",
    ...(customHeaders ?? {}),
  };

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (response.status === 404 && allow404) {
      return { status: "not_found" };
    }

    if (response.status === 204 && allow204) {
      return { status: "ok", data: "" };
    }

    if (!response.ok) {
      const code =
        response.status === 403
          ? `${provider}_403`
          : response.status === 429
            ? `${provider}_429`
            : response.status >= 500
              ? `${provider}_5XX`
              : `${provider}_${response.status}`;

      throw new UpstreamError(
        provider,
        code,
        `${provider} returned HTTP ${response.status}`,
        response.status
      );
    }

    const data = await response.text();
    return { status: "ok", data };
  } catch (err) {
    if (err instanceof UpstreamError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError(
        provider,
        `${provider}_TIMEOUT`,
        `${provider} timed out after ${timeoutMs}ms`,
        null
      );
    }
    throw new UpstreamError(
      provider,
      `${provider}_NETWORK_ERROR`,
      `${provider} request failed`,
      null
    );
  } finally {
    clearTimeout(timer);
  }
}
