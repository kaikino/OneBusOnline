import {
  bboxContainsOuter,
  quantizeBboxForCache,
  type AgencyCoverage,
  type ArrivalsForStopResponse,
  type BboxParams,
  type RouteShape,
  type RouteVehiclesResponse,
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
export async function fetchStopsSnapshot(
  bbox?: BboxParams
): Promise<StopSummary[]> {
  try {
    let url = apiUrl("/api/v1/stops/snapshot");
    if (bbox) {
      const sp = new URLSearchParams({
        minLat: String(bbox.minLat),
        minLon: String(bbox.minLon),
        maxLat: String(bbox.maxLat),
        maxLon: String(bbox.maxLon),
      });
      url += `?${sp}`;
    }
    const res = await fetch(url);
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

/**
 * How far ahead / behind to ask OBA for arrivals (baked at build time from Vite env).
 * Wider `minutesAfter` surfaces more routes with later trips.
 */
export const ARRIVALS_QUERY_WINDOW = (() => {
  const rawA = import.meta.env.VITE_ARRIVALS_MINUTES_AFTER as string | undefined;
  const rawB = import.meta.env.VITE_ARRIVALS_MINUTES_BEFORE as string | undefined;
  const after =
    rawA !== undefined && rawA !== "" ? Number(rawA) : 120;
  const before =
    rawB !== undefined && rawB !== "" ? Number(rawB) : 15;
  return {
    minutesAfter: Math.max(1, Number.isFinite(after) ? Math.floor(after) : 120),
    minutesBefore: Math.min(120, Math.max(0, Number.isFinite(before) ? Math.floor(before) : 15)),
  };
})();

/** Extra “minutes after now” added each time the user extends the arrivals horizon. */
export const ARRIVALS_EXTEND_STEP_MIN = (() => {
  const raw = import.meta.env.VITE_ARRIVALS_EXTEND_STEP_MIN as string | undefined;
  const n = raw !== undefined && raw !== "" ? Number(raw) : 120;
  return Math.min(360, Math.max(15, Number.isFinite(n) ? Math.floor(n) : 120));
})();

export function arrivalsLocalStorageKey(
  stopId: string,
  minutesAfter: number,
  minutesBefore: number
): string {
  return `onebus:arrivals:${minutesAfter}_${minutesBefore}:${stopId}`;
}

export function fetchRouteShape(routeId: string): Promise<RouteShape> {
  return getJson(`/api/v1/routes/${encodeURIComponent(routeId)}/stops`);
}

export function fetchRouteVehicles(
  routeId: string
): Promise<RouteVehiclesResponse> {
  return getJson(`/api/v1/routes/${encodeURIComponent(routeId)}/vehicles`);
}

export function fetchArrivals(
  stopId: string,
  window?: { minutesAfter: number; minutesBefore?: number }
): Promise<ArrivalsForStopResponse> {
  const minutesBefore = window?.minutesBefore ?? ARRIVALS_QUERY_WINDOW.minutesBefore;
  const minutesAfter =
    window?.minutesAfter ?? ARRIVALS_QUERY_WINDOW.minutesAfter;
  const sp = new URLSearchParams({
    minutesAfter: String(minutesAfter),
    minutesBefore: String(minutesBefore),
  });
  return getJson(
    `/api/v1/stops/${encodeURIComponent(stopId)}/arrivals?${sp}`
  );
}

export function loadCachedArrivals(
  stopId: string,
  minutesAfter: number = ARRIVALS_QUERY_WINDOW.minutesAfter,
  minutesBefore: number = ARRIVALS_QUERY_WINDOW.minutesBefore
): ArrivalsForStopResponse | null {
  try {
    const raw = localStorage.getItem(
      arrivalsLocalStorageKey(stopId, minutesAfter, minutesBefore)
    );
    if (!raw) return null;
    return JSON.parse(raw) as ArrivalsForStopResponse;
  } catch {
    return null;
  }
}

export function saveCachedArrivals(
  stopId: string,
  data: ArrivalsForStopResponse,
  minutesAfter: number = ARRIVALS_QUERY_WINDOW.minutesAfter,
  minutesBefore: number = ARRIVALS_QUERY_WINDOW.minutesBefore
): void {
  try {
    localStorage.setItem(
      arrivalsLocalStorageKey(stopId, minutesAfter, minutesBefore),
      JSON.stringify(data)
    );
  } catch {}
}
