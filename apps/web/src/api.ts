import type {
  AgencyCoverage,
  ArrivalsForStopResponse,
  StopSummary,
} from "@onebus/shared";

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

export type BboxParams = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

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

export function bboxContainsOuter(outer: BboxParams, inner: BboxParams): boolean {
  const e = 1e-9;
  return (
    inner.minLat >= outer.minLat - e &&
    inner.maxLat <= outer.maxLat + e &&
    inner.minLon >= outer.minLon - e &&
    inner.maxLon <= outer.maxLon + e
  );
}

export function fetchStopsBbox(params: BboxParams): Promise<StopSummary[]> {
  const q = quantizeBboxForCache(params);
  const sp = new URLSearchParams({
    minLat: String(q.minLat),
    minLon: String(q.minLon),
    maxLat: String(q.maxLat),
    maxLon: String(q.maxLon),
  });
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
