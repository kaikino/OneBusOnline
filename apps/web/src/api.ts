import {
  bboxContainsOuter,
  quantizeBboxForCache,
  type AgencyCoverage,
  type ArrivalsForStopResponse,
  type BboxParams,
  type StopSummary,
} from "@onebus/shared";
export type { BboxParams };
export { bboxContainsOuter, quantizeBboxForCache };

const prefix = () =>
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "";

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = prefix();
  if (!base) return p;
  return `${base}${p}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function fetchAgencyCoverage(): Promise<AgencyCoverage[]> {
  return getJson("/api/v1/agencies/coverage");
}

/** Merges all bbox/near/search stop lists stored in the BFF cache (Redis or memory). */
export async function fetchStopsSnapshot(): Promise<StopSummary[]> {
  try {
    const res = await fetch(apiUrl("/api/v1/stops/snapshot"));
    if (!res.ok) return [];
    const data = (await res.json()) as { stops?: StopSummary[] };
    return Array.isArray(data.stops) ? data.stops : [];
  } catch {
    return [];
  }
}

export function fetchStopsBbox(
  params: BboxParams,
  opts?: { cacheOnly?: boolean }
): Promise<StopSummary[]> {
  const q = quantizeBboxForCache(params);
  const sp = new URLSearchParams({
    minLat: String(q.minLat),
    minLon: String(q.minLon),
    maxLat: String(q.maxLat),
    maxLon: String(q.maxLon),
  });
  if (opts?.cacheOnly) sp.set("cacheOnly", "1");
  return getJson(`/api/v1/stops/bbox?${sp}`);
}

export function fetchStopsSearch(
  q: string,
  lat?: number,
  lon?: number
): Promise<StopSummary[]> {
  const sp = new URLSearchParams({ q });
  if (lat !== undefined && lon !== undefined) {
    sp.set("lat", String(lat));
    sp.set("lon", String(lon));
  }
  return getJson(`/api/v1/stops/search?${sp}`);
}

export function fetchArrivals(stopId: string): Promise<ArrivalsForStopResponse> {
  return getJson(`/api/v1/stops/${encodeURIComponent(stopId)}/arrivals`);
}

const LS_ARR_PREFIX = "onebus:arrivals:";

export function loadCachedArrivals(
  stopId: string
): ArrivalsForStopResponse | null {
  try {
    const raw = localStorage.getItem(LS_ARR_PREFIX + stopId);
    if (!raw) return null;
    return JSON.parse(raw) as ArrivalsForStopResponse;
  } catch {
    return null;
  }
}

export function saveCachedArrivals(
  stopId: string,
  data: ArrivalsForStopResponse
): void {
  try {
    localStorage.setItem(LS_ARR_PREFIX + stopId, JSON.stringify(data));
  } catch {}
}
