import type {
  AgencyCoverage,
  ArrivalsForStopResponse,
  HealthResponse,
  RouteShape,
  StopSummary,
} from "@onebus/shared";
import { quantizeBboxForCache, stopsBboxCacheKey } from "@onebus/shared";
import OnebusawaySDK from "onebusaway-sdk";
import { haversineMeters } from "./haversine.js";
import {
  normalizeAgencyCoverage,
  normalizeArrivals,
  normalizeRouteShape,
  normalizeStops,
} from "./normalize.js";
import { obaCall } from "./obaRateLimit.js";
import {
  cacheGet,
  cacheGetStops,
  cacheSet,
  cacheSetStops,
  stopListCacheBackend,
} from "./stopListCache.js";

const stopsMetaTtl = Number(process.env.CACHE_STOPS_TTL_SEC ?? 600);
const arrivalsTtl = Number(process.env.CACHE_ARRIVALS_TTL_SEC ?? 25);
const routeShapeTtl = Number(process.env.CACHE_ROUTE_SHAPE_TTL_SEC ?? 86_400);

const arrivalsDefaultAfter = (() => {
  const n = Number(process.env.ARRIVALS_MINUTES_AFTER_DEFAULT ?? 120);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 120;
})();

const arrivalsDefaultBefore = (() => {
  const n = Number(process.env.ARRIVALS_MINUTES_BEFORE_DEFAULT ?? 15);
  return Number.isFinite(n) ? Math.min(120, Math.max(0, Math.floor(n))) : 15;
})();

export class ObaService {
  constructor(private readonly client: OnebusawaySDK) {}

  async health(): Promise<HealthResponse> {
    const obaApiHost = ObaService.resolvedObaHostname();
    const stopListCache = stopListCacheBackend();
    if (!process.env.ONEBUSAWAY_API_KEY?.trim()) {
      return { ok: true, obaConfigured: false, obaApiHost, stopListCache };
    }
    try {
      const t = await this.client.currentTime.retrieve();
      return {
        ok: true,
        obaConfigured: true,
        obaApiHost,
        serverTimeMs: t.currentTime ?? t.data?.entry?.time,
        stopListCache,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        obaConfigured: true,
        obaApiHost,
        error: msg,
        stopListCache,
      };
    }
  }

  static resolvedObaHostname(): string {
    const raw =
      process.env.OBA_BASE_URL?.trim() ||
      process.env.ONEBUSAWAY_SDK_BASE_URL?.trim() ||
      "https://api.pugetsound.onebusaway.org";
    try {
      const withProto = raw.includes("://") ? raw : `https://${raw}`;
      return new URL(withProto).host;
    } catch {
      return raw.replace(/^https?:\/\//i, "").split("/")[0] ?? raw;
    }
  }

  async agenciesCoverage(): Promise<AgencyCoverage[]> {
    const raw = await cacheGet("agencies");
    if (raw) {
      try {
        return JSON.parse(raw) as AgencyCoverage[];
      } catch { /* fall through */ }
    }
    const res = await this.client.agenciesWithCoverage.list();
    const list = res.data?.list ?? [];
    const refs = res.data?.references;
    const out = normalizeAgencyCoverage(list, refs);
    await cacheSet("agencies", JSON.stringify(out), stopsMetaTtl);
    return out;
  }

  async stopsNear(params: {
    lat: number;
    lon: number;
    radius: number;
    query?: string;
  }): Promise<StopSummary[]> {
    const key = `near:${params.lat.toFixed(4)}:${params.lon.toFixed(4)}:${Math.round(params.radius)}:${params.query ?? ""}`;
    const cached = await cacheGetStops(key);
    if (cached) return cached;
    const res = await obaCall("stopsForLocation", () =>
      this.client.stopsForLocation.list({
        lat: params.lat,
        lon: params.lon,
        radius: params.radius,
        ...(params.query ? { query: params.query } : {}),
      })
    );
    const list = res.data?.list ?? [];
    const refs = res.data?.references;
    const out = normalizeStops(list, refs, {
      lat: params.lat,
      lon: params.lon,
    });
    await cacheSetStops(key, out, stopsMetaTtl);
    return out;
  }

  async stopsBbox(
    params: {
      minLat: number;
      minLon: number;
      maxLat: number;
      maxLon: number;
      query?: string;
    },
    options?: { cacheOnly?: boolean }
  ): Promise<StopSummary[]> {
    const q = quantizeBboxForCache(params);
    const key = stopsBboxCacheKey(q, params.query);
    const cached = await cacheGetStops(key);
    if (cached) return cached;
    if (options?.cacheOnly) return [];
    const parsedCalls = Number(process.env.OBA_BBOX_MAX_STOPS_FOR_LOCATION_CALLS);
    const maxCalls =
      Number.isFinite(parsedCalls) && parsedCalls > 0 ? Math.floor(parsedCalls) : 36;
    const budget = { left: maxCalls };
    const out = await this.stopsBboxChunked({ ...q, query: params.query }, 0, budget);
    await cacheSetStops(key, out, stopsMetaTtl);
    return out;
  }

  private static readonly STOPS_FOR_LOCATION_CROWDED_THRESHOLD = 75;

  private async stopsBboxChunked(
    params: {
      minLat: number;
      minLon: number;
      maxLat: number;
      maxLon: number;
      query?: string;
    },
    depth: number,
    budget: { left: number }
  ): Promise<StopSummary[]> {
    if (budget.left <= 0) return [];
    budget.left -= 1;

    const lat = (params.minLat + params.maxLat) / 2;
    const lon = (params.minLon + params.maxLon) / 2;
    const latSpan = Math.max(0.0001, params.maxLat - params.minLat);
    const lonSpan = Math.max(0.0001, params.maxLon - params.minLon);
    const radiusMeters = radiusMetersForBbox(
      params.minLat,
      params.minLon,
      params.maxLat,
      params.maxLon
    );
    const res = await obaCall("stopsForLocation", () =>
      this.client.stopsForLocation.list({
        lat,
        lon,
        radius: radiusMeters,
        ...(params.query ? { query: params.query } : {}),
      })
    );
    const rawList = res.data?.list ?? [];
    const refs = res.data?.references;
    const limitExceeded = res.data?.limitExceeded ?? false;
    const list = rawList.filter((s) =>
      stopInGeoBBox(s.lat, s.lon, params.minLat, params.minLon, params.maxLat, params.maxLon)
    );
    const crowded =
      rawList.length >= ObaService.STOPS_FOR_LOCATION_CROWDED_THRESHOLD;

    const minSplitDeg = 1e-4;
    const maxDepth = 8;
    const shouldSubdivide =
      depth < maxDepth &&
      latSpan > minSplitDeg * 2 &&
      lonSpan > minSplitDeg * 2 &&
      budget.left > 0 &&
      (limitExceeded || crowded);

    if (shouldSubdivide) {
      const midLat = (params.minLat + params.maxLat) / 2;
      const midLon = (params.minLon + params.maxLon) / 2;
      const quads = [
        {
          minLat: params.minLat,
          maxLat: midLat,
          minLon: params.minLon,
          maxLon: midLon,
        },
        {
          minLat: params.minLat,
          maxLat: midLat,
          minLon: midLon,
          maxLon: params.maxLon,
        },
        {
          minLat: midLat,
          maxLat: params.maxLat,
          minLon: params.minLon,
          maxLon: midLon,
        },
        {
          minLat: midLat,
          maxLat: params.maxLat,
          minLon: midLon,
          maxLon: params.maxLon,
        },
      ];
      const merged = new Map<string, StopSummary>();
      for (const q of quads) {
        if (budget.left <= 0) break;
        const part = await this.stopsBboxChunked(
          { ...q, query: params.query },
          depth + 1,
          budget
        );
        for (const s of part) merged.set(s.id, s);
      }
      return [...merged.values()];
    }

    return normalizeStops(list, refs, undefined);
  }

  async searchStops(input: string, origin?: { lat: number; lon: number }): Promise<StopSummary[]> {
    const key = `search:${input.toLowerCase()}:${origin?.lat ?? "x"}:${origin?.lon ?? "x"}`;
    const cached = await cacheGetStops(key);
    if (cached) return cached;

    let list: Array<{
      id: string;
      lat: number;
      lon: number;
      name: string;
      routeIds: string[];
      code?: string;
      direction?: string;
    }> = [];
    let refs: Parameters<typeof normalizeStops>[1] = undefined;

    try {
      const res = await this.client.searchForStop.list({
        input,
        maxCount: 30,
      });
      list = res.data?.list ?? [];
      refs = res.data?.references;
    } catch {}

    if (list.length === 0) {
      let c = origin;
      if (!c) {
        const agencies = await this.agenciesCoverage();
        const first = agencies[0];
        c = first
          ? { lat: first.lat, lon: first.lon }
          : { lat: 47.6062, lon: -122.3321 };
      }
      const res = await obaCall("stopsForLocation", () =>
        this.client.stopsForLocation.list({
          lat: c.lat,
          lon: c.lon,
          radius: 50_000,
          query: input,
        })
      );
      list = res.data?.list ?? [];
      refs = res.data?.references;
    }

    const out = normalizeStops(list, refs, origin);
    await cacheSetStops(key, out, stopsMetaTtl);
    return out;
  }

  async stopsForRoute(routeId: string): Promise<RouteShape> {
    const key = `route-shape:${routeId}`;
    const raw = await cacheGet(key);
    if (raw) {
      try {
        return JSON.parse(raw) as RouteShape;
      } catch { /* fall through */ }
    }
    const res = await obaCall("stopsForRoute", () =>
      this.client.stopsForRoute.list(routeId, { includePolylines: true })
    );
    const entry = res.data?.entry;
    const out = normalizeRouteShape(routeId, entry);
    await cacheSet(key, JSON.stringify(out), routeShapeTtl);
    return out;
  }

  async arrivalsForStop(
    stopId: string,
    q?: { minutesAfter?: number; minutesBefore?: number }
  ): Promise<ArrivalsForStopResponse> {
    const after = q?.minutesAfter ?? arrivalsDefaultAfter;
    const before = q?.minutesBefore ?? arrivalsDefaultBefore;
    const key = `arr:${stopId}:${after}:${before}`;
    const raw = await cacheGet(key);
    if (raw) {
      try {
        return JSON.parse(raw) as ArrivalsForStopResponse;
      } catch { /* fall through */ }
    }
    const res = await this.client.arrivalAndDeparture.list(stopId, {
      minutesAfter: after,
      minutesBefore: before,
    });
    const entry = res.data?.entry;
    const list = entry?.arrivalsAndDepartures ?? [];
    const refs = res.data?.references;
    const serverTimeMs = res.currentTime ?? Date.now();
    const out = normalizeArrivals(stopId, serverTimeMs, list, refs);
    await cacheSet(key, JSON.stringify(out), arrivalsTtl);
    return out;
  }
}

function stopInGeoBBox(
  lat: number,
  lon: number,
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number
): boolean {
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

function radiusMetersForBbox(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number
): number {
  const cLat = (minLat + maxLat) / 2;
  const cLon = (minLon + maxLon) / 2;
  const corners: Array<[number, number]> = [
    [minLat, minLon],
    [minLat, maxLon],
    [maxLat, minLon],
    [maxLat, maxLon],
  ];
  let maxR = 0;
  for (const [la, lo] of corners) {
    const d = haversineMeters(cLat, cLon, la, lo);
    if (d > maxR) maxR = d;
  }
  return Math.max(50, Math.ceil(maxR));
}
