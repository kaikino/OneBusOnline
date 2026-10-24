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
  punctuality: Punctuality;
  deviationSec: number;
  lastUpdateMs: number;
  occupancy?: string;
}

/** A weekly "notify me before this bus" reminder for one route and direction at a stop. */
export interface Reminder {
  id: string;
  stopId: string;
  stopName: string;
  routeId: string;
  routeShortName: string;
  headsign: string;
  /** Scheduled arrival at the stop, "HH:MM" in 24-hour time. */
  time: string;
  /** Days of the week it repeats on, 0 = Sunday. */
  days: number[];
  /** "YYYY-MM-DD" for a one-time reminder, which ignores `days`. */
  date?: string;
  minutesBefore: number;
  enabled: boolean;
}

/** `PushSubscription.toJSON()`. */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Replaces every reminder registered for a device. */
export interface ReminderSync {
  subscription: PushSubscriptionJson;
  timeZone: string;
  reminders: Reminder[];
}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  stopId?: string;
}
