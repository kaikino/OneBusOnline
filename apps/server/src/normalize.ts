import type { Arrival, LatLon, Punctuality, Stop } from "@onebus/shared";
import type OnebusawaySDK from "onebusaway-sdk";
import { haversineMeters } from "./geo.js";

type ObaStop = OnebusawaySDK.StopsForLocationListResponse.Data.List;
type ObaArrival =
  OnebusawaySDK.ArrivalAndDepartureListResponse.Data.Entry.ArrivalsAndDeparture;

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
