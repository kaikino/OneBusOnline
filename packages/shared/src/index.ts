export type { BboxParams } from "./bbox.js";
export {
  bboxContainsOuter,
  quantizeBboxForCache,
  stopsBboxCacheKey,
} from "./bbox.js";

export interface StopSummary {
  id: string;
  name: string;
  lat: number;
  lon: number;
  code?: string;
  direction?: string;
  distanceMeters?: number;
  routeIds: string[];
}

export interface AgencyCoverage {
  agencyId: string;
  name: string;
  lat: number;
  lon: number;
  latSpan: number;
  lonSpan: number;
}

export type ArrivalPunctuality = "on_time" | "early" | "late" | "scheduled_only";

export interface ArrivalRow {
  tripId: string;
  routeId: string;
  routeShortName: string;
  routeLongName?: string;
  headsign: string;
  stopId: string;
  scheduledArrivalTimeMs: number;
  predictedArrivalTimeMs: number;
  predicted: boolean;
  scheduleDeviationSec?: number;
  punctuality: ArrivalPunctuality;
  numberOfStopsAway: number;
  vehicleId?: string;
}

export interface ArrivalsForStopResponse {
  stopId: string;
  serverTimeMs: number;
  arrivals: ArrivalRow[];
}

/**
 * Geometry + ordered stop list for a single route, as returned by OBA's
 * `stops-for-route`. `polylines` are encoded Google polyline strings —
 * decode on the client to render.
 */
export interface RouteShape {
  routeId: string;
  polylines: string[];
  stopIds: string[];
}

/** Live vehicle position for an active trip on a route. */
export interface RouteVehicle {
  tripId: string;
  routeId: string;
  routeShortName?: string;
  vehicleId?: string;
  lat: number;
  lon: number;
  /** Degrees, 0 = north, clockwise. Absent when OBA didn't report orientation. */
  orientation?: number;
  headsign?: string;
  directionId?: string;
  /** Real-time arrival/adjustment data (not the same as AVL position source). */
  predicted: boolean;
  /** True only when OBA reports an actual vehicle location ping (non-zero lastLocationUpdateTime), not schedule interpolation. */
  liveGpsPosition: boolean;
  scheduleDeviationSec: number;
  /** Best-effort update time: last GPS fix when `liveGpsPosition`, else last trip status time or server clock. */
  lastUpdateMs: number;
  occupancyStatus?: string;
}

export interface RouteVehiclesResponse {
  routeId: string;
  serverTimeMs: number;
  vehicles: RouteVehicle[];
}

export interface HealthResponse {
  ok: boolean;
  obaConfigured: boolean;
  obaApiHost?: string;
  serverTimeMs?: number;
  error?: string;
  stopListCache?: "redis" | "memory" | "none";
}
