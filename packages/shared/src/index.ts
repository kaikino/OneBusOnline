export * from "./bbox.js";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  code?: string;
  /** Compass direction of travel past the stop, e.g. "NW". */
  direction?: string;
  /** Only set on search results when the search had an origin. */
  distanceMeters?: number;
  routeIds: string[];
}

export type Punctuality = "on_time" | "early" | "late" | "scheduled";

export interface Arrival {
  tripId: string;
  routeId: string;
  routeShortName: string;
  headsign: string;
  scheduledTimeMs: number;
  /** Predicted time when real-time data exists, otherwise the scheduled time. */
  arrivalTimeMs: number;
  punctuality: Punctuality;
  /** Seconds behind (positive) or ahead of (negative) schedule. */
  deviationSec: number;
}

export interface ArrivalsResponse {
  stopId: string;
  arrivals: Arrival[];
}

export interface RouteShape {
  routeId: string;
  /** Google-encoded polylines. */
  polylines: string[];
}

export interface Vehicle {
  tripId: string;
  vehicleId?: string;
  routeShortName: string;
  headsign?: string;
  lat: number;
  lon: number;
  /** Degrees clockwise from north. */
  heading?: number;
  /** False when the position is interpolated from the schedule. */
  hasGps: boolean;
  /** Whether the trip has real-time schedule data. */
  predicted: boolean;
  deviationSec: number;
  lastUpdateMs: number;
  occupancy?: string;
}
