import type {
  AgencyCoverage,
  ArrivalPunctuality,
  ArrivalRow,
  ArrivalsForStopResponse,
  RouteShape,
  RouteVehicle,
  RouteVehiclesResponse,
  StopSummary,
} from "@onebus/shared";
import type { OnebusawaySDK } from "onebusaway-sdk";
import { haversineMeters } from "./haversine.js";

type References = OnebusawaySDK.References;

function routeMaps(refs: References | undefined) {
  const byId = new Map<string, { shortName: string; longName?: string }>();
  for (const r of refs?.routes ?? []) {
    byId.set(r.id, {
      shortName: r.shortName ?? r.nullSafeShortName ?? r.id,
      longName: r.longName,
    });
  }
  return byId;
}

function agencyNameMap(refs: References | undefined) {
  const m = new Map<string, string>();
  for (const a of refs?.agencies ?? []) {
    m.set(a.id, a.name);
  }
  return m;
}

export function normalizeStops(
  list: Array<{
    id: string;
    lat: number;
    lon: number;
    name: string;
    routeIds: string[];
    code?: string;
    direction?: string;
  }>,
  _refs: References | undefined,
  origin?: { lat: number; lon: number }
): StopSummary[] {
  const out: StopSummary[] = list.map((s) => {
    const row: StopSummary = {
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      code: s.code,
      direction: s.direction,
      routeIds: s.routeIds ?? [],
    };
    if (origin) {
      row.distanceMeters = Math.round(
        haversineMeters(origin.lat, origin.lon, s.lat, s.lon)
      );
    }
    return row;
  });
  if (origin) {
    out.sort(
      (a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)
    );
  }
  return out;
}

function punctualityFrom(
  predicted: boolean | undefined,
  deviationSec: number | undefined
): ArrivalPunctuality {
  if (!predicted || deviationSec === undefined) {
    return "scheduled_only";
  }
  if (deviationSec > 90) return "late";
  if (deviationSec < -90) return "early";
  return "on_time";
}

export function normalizeArrivals(
  stopId: string,
  serverTimeMs: number,
  arrivals: Array<{
    tripId: string;
    routeId: string;
    tripHeadsign: string;
    stopId: string;
    scheduledArrivalTime: number;
    predictedArrivalTime: number;
    predicted?: boolean;
    routeShortName?: string;
    routeLongName?: string;
    numberOfStopsAway: number;
    vehicleId?: string;
    tripStatus?: { scheduleDeviation: number; predicted: boolean };
  }>,
  refs: References | undefined
): ArrivalsForStopResponse {
  const routes = routeMaps(refs);
  const rows: ArrivalRow[] = arrivals.map((a) => {
    const r = routes.get(a.routeId);
    const deviation =
      a.tripStatus?.scheduleDeviation ??
      (a.predicted && a.scheduledArrivalTime > 0 && a.predictedArrivalTime > 0
        ? Math.round(
            (a.predictedArrivalTime - a.scheduledArrivalTime) / 1000
          )
        : undefined);
    const predicted = Boolean(a.predicted ?? a.tripStatus?.predicted);
    return {
      tripId: a.tripId,
      routeId: a.routeId,
      routeShortName: a.routeShortName ?? r?.shortName ?? a.routeId,
      routeLongName: a.routeLongName ?? r?.longName,
      headsign: a.tripHeadsign,
      stopId: a.stopId,
      scheduledArrivalTimeMs: a.scheduledArrivalTime,
      predictedArrivalTimeMs: a.predictedArrivalTime,
      predicted,
      scheduleDeviationSec: deviation,
      punctuality: punctualityFrom(predicted, deviation),
      numberOfStopsAway: a.numberOfStopsAway,
      vehicleId: a.vehicleId,
    };
  });
  rows.sort((x, y) => {
    const tx = pickSortTime(x);
    const ty = pickSortTime(y);
    return tx - ty;
  });
  return { stopId, serverTimeMs, arrivals: rows };
}

function pickSortTime(a: ArrivalRow): number {
  if (a.predicted && a.predictedArrivalTimeMs > 0) {
    return a.predictedArrivalTimeMs;
  }
  return a.scheduledArrivalTimeMs;
}

export function normalizeRouteShape(
  routeId: string,
  entry: {
    routeId?: string;
    stopIds?: Array<string>;
    polylines?: Array<{ points?: string }>;
    stopGroupings?: Array<{
      polylines?: Array<{ points?: string }>;
      stopIds?: Array<string>;
    }>;
  } | undefined
): RouteShape {
  const polylines: string[] = [];
  for (const p of entry?.polylines ?? []) {
    if (p?.points) polylines.push(p.points);
  }
  if (polylines.length === 0) {
    // Some agencies only populate polylines on stopGroupings; flatten.
    for (const g of entry?.stopGroupings ?? []) {
      for (const p of g?.polylines ?? []) {
        if (p?.points) polylines.push(p.points);
      }
    }
  }
  const stopIds = Array.isArray(entry?.stopIds) ? entry!.stopIds! : [];
  return {
    routeId: entry?.routeId ?? routeId,
    polylines,
    stopIds,
  };
}

export function normalizeRouteVehicles(
  routeId: string,
  serverTimeMs: number,
  list: Array<{
    tripId: string;
    status?: {
      activeTripId?: string;
      predicted?: boolean;
      scheduleDeviation?: number;
      lastUpdateTime?: number;
      lastLocationUpdateTime?: number;
      orientation?: number;
      lastKnownOrientation?: number;
      occupancyStatus?: string;
      vehicleId?: string;
      position?: { lat?: number; lon?: number };
      lastKnownLocation?: { lat?: number; lon?: number };
    };
  }>,
  refs: References | undefined
): RouteVehiclesResponse {
  const routes = routeMaps(refs);
  const trips = new Map<
    string,
    { headsign?: string; routeId?: string; directionId?: string }
  >();
  for (const t of refs?.trips ?? []) {
    trips.set(t.id, {
      headsign: t.tripHeadsign,
      routeId: t.routeId,
      directionId: t.directionId,
    });
  }
  const vehicles: RouteVehicle[] = [];
  for (const item of list) {
    const status = item.status;
    if (!status) continue;
    const pos = status.position ?? status.lastKnownLocation;
    const lat = pos?.lat;
    const lon = pos?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const tripId = status.activeTripId ?? item.tripId;
    const tripMeta = trips.get(tripId);
    // Block-trip / interlining guard: if OBA tells us this vehicle is
    // currently serving a trip on a *different* route (e.g. a bus that
    // does Route 48 → Route 8 in one shift), the bus isn't actually
    // running our route right now — don't plot it on the route map.
    if (tripMeta?.routeId && tripMeta.routeId !== routeId) continue;
    const orientation =
      typeof status.orientation === "number"
        ? status.orientation
        : typeof status.lastKnownOrientation === "number"
          ? status.lastKnownOrientation
          : undefined;
    const effectiveRouteId = tripMeta?.routeId ?? routeId;
    const routeRef = routes.get(effectiveRouteId);
    vehicles.push({
      tripId,
      routeId: effectiveRouteId,
      routeShortName: routeRef?.shortName,
      vehicleId: status.vehicleId,
      lat,
      lon,
      orientation:
        orientation != null && Number.isFinite(orientation)
          ? ((orientation % 360) + 360) % 360
          : undefined,
      headsign: tripMeta?.headsign,
      directionId: tripMeta?.directionId,
      predicted: Boolean(status.predicted),
      scheduleDeviationSec: status.scheduleDeviation ?? 0,
      lastUpdateMs:
        status.lastLocationUpdateTime || status.lastUpdateTime || serverTimeMs,
      occupancyStatus: status.occupancyStatus || undefined,
    });
  }
  return { routeId, serverTimeMs, vehicles };
}

export function normalizeAgencyCoverage(
  list: Array<{ agencyId: string; lat: number; lon: number; latSpan: number; lonSpan: number }>,
  refs: References | undefined
): AgencyCoverage[] {
  const names = agencyNameMap(refs);
  return list.map((e) => ({
    agencyId: e.agencyId,
    name: names.get(e.agencyId) ?? e.agencyId,
    lat: e.lat,
    lon: e.lon,
    latSpan: e.latSpan,
    lonSpan: e.lonSpan,
  }));
}
