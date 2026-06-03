import { type Bbox, type Stop, bboxContains, bboxContainsPoint, quantizeBbox } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchStopsInBbox, fetchStopsSnapshot } from "../api";
import { loadSavedStops, saveStops } from "../lib/stopsStore";

export interface Viewport {
  bbox: Bbox;
  zoom: number;
}

const MIN_FETCH_ZOOM = 13;
const SAVE_DELAY_MS = 2000;

/** Percentage of known stops drawn at a zoom level, to keep zoomed-out views readable. */
function visiblePercent(zoom: number): number {
  if (zoom >= 14) return 100;
  if (zoom >= 13.5) return 50;
  if (zoom >= 13) return 25;
  if (zoom >= 12) return 10;
  if (zoom >= 11) return 5;
  return 1;
}

/** FNV-1a hash mapped to 0-99, so the same stops stay visible as the map moves. */
function samplingRank(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Accumulates every stop seen so far (saved locally, cached on the server, or
 * fetched for a viewport) and returns the ones to draw for `viewport`.
 */
export function useStops(viewport: Viewport | null): Stop[] {
  const [stops, setStops] = useState<ReadonlyMap<string, Stop>>(new Map());
  const [fetchedBbox, setFetchedBbox] = useState<Bbox | null>(null);

  const merge = useCallback((incoming: Stop[]) => {
    if (incoming.length === 0) return;
    setStops((known) => {
      const merged = new Map(known);
      for (const stop of incoming) merged.set(stop.id, stop);
      return merged;
    });
  }, []);

  useEffect(() => {
    void loadSavedStops().then(merge);
    fetchStopsSnapshot().then(merge, () => {});
  }, [merge]);

  useEffect(() => {
    if (stops.size === 0) return;
    const id = setTimeout(() => void saveStops([...stops.values()]), SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [stops]);

  const bbox = viewport && viewport.zoom >= MIN_FETCH_ZOOM ? quantizeBbox(viewport.bbox) : null;
  const alreadyFetched = bbox !== null && fetchedBbox !== null && bboxContains(fetchedBbox, bbox);

  const { data: fetched } = useQuery({
    queryKey: ["stops", bbox],
    queryFn: async () => ({ bbox: bbox!, stops: await fetchStopsInBbox(bbox!) }),
    enabled: bbox !== null && !alreadyFetched,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!fetched) return;
    merge(fetched.stops);
    setFetchedBbox(fetched.bbox);
  }, [fetched, merge]);

  return useMemo(() => {
    if (!viewport) return [];
    const percent = visiblePercent(viewport.zoom);
    return [...stops.values()].filter(
      (stop) =>
        bboxContainsPoint(viewport.bbox, stop.lat, stop.lon) && samplingRank(stop.id) < percent,
    );
  }, [stops, viewport]);
}
