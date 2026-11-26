import { describe, expect, it } from "vitest";
import { BoundedTtlCache, withTwoTierCache } from "../src/lib/cache";

describe("withTwoTierCache", () => {
  it("returns isolate cache hits without touching edge cache or fetcher", async () => {
    const cache = new BoundedTtlCache(10);
    cache.set("k:hit", { price: 42 }, 60_000);

    let edgeReads = 0;
    let fetches = 0;

    const res = await withTwoTierCache<{ price: number }>({
      key: "k:hit",
      ttlMs: 60_000,
      cache,
      useEdgeCache: true,
      readEdge: async () => {
        edgeReads += 1;
        return { hit: false };
      },
      fetcher: async () => {
        fetches += 1;
        return { price: 99 };
      },
    });

    expect(res).toEqual({ value: { price: 42 }, cacheHit: true });
    expect(edgeReads).toBe(0);
    expect(fetches).toBe(0);
  });

  it("populates isolate cache on edge cache hit using deserializeEdge", async () => {
    const cache = new BoundedTtlCache(10);
    let fetches = 0;

    const res = await withTwoTierCache<Map<string, number>, Array<[string, number]>>({
      key: "k:edge",
      ttlMs: 60_000,
      cache,
      useEdgeCache: true,
      readEdge: async () => ({
        hit: true,
        value: [["btc", 95_000]],
      }),
      deserializeEdge: (entries) => new Map(entries),
      fetcher: async () => {
        fetches += 1;
        return new Map();
      },
    });

    expect(res.cacheHit).toBe(true);
    expect(res.value.get("btc")).toBe(95_000);
    expect(fetches).toBe(0);
    expect(cache.get<Map<string, number>>("k:edge").hit).toBe(true);
  });

  it("coalesces concurrent misses via singleflight and schedules non-blocking waitUntil edge writes", async () => {
    const cache = new BoundedTtlCache(10);
    let fetches = 0;
    let edgeWrites = 0;
    const backgroundPromises: Promise<unknown>[] = [];

    const runCall = () =>
      withTwoTierCache<{ ok: boolean }>({
        key: "k:sf",
        ttlMs: 60_000,
        cache,
        useEdgeCache: true,
        waitUntil: (p) => {
          backgroundPromises.push(p);
        },
        readEdge: async () => ({ hit: false }),
        writeEdge: async () => {
          await new Promise((r) => setTimeout(r, 5));
          edgeWrites += 1;
        },
        fetcher: async () => {
          fetches += 1;
          await new Promise((r) => setTimeout(r, 10));
          return { ok: true };
        },
      });

    const [a, b, c] = await Promise.all([runCall(), runCall(), runCall()]);
    expect(a).toEqual({ value: { ok: true }, cacheHit: false });
    expect(b).toEqual({ value: { ok: true }, cacheHit: false });
    expect(c).toEqual({ value: { ok: true }, cacheHit: false });
    expect(fetches).toBe(1);
    expect(backgroundPromises.length).toBe(1);
    await Promise.all(backgroundPromises);
    expect(edgeWrites).toBe(1);
  });

  it("respects shouldCache=false and cleans up in-flight entry on rejection", async () => {
    const cache = new BoundedTtlCache(10);
    let edgeWrites = 0;

    const notFound = await withTwoTierCache<{ status: string }>({
      key: "k:nf",
      ttlMs: 60_000,
      cache,
      useEdgeCache: true,
      shouldCache: (v) => v.status === "ok",
      readEdge: async () => ({ hit: false }),
      writeEdge: async () => {
        edgeWrites += 1;
      },
      fetcher: async () => ({ status: "not_found" }),
    });
    expect(notFound).toEqual({ value: { status: "not_found" }, cacheHit: false });
    expect(cache.get("k:nf").hit).toBe(false);
    expect(edgeWrites).toBe(0);

    let attempts = 0;
    await expect(
      withTwoTierCache<string>({
        key: "k:err",
        ttlMs: 60_000,
        cache,
        useEdgeCache: false,
        fetcher: async () => {
          attempts += 1;
          throw new Error("boom");
        },
      })
    ).rejects.toThrow("boom");

    const recovered = await withTwoTierCache<string>({
      key: "k:err",
      ttlMs: 60_000,
      cache,
      useEdgeCache: false,
      fetcher: async () => {
        attempts += 1;
        return "recovered";
      },
    });
    expect(recovered).toEqual({ value: "recovered", cacheHit: false });
    expect(attempts).toBe(2);
  });
});
