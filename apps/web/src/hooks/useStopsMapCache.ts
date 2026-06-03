import type { StopSummary } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bboxContainsOuter,
  fetchStopsBbox,
  fetchStopsSnapshot,
  quantizeBboxForCache,
  type BboxParams,
} from "../api";
import { loadPersistedStops, savePersistedStops } from "../stopsPersistence";
import type { ViewportBbox } from "../components/map/ViewportReporter";

const MIN_ZOOM_SHOW_STOPS = 0;
const MIN_ZOOM_FETCH_STOPS = 13;

/** FNV-1a 32-bit hash — fast, stable, good distribution for thinning. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Percentage of stops to show at a given zoom level.
 * At the fetch threshold and above, show 100%.
 * Below that, thin proportionally down to a small fraction.
 */
function stopVisibilityPct(zoom: number): number {
  if (zoom >= 14) return 100;
  if (zoom >= 13.5) return 50;
  if (zoom >= 13) return 25;
  if (zoom >= 12) return 10;
  if (zoom >= 11) return 5;

  return 1;
}

type Viewport = { bbox: ViewportBbox; zoom: number };

/**
 * Owns the merged stops cache (IndexedDB + snapshot + viewport bbox fetches)
 * and derives the thinned set of stops to plot for the current viewport.
 */
export function useStopsMapCache(selectedId: string | undefined): {
  stopsToPlot: StopSummary[];
  stopsLoading: boolean;
  onViewportChange: (v: Viewport) => void;
} {
  const [viewport, setViewport] = useState<Viewport | null>(null);

  const onViewportChange = useCallback((v: Viewport) => {
    setViewport(v);
  }, []);

  const zoomOkForFetch = viewport != null && viewport.zoom >= MIN_ZOOM_FETCH_STOPS;

  const [lastNetworkBbox, setLastNetworkBbox] = useState<BboxParams | null>(null);
  const [mergeEpoch, setMergeEpoch] = useState(0);
  const [idbReady, setIdbReady] = useState(false);
  const stopsMergedRef = useRef<Map<string, StopSummary>>(new Map());

  useEffect(() => {
    void (async () => {
      const [persisted, snapshot] = await Promise.all([
        loadPersistedStops(),
        fetchStopsSnapshot(),
      ]);
      for (const [id, s] of persisted.byId) stopsMergedRef.current.set(id, s);
      for (const s of snapshot) stopsMergedRef.current.set(s.id, s);
      setLastNetworkBbox(persisted.lastNetworkBbox);
      setMergeEpoch((e) => e + 1);
      setIdbReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!idbReady) return;
    const t = setTimeout(() => {
      void savePersistedStops(stopsMergedRef.current, lastNetworkBbox);
    }, 2000);
    return () => clearTimeout(t);
  }, [idbReady, mergeEpoch, lastNetworkBbox]);

  const quantized = viewport ? quantizeBboxForCache(viewport.bbox) : null;

  /** Viewport not covered by a prior successful fetch (full or cache hit). */
  const viewportNeedsHydration = Boolean(
    quantized &&
      (!lastNetworkBbox || !bboxContainsOuter(lastNetworkBbox, quantized))
  );

  const stopsQuery = useQuery({
    queryKey: ["stopsBbox", quantized],
    queryFn: async () => {
      const rows = await fetchStopsBbox(viewport!.bbox, { cacheOnly: false });
      for (const s of rows) stopsMergedRef.current.set(s.id, s);
      setLastNetworkBbox(quantizeBboxForCache(viewport!.bbox));
      setMergeEpoch((e) => e + 1);
      return rows;
    },
    enabled: Boolean(viewport && zoomOkForFetch && viewportNeedsHydration && idbReady),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const stopsToPlot = useMemo(() => {
    if (!viewport || viewport.zoom < MIN_ZOOM_SHOW_STOPS) return [];
    const { minLat, maxLat, minLon, maxLon } = viewport.bbox;
    const pct = stopVisibilityPct(viewport.zoom);
    return [...stopsMergedRef.current.values()].filter((s) => {
      if (s.lat < minLat || s.lat > maxLat || s.lon < minLon || s.lon > maxLon)
        return false;
      if (pct >= 100 || s.id === selectedId) return true;
      return fnv1a(s.id) % 100 < pct;
    });
  }, [viewport, mergeEpoch, selectedId]);

  const stopsLoading = viewportNeedsHydration && stopsQuery.isFetching;

  return { stopsToPlot, stopsLoading, onViewportChange };
}
