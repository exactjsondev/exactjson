import type { MiddlewareHandler } from "hono";
import { BoundedTtlCache, TTL_MS, isolateCache } from "../lib/cache";
import type { AppBindings } from "../types";

const PAUSE_CACHE_KEY = "service_control:state";

export interface ServiceControlState {
  paused: boolean;
  updated_at: string | null;
}

export async function getServiceControlState(
  db: D1Database | undefined,
  cache: BoundedTtlCache = isolateCache
): Promise<ServiceControlState> {
  const cached = cache.get<ServiceControlState>(PAUSE_CACHE_KEY);
  if (cached.hit) {
    return cached.value;
  }

  if (!db) {
    return { paused: false, updated_at: null };
  }

  try {
    const row = await db
      .prepare("SELECT paused, updated_at FROM service_control WHERE id = ?")
      .bind(1)
      .first<{ paused: number; updated_at: string }>();

    const state: ServiceControlState = {
      paused: row ? Number(row.paused) === 1 : false,
      updated_at: row?.updated_at ?? null,
    };

    cache.set(PAUSE_CACHE_KEY, state, TTL_MS.PAUSE_STATE);
    return state;
  } catch {
    // Fail open on transient D1 error so DB hiccups never break live API traffic
    return { paused: false, updated_at: null };
  }
}

export async function setServicePaused(
  db: D1Database,
  paused: boolean,
  cache: BoundedTtlCache = isolateCache
): Promise<ServiceControlState> {
  const updatedAt = new Date().toISOString();
  const pausedInt = paused ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO service_control (id, paused, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`
    )
    .bind(1, pausedInt, updatedAt)
    .run();

  const nextState: ServiceControlState = { paused, updated_at: updatedAt };
  cache.set(PAUSE_CACHE_KEY, nextState, TTL_MS.PAUSE_STATE);
  return nextState;
}

export function clearServiceControlCache(cache: BoundedTtlCache = isolateCache): void {
  cache.delete(PAUSE_CACHE_KEY);
}

/**
 * Runs on /v1/* BEFORE x402 payment middleware.
 * When operator switches API to Paused, returns 503 immediately so zero charges occur.
 */
export const serviceControlMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const state = await getServiceControlState(c.env.DB);
  if (state.paused) {
    c.set("cache_status", "NONE");
    c.set("upstream_error", "SERVICE_PAUSED");
    return c.json(
      {
        error: "SERVICE_PAUSED",
        message: "ExactJSON paid endpoints are currently paused by the operator. No payment was charged.",
      },
      503
    );
  }

  await next();
};
