import type { Stop } from "@onebus/shared";
import { Redis } from "ioredis";

const PREFIX = "onebus:v2:";

const url = process.env.REDIS_URL?.trim();
const redis = url ? new Redis(url, { maxRetriesPerRequest: 3 }) : null;
redis?.on("error", (err) => console.error("Redis:", err.message));

export const cacheEnabled = redis !== null;

/** Returns the cached value for `key`, loading and storing it on a miss. Redis failures fall through to `load`. */
export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const hit = await redis?.get(PREFIX + key).catch(() => null);
  if (hit) return JSON.parse(hit) as T;
  const value = await load();
  await redis?.setex(PREFIX + key, ttlSec, JSON.stringify(value)).catch(() => {});
  return value;
}

/** Every stop in any cached stop list, so clients can draw stops before fetching their own viewport. */
export async function cachedStops(): Promise<Stop[]> {
  if (!redis) return [];
  const stops = new Map<string, Stop>();
  const stream = redis.scanStream({ match: `${PREFIX}stops:*`, count: 256 });
  for await (const keys of stream as AsyncIterable<string[]>) {
    if (keys.length === 0) continue;
    for (const list of await redis.mget(keys)) {
      if (!list) continue;
      for (const stop of JSON.parse(list) as Stop[]) stops.set(stop.id, stop);
    }
  }
  return [...stops.values()];
}

export async function closeCache(): Promise<void> {
  await redis?.quit();
}
