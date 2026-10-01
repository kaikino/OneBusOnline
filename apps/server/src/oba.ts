import {
  type ArrivalsResponse,
  type Bbox,
  type LatLon,
  type RouteShape,
  type Stop,
  type Vehicle,
  bboxContainsPoint,
  quantizeBbox,
} from "@onebus/shared";
import OnebusawaySDK, { NotFoundError } from "onebusaway-sdk";
import { cached } from "./cache.js";
import { byDistanceFrom, toArrivals, toRouteShape, toStop, toVehicles } from "./normalize.js";

const TTL_SEC = { stops: 600, arrivals: 25, vehicles: 15, routeShape: 86_400 };

/** OBA caps each stop query, so crowded boxes are split into quadrants, up to this many calls. */
const MAX_CALLS_PER_BBOX = 36;
const MIN_SPLIT_SPAN_DEG = 2e-4;
/** OBA drops stops lying right on the edge of the queried box, so a little more is requested. */
const QUERY_MARGIN_DEG = 1e-4;

const SEARCH_MAX_RESULTS = 30;
const SEARCH_RADIUS_M = 50_000;
const DEFAULT_SEARCH_ORIGIN: LatLon = { lat: 47.6062, lon: -122.3321 };

const apiKey = process.env.ONEBUSAWAY_API_KEY?.trim();

export const obaConfigured = Boolean(apiKey);

const client = new OnebusawaySDK({
  apiKey: apiKey ?? "",
  baseURL: process.env.OBA_BASE_URL?.trim() || undefined,
  maxRetries: 5,
  timeout: 25_000,
});

export function stopsInBbox(bbox: Bbox): Promise<Stop[]> {
  const q = quantizeBbox(bbox);
  const key = `stops:${q.minLat}:${q.minLon}:${q.maxLat}:${q.maxLon}`;
  return cached(key, TTL_SEC.stops, async () => {
    const stops = await fetchStops(q, { callsLeft: MAX_CALLS_PER_BBOX });
    return [...new Map(stops.map((stop) => [stop.id, stop])).values()];
  });
}

async function fetchStops(bbox: Bbox, budget: { callsLeft: number }): Promise<Stop[]> {
  if (budget.callsLeft <= 0) return [];
  budget.callsLeft -= 1;

  const latSpan = bbox.maxLat - bbox.minLat;
  const lonSpan = bbox.maxLon - bbox.minLon;
  const midLat = bbox.minLat + latSpan / 2;
  const midLon = bbox.minLon + lonSpan / 2;
  const { data } = await client.stopsForLocation.list({
    lat: midLat,
    lon: midLon,
    latSpan: latSpan + QUERY_MARGIN_DEG,
    lonSpan: lonSpan + QUERY_MARGIN_DEG,
  });

  const canSplit = Math.min(latSpan, lonSpan) > MIN_SPLIT_SPAN_DEG && budget.callsLeft > 0;
  if (!data.limitExceeded || !canSplit) {
    return data.list.filter((stop) => bboxContainsPoint(bbox, stop.lat, stop.lon)).map(toStop);
  }

  const quadrants: Bbox[] = [
    { ...bbox, maxLat: midLat, maxLon: midLon },
    { ...bbox, maxLat: midLat, minLon: midLon },
    { ...bbox, minLat: midLat, maxLon: midLon },
    { ...bbox, minLat: midLat, minLon: midLon },
  ];
  const stops: Stop[] = [];
  for (const quadrant of quadrants) stops.push(...(await fetchStops(quadrant, budget)));
  return stops;
}

export function searchStops(query: string, origin?: LatLon): Promise<Stop[]> {
  const originKey = origin ? `${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}` : "";
  return cached(`search:${query.toLowerCase()}:${originKey}`, TTL_SEC.stops, async () => {
    const stops = (await searchByName(query)) ?? (await searchByCode(query, origin));
    return origin ? byDistanceFrom(origin, stops) : stops;
  });
}

async function searchByName(query: string): Promise<Stop[] | null> {
  try {
    const { data } = await client.searchForStop.list({
      input: query,
      maxCount: SEARCH_MAX_RESULTS,
    });
    return data?.list.map(toStop) ?? null;
  } catch (err) {
    // OBA answers 404 rather than an empty list when nothing matches.
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

async function searchByCode(code: string, origin = DEFAULT_SEARCH_ORIGIN): Promise<Stop[]> {
  const { data } = await client.stopsForLocation.list({
    ...origin,
    radius: SEARCH_RADIUS_M,
    query: code,
  });
  return data.list.map(toStop);
}

export function arrivalsForStop(
  stopId: string,
  minutesAfter: number,
  minutesBefore: number,
): Promise<ArrivalsResponse> {
  return cached(`arrivals:${stopId}:${minutesAfter}:${minutesBefore}`, TTL_SEC.arrivals, async () => {
    const { data } = await client.arrivalAndDeparture.list(stopId, {
      minutesAfter,
      minutesBefore,
    });
    return { stopId, arrivals: toArrivals(data.entry.arrivalsAndDepartures) };
  });
}

export function routeShape(routeId: string): Promise<RouteShape> {
  return cached(`shape:${routeId}`, TTL_SEC.routeShape, async () => {
    const { data } = await client.stopsForRoute.list(routeId, { includePolylines: true });
    return toRouteShape(routeId, data.entry);
  });
}

export function routeVehicles(routeId: string): Promise<Vehicle[]> {
  return cached(`vehicles:${routeId}`, TTL_SEC.vehicles, async () => {
    const { data } = await client.tripsForRoute.list(routeId, { includeStatus: true });
    return toVehicles(routeId, data);
  });
}
