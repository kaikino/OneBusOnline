import type { StopSummary } from "@onebus/shared";
import { Redis } from "ioredis";
import NodeCache from "node-cache";

const ttlSec = Number(process.env.CACHE_STOPS_TTL_SEC ?? 600);
const memory = new NodeCache({ stdTTL: ttlSec, checkperiod: 60 });

const KEY_PREFIX = "onebus:v1:stops";

let client: Redis | null | undefined;

function formatRedisErr(err: unknown): string {
  if (err instanceof Error) {
    const n = err as NodeJS.ErrnoException & { syscall?: string };
    const parts = [
      n.message?.trim(),
      n.code && `code=${n.code}`,
      n.errno != null && `errno=${n.errno}`,
    ].filter(Boolean) as string[];
    if (parts.length > 0) return parts.join(" ");
    return n.name || "Error";
  }
  return String(err);
}

const ERR_LOG_MS = 10_000;
let errLogAt = 0;
let errBurst = 0;
let errLast: unknown;

function logRedisErr(err: unknown): void {
  errLast = err;
  errBurst++;
  const now = Date.now();
  if (now - errLogAt < ERR_LOG_MS) return;
  errLogAt = now;
  const line = formatRedisErr(errLast);
  const suffix = errBurst > 1 ? ` (${errBurst}×)` : "";
  errBurst = 0;
  console.error(`[bff] Redis: ${line || "(unknown)"}${suffix}`);
}

function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    client = null;
    return null;
  }
  try {
    const r = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    r.on("error", (err: Error) => logRedisErr(err));
    client = r;
    return r;
  } catch (e) {
    console.error("[bff] Redis connection failed:", e);
    client = null;
    return null;
  }
}

export function stopListCacheBackend(): "redis" | "memory" {
  return redis() ? "redis" : "memory";
}

export async function closeStopListCache(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
    client = undefined;
  }
}

export async function cacheGetStops(key: string): Promise<StopSummary[] | undefined> {
  const r = redis();
  if (r) {
    try {
      const raw = await r.get(`${KEY_PREFIX}:${key}`);
      if (raw) return JSON.parse(raw) as StopSummary[];
    } catch (e) {
      logRedisErr(e);
    }
    return undefined;
  }
  return memory.get<StopSummary[]>(key);
}

export async function cacheSetStops(
  key: string,
  value: StopSummary[],
  ttl: number
): Promise<void> {
  const r = redis();
  if (r) {
    try {
      await r.setex(`${KEY_PREFIX}:${key}`, ttl, JSON.stringify(value));
    } catch (e) {
      logRedisErr(e);
      memory.set(key, value, ttl);
    }
    return;
  }
  memory.set(key, value, ttl);
}

const SNAPSHOT_MAX_STOPS = (() => {
  const n = Number(process.env.STOPS_SNAPSHOT_MAX_STOPS ?? 100_000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100_000;
})();

function mergeStopRowsInto(
  merged: Map<string, StopSummary>,
  rows: unknown
): void {
  if (!Array.isArray(rows)) return;
  for (const item of rows) {
    if (
      merged.size >= SNAPSHOT_MAX_STOPS ||
      !item ||
      typeof item !== "object" ||
      !("id" in item)
    ) {
      continue;
    }
    const s = item as StopSummary;
    if (typeof s.id !== "string" || typeof s.lat !== "number" || typeof s.lon !== "number") {
      continue;
    }
    merged.set(s.id, s);
  }
}

/**
 * All stop-list entries in Redis (bbox / near / search), deduped by stop id.
 * Used to hydrate clients without calling OBA. Bounded by STOPS_SNAPSHOT_MAX_STOPS.
 */
export async function mergeAllCachedStopLists(): Promise<StopSummary[]> {
  const merged = new Map<string, StopSummary>();
  const r = redis();
  if (r) {
    try {
      const pattern = `${KEY_PREFIX}:*`;
      let cursor = "0";
      do {
        const [next, keys] = await r.scan(cursor, "MATCH", pattern, "COUNT", 256);
        cursor = next;
        for (const fullKey of keys) {
          if (merged.size >= SNAPSHOT_MAX_STOPS) break;
          const raw = await r.get(fullKey);
          if (!raw) continue;
          try {
            mergeStopRowsInto(merged, JSON.parse(raw) as unknown);
          } catch {
            /* skip malformed */
          }
        }
        if (merged.size >= SNAPSHOT_MAX_STOPS) break;
      } while (cursor !== "0");
    } catch (e) {
      logRedisErr(e);
    }
    return [...merged.values()];
  }

  for (const key of memory.keys()) {
    if (merged.size >= SNAPSHOT_MAX_STOPS) break;
    const rows = memory.get<StopSummary[]>(key);
    mergeStopRowsInto(merged, rows);
  }
  return [...merged.values()];
}
