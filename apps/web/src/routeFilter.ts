/** A route in one direction of travel. */
export interface RouteFilter {
  routeId: string;
  headsign: string;
}

export function matchesRoute(
  filter: RouteFilter,
  trip: { routeId: string; headsign?: string },
): boolean {
  return trip.routeId === filter.routeId && trip.headsign === filter.headsign;
}
