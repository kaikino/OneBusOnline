const entries = new Map<string, { value: unknown; expiresAt: number }>();

/** Returns the cached value for `key`, loading and storing it on a miss. */
export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const entry = entries.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value as T;
  const value = await load();
  entries.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  return value;
}
