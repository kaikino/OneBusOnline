import type { ArrivalRow } from "@onebus/shared";

/**
 * Composite filter: same route AND same direction (headsign).
 * `headsign` is stored as a normalized key (trim + lowercase + collapsed whitespace)
 * so minor inconsistencies in OBA data ("Bellevue", "Bellevue ", "BELLEVUE") match.
 */
export type RouteFilter = { routeId: string; headsign: string };

export function headsignKey(h: string | undefined | null): string {
  return (h ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function rowMatchesFilter(
  row: ArrivalRow,
  filter: RouteFilter | null,
): boolean {
  if (!filter) return true;
  return (
    row.routeId === filter.routeId &&
    headsignKey(row.headsign) === filter.headsign
  );
}
