/** Viewport / request rectangle for stop lists (degrees). */
export type BboxParams = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

/**
 * Snap bbox edges to 1e-4° so client, URL params, and Redis keys agree.
 * (Plain toFixed(4) on floats can disagree with round-then-divide.)
 */
export function quantizeBboxForCache(b: BboxParams): BboxParams {
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  let minLat = r(b.minLat);
  let maxLat = r(b.maxLat);
  let minLon = r(b.minLon);
  let maxLon = r(b.maxLon);
  const eps = 1e-4;
  if (minLat >= maxLat) maxLat = minLat + eps;
  if (minLon >= maxLon) maxLon = minLon + eps;
  return { minLat, minLon, maxLat, maxLon };
}

const E = 1e-9;

export function bboxContainsOuter(outer: BboxParams, inner: BboxParams): boolean {
  return (
    inner.minLat >= outer.minLat - E &&
    inner.maxLat <= outer.maxLat + E &&
    inner.minLon >= outer.minLon - E &&
    inner.maxLon <= outer.maxLon + E
  );
}

/** Integer ticks (0.0001°) — stable across runtimes for Redis / in-memory keys. */
function tick(x: number): number {
  return Math.round(x * 1e4);
}

/**
 * Stop-bbox cache key. Pass the **quantized** bbox (use {@link quantizeBboxForCache} first)
 * so client and server always match.
 */
export function stopsBboxCacheKey(q: BboxParams, query?: string): string {
  return `bbox:v7:${tick(q.minLat)}:${tick(q.minLon)}:${tick(q.maxLat)}:${tick(q.maxLon)}:${query ?? ""}`;
}
