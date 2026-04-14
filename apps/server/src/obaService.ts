import type {
  AgencyCoverage,
  ArrivalsForStopResponse,
  HealthResponse,
  StopSummary,
} from "@onebus/shared";
import OnebusawaySDK from "onebusaway-sdk";
import NodeCache from "node-cache";
import { haversineMeters } from "./haversine.js";
import {
  normalizeAgencyCoverage,
  normalizeArrivals,
  normalizeStops,
} from "./normalize.js";
import { obaCall } from "./obaRateLimit.js";

const stopsMetaTtl = Number(process.env.CACHE_STOPS_TTL_SEC ?? 600);
const arrivalsTtl = Number(process.env.CACHE_ARRIVALS_TTL_SEC ?? 25);

const stopsCache = new NodeCache({ stdTTL: stopsMetaTtl, checkperiod: 60 });
const arrivalsCache = new NodeCache({ stdTTL: arrivalsTtl, checkperiod: 10 });
const agenciesCache = new NodeCache({ stdTTL: stopsMetaTtl, checkperiod: 60 });

export class ObaService {
  constructor(private readonly client: OnebusawaySDK) {}

  async health(): Promise<HealthResponse> {
    const obaApiHost = ObaService.resolvedObaHostname();
    if (!process.env.ONEBUSAWAY_API_KEY?.trim()) {
      return { ok: true, obaConfigured: false, obaApiHost };
    }
    try {
      const t = await this.client.currentTime.retrieve();
      return {
        ok: true,
        obaConfigured: true,
        obaApiHost,
        serverTimeMs: t.currentTime ?? t.data?.entry?.time,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        obaConfigured: true,
        obaApiHost,
        error: msg,
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
    const hit = agenciesCache.get<AgencyCoverage[]>("agencies");
    if (hit) return hit;
    const res = await this.client.agenciesWithCoverage.list();
    const list = res.data?.list ?? [];
    const refs = res.data?.references;
    const out = normalizeAgencyCoverage(list, refs);
    agenciesCache.set("agencies", out, stopsMetaTtl);
    return out;
  }

  async stopsNear(params: {
    lat: number;
    lon: number;
    radius: number;
    query?: string;
  }): Promise<StopSummary[]> {
    const key = `near:${params.lat.toFixed(4)}:${params.lon.toFixed(4)}:${Math.round(params.radius)}:${params.query ?? ""}`;
    const cached = stopsCache.get<StopSummary[]>(key);
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
    stopsCache.set(key, out, stopsMetaTtl);
    return out;
  }

  async stopsBbox(params: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
    query?: string;
  }): Promise<StopSummary[]> {
    const key = `bbox:v6:${params.minLat.toFixed(4)}:${params.minLon.toFixed(4)}:${params.maxLat.toFixed(4)}:${params.maxLon.toFixed(4)}:${params.query ?? ""}`;
    const cached = stopsCache.get<StopSummary[]>(key);
    if (cached) return cached;
    const parsedCalls = Number(process.env.OBA_BBOX_MAX_STOPS_FOR_LOCATION_CALLS);
    const maxCalls =
      Number.isFinite(parsedCalls) && parsedCalls > 0 ? Math.floor(parsedCalls) : 36;
    const budget = { left: maxCalls };
    const out = await this.stopsBboxChunked(params, 0, budget);
    stopsCache.set(key, out, stopsMetaTtl);
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
    const cached = stopsCache.get<StopSummary[]>(key);
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
    stopsCache.set(key, out, stopsMetaTtl);
    return out;
  }

  async arrivalsForStop(
    stopId: string,
    q?: { minutesAfter?: number; minutesBefore?: number }
  ): Promise<ArrivalsForStopResponse> {
    const key = `arr:${stopId}:${q?.minutesAfter ?? 35}:${q?.minutesBefore ?? 5}`;
    const cached = arrivalsCache.get<ArrivalsForStopResponse>(key);
    if (cached) return cached;
    const res = await this.client.arrivalAndDeparture.list(stopId, {
      minutesAfter: q?.minutesAfter ?? 35,
      minutesBefore: q?.minutesBefore ?? 5,
    });
    const entry = res.data?.entry;
    const list = entry?.arrivalsAndDepartures ?? [];
    const refs = res.data?.references;
    const serverTimeMs = res.currentTime ?? Date.now();
    const out = normalizeArrivals(stopId, serverTimeMs, list, refs);
    arrivalsCache.set(key, out, arrivalsTtl);
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
