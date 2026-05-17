import type {
  AgencyCoverage,
  ArrivalPunctuality,
  ArrivalRow,
  ArrivalsForStopResponse,
  RouteShape,
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
