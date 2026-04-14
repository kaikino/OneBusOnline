import type { StopSummary } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import type L from "leaflet";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  bboxContainsOuter,
  fetchStopsBbox,
  quantizeBboxForCache,
  type BboxParams,
} from "../api";
import { loadPersistedStops, savePersistedStops } from "../stopsPersistence";

const STOP_MARKER_RADIUS = 4.5;
const VIEWPORT_DEBOUNCE_MS = 100;
const DEFAULT_CENTER: [number, number] = [47.6062, -122.3321];
const DEFAULT_ZOOM = 13;
const MIN_ZOOM_STOPS = 13;
const SMOOTH_ZOOM_SPEED = 0.03;
const WHEEL_SETTLE_MS = 150;

type ViewportBbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

function boundsToBbox(bounds: { getSouthWest: () => { lat: number; lng: number }; getNorthEast: () => { lat: number; lng: number } }): ViewportBbox {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return {
    minLat: sw.lat,
    minLon: sw.lng,
    maxLat: ne.lat,
    maxLon: ne.lng,
  };
}

function ViewportReporter({
  onViewportChange,
}: {
  onViewportChange: (v: { bbox: ViewportBbox; zoom: number }) => void;
}) {
  const map = useMap();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    onViewportChange({
      bbox: boundsToBbox(map.getBounds()),
      zoom: map.getZoom(),
    });
  }, [map, onViewportChange]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, VIEWPORT_DEBOUNCE_MS);
  }, [flush]);

  useMapEvents({
    moveend: schedule,
    zoomend: schedule,
    resize: schedule,
  });

  useEffect(() => {
    const container = map.getContainer();
    const onContainerResize = () => {
      map.invalidateSize({ animate: false });
      schedule();
    };
    const ro = new ResizeObserver(onContainerResize);
    ro.observe(container);
    const onWinResize = () => {
      map.invalidateSize({ animate: false });
      schedule();
    };
    window.addEventListener("resize", onWinResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
    };
  }, [map, schedule]);

  useEffect(() => {
    let id2: number | undefined;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        flush();
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2 !== undefined) cancelAnimationFrame(id2);
    };
  }, [map, flush]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return null;
}

type MapZoomInternals = L.Map & {
  _animatingZoom?: boolean;
  _mapPane?: HTMLElement;
};

function SmoothWheelZoom() {
  const map = useMap();

  useEffect(() => {
    let accumulated = 0;
    let mousePos: L.Point | null = null;
    let rafId: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let zooming = false;
    let targetZoom = map.getZoom();
    const m = map as MapZoomInternals;

    function beginZoom() {
      if (zooming) return;
      zooming = true;
      targetZoom = map.getZoom();
      m._animatingZoom = true;
      m._mapPane?.classList.add("leaflet-zoom-anim");
    }

    function endZoom() {
      if (!zooming) return;
      zooming = false;
      m._animatingZoom = false;
      m._mapPane?.classList.remove("leaflet-zoom-anim");
      if (mousePos) {
        map.setZoomAround(mousePos, targetZoom, { animate: false });
      }
    }

    function apply() {
      rafId = null;
      if (!accumulated || !mousePos) return;

      beginZoom();

      const delta = accumulated * SMOOTH_ZOOM_SPEED;
      accumulated = 0;

      targetZoom = Math.max(
        map.getMinZoom(),
        Math.min(map.getMaxZoom(), targetZoom + delta)
      );

      const scale = map.getZoomScale(targetZoom);
      const viewHalf = map.getSize().divideBy(2);
      const centerOffset = mousePos
        .subtract(viewHalf)
        .multiplyBy(1 - 1 / scale);
      const center = map.containerPointToLatLng(viewHalf.add(centerOffset));

      map.fire("zoomanim", { center, zoom: targetZoom, noUpdate: true });

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(endZoom, WHEEL_SETTLE_MS);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      const raw =
        e.deltaMode === 1
          ? e.deltaY * 20
          : e.deltaMode === 2
            ? e.deltaY * 60
            : e.deltaY;
      accumulated -= raw;
      mousePos = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      if (rafId === null) rafId = requestAnimationFrame(apply);
    }

    const el = map.getContainer();
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimer) clearTimeout(settleTimer);
      if (zooming) endZoom();
    };
  }, [map]);

  return null;
}

function FlyTo(props: { lat: number; lon: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([props.lat, props.lon], props.zoom ?? 15, { duration: 1 });
  }, [map, props.lat, props.lon, props.zoom]);
  return null;
}

function stopsFingerprint(stops: StopSummary[]): string {
  if (stops.length === 0) return "";
  return stops.map((s) => `${s.id}:${s.lat.toFixed(5)}:${s.lon.toFixed(5)}`).join("|");
}

const StopMarkersLayer = memo(
  function StopMarkersLayer(props: {
    stops: StopSummary[];
    selectedId: string | undefined;
    onSelectStop: (s: StopSummary) => void;
  }) {
    return (
      <>
        {props.stops.map((s) => {
          const selected = props.selectedId === s.id;
          return (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lon]}
              radius={STOP_MARKER_RADIUS}
              pathOptions={{
                color: selected ? "#ffffff" : "#0f172a",
                fillColor: selected ? "#e11d48" : "#facc15",
                fillOpacity: selected ? 1 : 0.5,
                weight: 2,
                className: "map-stop-marker",
              }}
              eventHandlers={{
                click: () => props.onSelectStop(s),
              }}
            />
          );
        })}
      </>
    );
  },
  (prev, next) =>
    prev.selectedId === next.selectedId &&
    prev.onSelectStop === next.onSelectStop &&
    stopsFingerprint(prev.stops) === stopsFingerprint(next.stops)
);

export function TransitMap(props: {
  agencyCenter?: { lat: number; lon: number };
  userLat?: number;
  userLon?: number;
  selectedStop: StopSummary | null;
  onSelectStop: (s: StopSummary) => void;
}) {
  const [viewport, setViewport] = useState<{
    bbox: ViewportBbox;
    zoom: number;
  } | null>(null);
  const onSelectRef = useRef(props.onSelectStop);
  onSelectRef.current = props.onSelectStop;
  const stableSelectStop = useCallback((s: StopSummary) => {
    onSelectRef.current(s);
  }, []);

  const onViewportChange = useCallback((v: { bbox: ViewportBbox; zoom: number }) => {
    setViewport(v);
  }, []);

  const zoomOkForStops = viewport != null && viewport.zoom >= MIN_ZOOM_STOPS;

  const [lastNetworkBbox, setLastNetworkBbox] = useState<BboxParams | null>(null);
  const [mergeEpoch, setMergeEpoch] = useState(0);
  const [idbReady, setIdbReady] = useState(false);
  const stopsMergedRef = useRef<Map<string, StopSummary>>(new Map());

  useEffect(() => {
    void loadPersistedStops()
      .then(({ byId, lastNetworkBbox: last }) => {
        for (const [id, s] of byId) stopsMergedRef.current.set(id, s);
        setLastNetworkBbox(last);
        setMergeEpoch((e) => e + 1);
      })
      .finally(() => {
        setIdbReady(true);
      });
  }, []);

  useEffect(() => {
    if (!idbReady) return;
    const t = setTimeout(() => {
      void savePersistedStops(stopsMergedRef.current, lastNetworkBbox);
    }, 2000);
    return () => clearTimeout(t);
  }, [idbReady, mergeEpoch, lastNetworkBbox]);

  const quantized = viewport ? quantizeBboxForCache(viewport.bbox) : null;

  const needsNetworkFetch = Boolean(
    quantized &&
      zoomOkForStops &&
      (!lastNetworkBbox || !bboxContainsOuter(lastNetworkBbox, quantized))
  );

  const stopsQuery = useQuery({
    queryKey: ["stopsBbox", quantized],
    queryFn: async () => {
      const rows = await fetchStopsBbox(viewport!.bbox);
      for (const s of rows) stopsMergedRef.current.set(s.id, s);
      setLastNetworkBbox(quantizeBboxForCache(viewport!.bbox));
      setMergeEpoch((e) => e + 1);
      return rows;
    },
    enabled: Boolean(
      viewport && zoomOkForStops && needsNetworkFetch && idbReady
    ),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const initialCenter = props.agencyCenter
    ? ([props.agencyCenter.lat, props.agencyCenter.lon] as [number, number])
    : DEFAULT_CENTER;

  const flyUser =
    props.userLat !== undefined && props.userLon !== undefined ? (
      <FlyTo lat={props.userLat} lon={props.userLon} zoom={15} />
    ) : null;

  const stopsToPlot = useMemo(() => {
    if (!viewport || !zoomOkForStops) return [];
    const { minLat, maxLat, minLon, maxLon } = viewport.bbox;
    return [...stopsMergedRef.current.values()].filter(
      (s) =>
        s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon
    );
  }, [viewport, zoomOkForStops, mergeEpoch]);

  const stopsLoading = needsNetworkFetch && stopsQuery.isFetching;

  return (
    <div className="relative h-full w-full">
      {stopsLoading ? (
        <span className="sr-only" aria-live="polite">
          Loading stops…
        </span>
      ) : null}
    <MapContainer
      center={initialCenter}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full"
      scrollWheelZoom={false}
      preferCanvas
      zoomSnap={0}
      zoomDelta={1}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        keepBuffer={4}
      />
      <SmoothWheelZoom />
      <ViewportReporter onViewportChange={onViewportChange} />
      {flyUser}
      {props.userLat !== undefined && props.userLon !== undefined ? (
        <CircleMarker
          center={[props.userLat, props.userLon]}
          radius={4}
          pathOptions={{
            color: "#38bdf8",
            fillColor: "#0ea5e9",
            fillOpacity: 0.9,
            weight: 2,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent={false}>
            You are here
          </Tooltip>
        </CircleMarker>
      ) : null}
      <StopMarkersLayer
        stops={stopsToPlot}
        selectedId={props.selectedStop?.id}
        onSelectStop={stableSelectStop}
      />
    </MapContainer>
    </div>
  );
}
