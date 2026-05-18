import type { Arrival, LatLon, Punctuality, RouteShape, Stop, Vehicle } from "@onebus/shared";
import type OnebusawaySDK from "onebusaway-sdk";
import { haversineMeters } from "./geo.js";

type ObaStop = OnebusawaySDK.StopsForLocationListResponse.Data.List;
type ObaArrival =
  OnebusawaySDK.ArrivalAndDepartureListResponse.Data.Entry.ArrivalsAndDeparture;
type ObaRouteEntry = OnebusawaySDK.StopsForRouteListResponse.Data.Entry;
type ObaTrips = OnebusawaySDK.TripsForRouteListResponse.Data;

const ON_TIME_TOLERANCE_SEC = 90;

export function toStop(stop: ObaStop): Stop {
  return {
    id: stop.id,
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    code: stop.code,
    direction: stop.direction,
    routeIds: stop.routeIds,
  };
}

export function byDistanceFrom(origin: LatLon, stops: Stop[]): Stop[] {
  return stops
    .map((stop) => ({
      ...stop,
      distanceMeters: Math.round(haversineMeters(origin.lat, origin.lon, stop.lat, stop.lon)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function punctuality(predicted: boolean, deviationSec: number): Punctuality {
  if (!predicted) return "scheduled";
  if (deviationSec > ON_TIME_TOLERANCE_SEC) return "late";
  if (deviationSec < -ON_TIME_TOLERANCE_SEC) return "early";
  return "on_time";
}

export function toArrival(arrival: ObaArrival): Arrival {
  const predicted = Boolean(arrival.predicted) && arrival.predictedArrivalTime > 0;
  const arrivalTimeMs = predicted ? arrival.predictedArrivalTime : arrival.scheduledArrivalTime;
  const deviationSec = Math.round((arrivalTimeMs - arrival.scheduledArrivalTime) / 1000);
  return {
    tripId: arrival.tripId,
    routeId: arrival.routeId,
    routeShortName: arrival.routeShortName || arrival.routeLongName || arrival.routeId,
    headsign: arrival.tripHeadsign,
    scheduledTimeMs: arrival.scheduledArrivalTime,
    arrivalTimeMs,
    punctuality: punctuality(predicted, deviationSec),
    deviationSec,
  };
}

export function toRouteShape(routeId: string, entry: ObaRouteEntry): RouteShape {
  const points = (lines?: { points?: string }[]) =>
    (lines ?? []).flatMap((line) => (line.points ? [line.points] : []));
  const polylines = points(entry.polylines);
  return {
    routeId,
    // Some agencies only attach polylines to their stop groupings.
    polylines:
      polylines.length > 0
        ? polylines
        : (entry.stopGroupings ?? []).flatMap((group) => points(group.polylines)),
  };
}

/** OBA orientation is counter-clockwise from east; map headings are clockwise from north. */
function toHeading(orientation: number): number {
  return (((90 - orientation) % 360) + 360) % 360;
}

export function toVehicles(routeId: string, { list, references }: ObaTrips): Vehicle[] {
  const trips = new Map(references.trips.map((trip) => [trip.id, trip]));
  const route = references.routes.find((r) => r.id === routeId);
  const routeShortName = route?.shortName || route?.longName || routeId;

  const byVehicle = new Map<string, Vehicle>();
  for (const { tripId: listedTripId, status } of list) {
    const position = status?.position ?? status?.lastKnownLocation;
    if (position?.lat === undefined || position.lon === undefined) continue;

    // A bus can be listed under a later trip of its block while still serving
    // another route; only plot it when its active trip is on this route.
    const tripId = status.activeTripId || listedTripId;
    const trip = trips.get(tripId);
    if (trip?.routeId !== routeId) continue;

    const orientation = status.orientation ?? status.lastKnownOrientation;
    const hasGps = (status.lastLocationUpdateTime ?? 0) > 0;
    const vehicle: Vehicle = {
      tripId,
      vehicleId: status.vehicleId,
      routeShortName,
      headsign: trip.tripHeadsign,
      lat: position.lat,
      lon: position.lon,
      heading: orientation === undefined ? undefined : toHeading(orientation),
      hasGps,
      predicted: status.predicted,
      deviationSec: status.scheduleDeviation,
      lastUpdateMs: (hasGps ? status.lastLocationUpdateTime : status.lastUpdateTime) || Date.now(),
      occupancy: status.occupancyStatus || undefined,
    };

    const key = vehicle.vehicleId ?? tripId;
    const existing = byVehicle.get(key);
    if (!existing || vehicle.lastUpdateMs >= existing.lastUpdateMs) byVehicle.set(key, vehicle);
  }
  return [...byVehicle.values()];
}
