import {
  type BoundedTtlCache,
  TTL_MS,
  referenceCache,
  withTwoTierCache,
} from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout, fetchTextWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export interface SwpcSpaceWeatherBundle {
  rCurrent: number;
  sCurrent: number;
  gCurrent: number;
  gNext24hMax: number;
  rMinorProb24h: number | null;
  rMajorProb24h: number | null;
  sProb24h: number | null;
  kpCurrent: number;
  kpMaxNext24h: number;
  solarWindSpeedKms: number | null;
  imfBtNt: number | null;
  imfBzGsmNt: number | null;
  recentAlerts: Array<{
    productId: string;
    issuedAt: string;
    headline: string;
  }>;
}

export interface ThermosphereDragData {
  obsDate: string | null;
  f107ObsSfu: number;
  f107AdjSfu: number | null;
  f107Center81Sfu: number | null;
  apDailyAvg: number | null;
  source: "celestrak" | "noaa_swpc_10cm_fallback";
}

function clampScale(raw: unknown): number {
  const n = toFiniteNumber(raw);
  if (n === null) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function unwrapSummaryRow(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

export async function fetchSwpcSpaceWeather(
  nowMs: number,
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: SwpcSpaceWeatherBundle; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<SwpcSpaceWeatherBundle>({
    key: "world:swpc:bundle:v1",
    ttlMs: TTL_MS.SPACE_SWPC,
    cache,
    waitUntil,
    fetcher: async () => {
      const [scalesRes, kpRes, speedRes, magRes, alertsRes] = await Promise.all([
        fetchJsonWithTimeout<Record<string, unknown>>(
          "https://services.swpc.noaa.gov/products/noaa-scales.json",
          { provider: "NOAA_SWPC", fetchImpl }
        ),
        fetchJsonWithTimeout<unknown[]>(
          "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
          { provider: "NOAA_SWPC", fetchImpl }
        ),
        fetchJsonWithTimeout<unknown>(
          "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json",
          { provider: "NOAA_SWPC", fetchImpl }
        ),
        fetchJsonWithTimeout<unknown>(
          "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json",
          { provider: "NOAA_SWPC", fetchImpl }
        ),
        fetchJsonWithTimeout<unknown[]>(
          "https://services.swpc.noaa.gov/products/alerts.json",
          { provider: "NOAA_SWPC", fetchImpl }
        ),
      ]);

      if (
        scalesRes.status !== "ok" ||
        kpRes.status !== "ok" ||
        speedRes.status !== "ok" ||
        magRes.status !== "ok" ||
        alertsRes.status !== "ok" ||
        !scalesRes.data ||
        typeof scalesRes.data !== "object" ||
        !Array.isArray(kpRes.data)
      ) {
        throw new UpstreamError("NOAA_SWPC", "SWPC_BAD_SCHEMA", "Invalid NOAA SWPC payload");
      }

      const curScales = (scalesRes.data["0"] ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const day1Scales = (scalesRes.data["1"] ?? {}) as Record<string, Record<string, unknown> | undefined>;

      const rCurrent = clampScale(curScales.R?.Scale);
      const sCurrent = clampScale(curScales.S?.Scale);
      const gCurrent = clampScale(curScales.G?.Scale);
      const gNext24hMax = Math.max(gCurrent, clampScale(day1Scales.G?.Scale));

      const rMinorProb24h = toFiniteNumber(day1Scales.R?.MinorProb);
      const rMajorProb24h = toFiniteNumber(day1Scales.R?.MajorProb);
      const sProb24h = toFiniteNumber(day1Scales.S?.Prob);

      let kpCurrent: number | null = null;
      let kpMaxNext24h = 0;
      const horizonMs = nowMs + 24 * 3_600_000;

      for (const item of kpRes.data) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const kpVal = toFiniteNumber(row.kp);
        if (kpVal === null) continue;
        const obsType = typeof row.observed === "string" ? row.observed.toLowerCase() : "";
        const tsRaw =
          typeof row.time_tag === "string"
            ? `${row.time_tag.trim().replace(" ", "T").replace(/Z$/, "")}Z`
            : "";
        const tsMs = Date.parse(tsRaw);

        if (obsType === "observed" || (obsType === "estimated" && Number.isFinite(tsMs) && tsMs <= nowMs)) {
          kpCurrent = kpVal;
        } else if (!Number.isFinite(tsMs) || (tsMs >= nowMs - 3 * 3_600_000 && tsMs <= horizonMs)) {
          if (kpVal > kpMaxNext24h) kpMaxNext24h = kpVal;
        }
      }

      if (kpCurrent === null) {
        throw new UpstreamError("NOAA_SWPC", "SWPC_KP_MISSING", "Missing observed Kp index in NOAA SWPC feed");
      }
      kpMaxNext24h = Math.max(kpCurrent, kpMaxNext24h);

      const speedRow = unwrapSummaryRow(speedRes.data);
      const magRow = unwrapSummaryRow(magRes.data);

      const solarWindSpeedKms =
        toFiniteNumber(speedRow?.proton_speed) ?? toFiniteNumber(speedRow?.WindSpeed);
      const imfBtNt = toFiniteNumber(magRow?.bt) ?? toFiniteNumber(magRow?.Bt);
      const imfBzGsmNt = toFiniteNumber(magRow?.bz_gsm) ?? toFiniteNumber(magRow?.Bz);

      const recentCutoffMs = nowMs - 48 * 3_600_000;
      const recentAlerts: SwpcSpaceWeatherBundle["recentAlerts"] = [];
      if (Array.isArray(alertsRes.data)) {
        for (const al of alertsRes.data) {
          if (!al || typeof al !== "object") continue;
          const rec = al as Record<string, unknown>;
          const issuedAt = typeof rec.issue_datetime === "string" ? rec.issue_datetime.trim() : "";
          const parsedIssueMs = Date.parse(`${issuedAt.replace(" ", "T")}Z`);
          if (Number.isFinite(parsedIssueMs) && parsedIssueMs < recentCutoffMs) {
            continue;
          }
          const msg = typeof rec.message === "string" ? rec.message : "";
          const headlineLine =
            msg
              .split(/\r?\n/)
              .map((l) => l.trim())
              .find((l) => /^(?:ALERT|WATCH|WARNING|SUMMARY):/i.test(l)) ??
            msg.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ??
            "Space weather advisory";

          recentAlerts.push({
            productId: typeof rec.product_id === "string" ? rec.product_id : "SWPC",
            issuedAt,
            headline: headlineLine.slice(0, 160),
          });
          if (recentAlerts.length >= 5) break;
        }
      }

      return {
        rCurrent,
        sCurrent,
        gCurrent,
        gNext24hMax,
        rMinorProb24h,
        rMajorProb24h,
        sProb24h,
        kpCurrent: Math.round(kpCurrent * 100) / 100,
        kpMaxNext24h: Math.round(kpMaxNext24h * 100) / 100,
        solarWindSpeedKms,
        imfBtNt,
        imfBzGsmNt,
        recentAlerts,
      };
    },
  });

  return { data: value, cacheHit };
}

export function parseCelestrakLatestObs(csv: string): ThermosphereDragData {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new UpstreamError("CELESTRAK", "CELESTRAK_EMPTY_CSV", "Empty CelesTrak space weather CSV");
  }

  const header = lines[0]!.split(",");
  const idxDate = header.indexOf("DATE");
  const idxApAvg = header.indexOf("AP_AVG");
  const idxF107Obs = header.indexOf("F10.7_OBS");
  const idxF107Adj = header.indexOf("F10.7_ADJ");
  const idxType = header.indexOf("F10.7_DATA_TYPE");
  const idxCenter81 = header.indexOf("F10.7_OBS_CENTER81");

  if (idxDate === -1 || idxF107Obs === -1 || idxType === -1) {
    throw new UpstreamError("CELESTRAK", "CELESTRAK_BAD_HEADERS", "Unexpected CelesTrak CSV headers");
  }

  // Scan backwards to find the latest observed ("OBS") row and skip future PRM/PRD predictions up to 2041
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i]!.split(",");
    const dataType = (cols[idxType] ?? "").trim().toUpperCase();
    if (dataType !== "OBS") continue;
    const f107Obs = toFiniteNumber(cols[idxF107Obs]);
    if (f107Obs === null || f107Obs <= 0) continue;

    return {
      obsDate: cols[idxDate]?.trim() || null,
      f107ObsSfu: f107Obs,
      f107AdjSfu: idxF107Adj >= 0 ? toFiniteNumber(cols[idxF107Adj]) : null,
      f107Center81Sfu: idxCenter81 >= 0 ? toFiniteNumber(cols[idxCenter81]) : null,
      apDailyAvg: idxApAvg >= 0 ? toFiniteNumber(cols[idxApAvg]) : null,
      source: "celestrak",
    };
  }

  throw new UpstreamError("CELESTRAK", "CELESTRAK_NO_OBS_ROW", "No observed F10.7 row found in CelesTrak CSV");
}

export async function fetchThermosphereDrag(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: ThermosphereDragData; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<ThermosphereDragData>({
    key: "world:space:thermosphere:v1",
    ttlMs: TTL_MS.SPACE_CELESTRAK,
    cache,
    waitUntil,
    fetcher: async () => {
      try {
        const csvRes = await fetchTextWithTimeout(
          "https://celestrak.org/SpaceData/SW-Last5Years.csv",
          {
            provider: "CELESTRAK",
            timeoutMs: 5000,
            fetchImpl,
          }
        );
        if (csvRes.status === "ok") {
          return parseCelestrakLatestObs(csvRes.data);
        }
      } catch {
        // Fallback to official NOAA SWPC 10.7cm solar flux summary if CelesTrak throttles
      }

      const fallbackRes = await fetchJsonWithTimeout<unknown>(
        "https://services.swpc.noaa.gov/products/summary/10cm-flux.json",
        {
          provider: "NOAA_SWPC",
          fetchImpl,
        }
      );
      if (fallbackRes.status !== "ok") {
        throw new UpstreamError("NOAA_SWPC", "SWPC_FLUX_UNAVAILABLE", "Both CelesTrak and NOAA F10.7 feeds unavailable");
      }
      const row = unwrapSummaryRow(fallbackRes.data);
      const flux = toFiniteNumber(row?.flux) ?? toFiniteNumber(row?.Flux);
      if (flux === null || flux <= 0) {
        throw new UpstreamError("NOAA_SWPC", "SWPC_FLUX_BAD_SCHEMA", "Invalid NOAA 10cm solar flux payload");
      }
      const rawTs =
        typeof row?.time_tag === "string"
          ? row.time_tag
          : typeof row?.TimeStamp === "string"
            ? row.TimeStamp
            : null;
      const ts = rawTs ? rawTs.trim().slice(0, 10) : null;
      return {
        obsDate: ts,
        f107ObsSfu: flux,
        f107AdjSfu: null,
        f107Center81Sfu: null,
        apDailyAvg: null,
        source: "noaa_swpc_10cm_fallback",
      };
    },
  });

  return { data: value, cacheHit };
}
