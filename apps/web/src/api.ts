import type { ArrivalsResponse, Bbox, LatLon, Stop } from "@onebus/shared";

const BASE_URL = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/v1`;

type Params = Record<string, string | number | undefined>;

async function get<T>(path: string, params: Params = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, String(value));
  }
  const res = await fetch(`${BASE_URL}${path}?${query}`);
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export const fetchStopsSnapshot = () => get<Stop[]>("/stops/snapshot");

export const fetchStopsInBbox = (bbox: Bbox) => get<Stop[]>("/stops/bbox", { ...bbox });

export const searchStops = (q: string, origin?: LatLon) =>
  get<Stop[]>("/stops/search", { q, ...origin });

export const fetchArrivals = (stopId: string, minutesAfter: number) =>
  get<ArrivalsResponse>(`/stops/${encodeURIComponent(stopId)}/arrivals`, { minutesAfter });
