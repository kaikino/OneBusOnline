import type { StopSummary } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import type L from "leaflet";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import leaflet from "leaflet";
import {
  MapContainer,
  Marker,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  bboxContainsOuter,
  fetchStopsBbox,
  fetchStopsSnapshot,
  quantizeBboxForCache,
  type BboxParams,
} from "../api";
import { loadPersistedStops, savePersistedStops } from "../stopsPersistence";

const VIEWPORT_DEBOUNCE_MS = 100;
const ICON_SIZE = 24;
const ICON_HALF = ICON_SIZE / 2;

const USER_LOCATION_ICON = leaflet.divIcon({
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#22c55e;border:2.5px solid #fff;box-shadow:0 0 6px rgba(34,197,94,0.5);"></div>',
});

function directionToDegrees(direction?: string): number | null {
  if (!direction) return null;
  const d = direction.trim().toUpperCase();
  if (!d) return null;
  if (/^-?\d+(\.\d+)?$/.test(d)) {
    const n = Number(d);
    if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
  }
  const cardinal = d.replace(/[^NSEW]/g, "");
  const m: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
    E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
    W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return m[cardinal] ?? null;
}

const STOP_ICON_CACHE = new Map<string, L.DivIcon>();

function stopIcon(selected: boolean, dirDeg: number | null): L.DivIcon {
  const key = `${selected ? "s" : "u"}:${dirDeg ?? "x"}`;
  const cached = STOP_ICON_CACHE.get(key);
  if (cached) return cached;

  const dotSize = selected ? 18 : 18;
  const dotBorder = selected ? 2 : 2;
  const dotColor = selected ? "#facc15" : "#0ea5e9";
  const dotBorderColor = selected ? "#ffffff" : "#0f172a";
  const dotOpacity = selected ? 1 : 0.7;
  const dotOffset = (ICON_SIZE - dotSize) / 2;

  let html = "";

  if (dirDeg != null) {
    const triW = 12;
    const triH = 8;
    const triColor = selected ? "#facc15" : "#0ea5e9";
    const triLeft = (ICON_SIZE - triW) / 2;
    const triTop = (ICON_SIZE - triH) / 2;
    html += `<div style="position:absolute;left:${triLeft}px;top:${triTop}px;width:${triW}px;height:${triH}px;clip-path:polygon(50% 0%,0% 100%,100% 100%);background:${triColor};outline:1px solid #fff;transform:rotate(${dirDeg}deg) translateY(-${ICON_HALF - 1}px);transform-origin:50% 50%;"></div>`;
  }

  html += `<div style="position:absolute;left:${dotOffset}px;top:${dotOffset}px;width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dotColor};border:${dotBorder}px solid ${dotBorderColor};opacity:${dotOpacity};"></div>`;

  const icon = leaflet.divIcon({
    className: "",
    iconSize: [ICON_SIZE, ICON_SIZE],
    iconAnchor: [ICON_HALF, ICON_HALF],
    html: `<div style="position:relative;width:${ICON_SIZE}px;height:${ICON_SIZE}px;">${html}</div>`,
  });
  STOP_ICON_CACHE.set(key, icon);
  return icon;
}
const DEFAULT_CENTER: [number, number] = [47.6062, -122.3321];
const DEFAULT_ZOOM = 13;
const MIN_ZOOM_SHOW_STOPS = 10;
const MIN_ZOOM_FETCH_STOPS = 15;

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
  if (zoom >= MIN_ZOOM_FETCH_STOPS) return 100;
  if (zoom >= 14) return 60;
  if (zoom >= 13) return 30;
  if (zoom >= 12) return 12;
  if (zoom >= 11) return 5;
  return 2;
}
const TRACKPAD_SCROLL_ZOOM_SPEED = 0.008;
const MOUSE_WHEEL_ZOOM_SPEED = 0.003;
const PINCH_ZOOM_SPEED = 0.03;
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

function SmoothWheelZoom() {
  const map = useMap();

  useEffect(() => {
    let accumulatedZoomDelta = 0;
    let isPinch = false;
    let mousePos: L.Point | null = null;
    let anchorLatLng: L.LatLng | null = null;
    let rafId: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let zooming = false;
    let targetZoom = map.getZoom();
    let targetCenter: L.LatLng | null = map.getCenter();

    function beginZoom() {
      if (zooming) return;
      zooming = true;
      targetZoom = map.getZoom();
      targetCenter = map.getCenter();
      // Do not set map._animatingZoom or leaflet-zoom-anim here. Leaflet uses
      // _animatingZoom internally; if we set it, setView/zoomIn return early and
      // ignore the new zoom until the flag clears — which breaks +/- buttons and
      // other zoom inputs while tiles load or during wheel settle.
    }

    function endZoom() {
      if (!zooming) return;
      zooming = false;
      if (targetCenter) {
        map.setView(targetCenter, targetZoom, { animate: false });
      } else if (mousePos) {
        map.setZoomAround(mousePos, targetZoom, { animate: false });
      }
    }

    function apply() {
      rafId = null;
      if (!accumulatedZoomDelta || !mousePos || !anchorLatLng) return;

      beginZoom();

      const delta = accumulatedZoomDelta;
      accumulatedZoomDelta = 0;

      targetZoom = Math.max(
        map.getMinZoom(),
        Math.min(map.getMaxZoom(), targetZoom + delta)
      );

      const viewHalf = map.getSize().divideBy(2);
      // Keep the geo point under the cursor fixed at `mousePos` for this target zoom.
      const anchorProjected = map.project(anchorLatLng, targetZoom);
      const centerProjected = anchorProjected.subtract(mousePos).add(viewHalf);
      targetCenter = map.unproject(centerProjected, targetZoom);

      map.fire("zoomanim", { center: targetCenter, zoom: targetZoom, noUpdate: true });

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
      isPinch = e.ctrlKey;
      const looksLikeMouseWheel =
        e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1);
      const speed = isPinch
        ? PINCH_ZOOM_SPEED
        : looksLikeMouseWheel
          ? MOUSE_WHEEL_ZOOM_SPEED
          : TRACKPAD_SCROLL_ZOOM_SPEED;
      accumulatedZoomDelta -= raw * speed;
      mousePos = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      anchorLatLng = map.containerPointToLatLng(mousePos);
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

/**
 * Two responsibilities:
 *
 * 1. **Prevent TouchZoom from using `_animateZoom`** — which sets
 *    `_animatingZoom = true` and blocks all subsequent drag/pan until a
 *    CSS transitionend or 250 ms timeout fires.  We temporarily flip
 *    `map.options.zoomAnimation` to `false` on the container-level
 *    `touchend` so that by the time TouchZoom's document-level handler
 *    runs, it takes the `_resetView` branch instead.
 *
 * 2. **Seamless pinch-to-pan** — when the user lifts one finger after a
 *    two-finger pinch, immediately begin panning with the remaining
 *    finger by invoking Leaflet's `Draggable._onDown` directly (Safari
 *    doesn't support the `TouchEvent` constructor).
 */
function PinchToPan() {
  const map = useMap();

  useEffect(() => {
    const el = map.getContainer();
    let wasPinching = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) wasPinching = true;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!wasPinching) return;

      if (e.touches.length < 2) {
        // A finger was lifted after a pinch.  Temporarily disable
        // zoomAnimation so Leaflet's TouchZoom handler (which fires on
        // `document`, after this container handler) chooses `_resetView`
        // instead of `_animateZoom`.  Restore on the next macrotask.
        map.options.zoomAnimation = false;
        setTimeout(() => {
          map.options.zoomAnimation = true;
        }, 0);
      }

      if (e.touches.length === 1) {
        wasPinching = false;

        const t = e.touches[0];
        const touchSnapshot = {
          pageX: t.pageX,
          pageY: t.pageY,
          clientX: t.clientX,
          clientY: t.clientY,
          screenX: t.screenX,
          screenY: t.screenY,
          identifier: t.identifier,
        };

        // Defer to next macrotask so (a) the current touchend finishes
        // propagating — otherwise _onDown's new document-level touchend
        // listener would catch THIS event — and (b) _resetView has
        // already completed, leaving no blocking state.
        setTimeout(() => {
          const draggable = (map as any).dragging?._draggable;
          if (!draggable || !draggable._enabled) return;

          el.classList.remove("leaflet-zoom-anim");
          (map as any)._animatingZoom = false;
          (leaflet as any).Draggable._dragging = false;

          draggable._onDown({
            type: "touchstart",
            touches: [touchSnapshot],
            target: el,
            preventDefault() {},
            stopPropagation() {},
          });
        }, 0);
      } else {
        wasPinching = e.touches.length >= 2;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [map]);

  return null;
}

function FlyTo(props: { lat: number; lon: number; zoom?: number; seq?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([props.lat, props.lon], props.zoom ?? 15, { duration: 1 });
  }, [map, props.lat, props.lon, props.zoom, props.seq]);
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
    const selectedStop = props.selectedId
      ? props.stops.find((s) => s.id === props.selectedId)
      : undefined;
    return (
      <>
        {props.stops.map((s) => {
          if (s.id === props.selectedId) return null;
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lon]}
              icon={stopIcon(false, directionToDegrees(s.direction))}
              eventHandlers={{
                click: () => props.onSelectStop(s),
              }}
            />
          );
        })}
        {selectedStop ? (
          <Marker
            key={`sel-${selectedStop.id}`}
            position={[selectedStop.lat, selectedStop.lon]}
            icon={stopIcon(true, directionToDegrees(selectedStop.direction))}
            eventHandlers={{
              click: () => props.onSelectStop(selectedStop),
            }}
          />
        ) : null}
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
  flyToLat?: number;
  flyToLon?: number;
  flyToSeq?: number;
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

  const fetchMode = zoomOkForFetch ? "full" : "cache";

  const stopsQuery = useQuery({
    queryKey: ["stopsBbox", quantized, fetchMode],
    queryFn: async () => {
      const cacheOnly = !zoomOkForFetch;
      const rows = await fetchStopsBbox(viewport!.bbox, { cacheOnly });
      for (const s of rows) stopsMergedRef.current.set(s.id, s);
      if (zoomOkForFetch || rows.length > 0) {
        setLastNetworkBbox(quantizeBboxForCache(viewport!.bbox));
      }
      setMergeEpoch((e) => e + 1);
      return rows;
    },
    enabled: Boolean(viewport && viewportNeedsHydration && idbReady),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const initialCenter = props.agencyCenter
    ? ([props.agencyCenter.lat, props.agencyCenter.lon] as [number, number])
    : DEFAULT_CENTER;

  const flyTarget =
    props.flyToLat !== undefined && props.flyToLon !== undefined ? (
      <FlyTo
        lat={props.flyToLat}
        lon={props.flyToLon}
        zoom={15}
        seq={props.flyToSeq}
      />
    ) : null;

  const stopsToPlot = useMemo(() => {
    if (!viewport || viewport.zoom < MIN_ZOOM_SHOW_STOPS) return [];
    const { minLat, maxLat, minLon, maxLon } = viewport.bbox;
    const pct = stopVisibilityPct(viewport.zoom);
    const selectedId = props.selectedStop?.id;
    return [...stopsMergedRef.current.values()].filter((s) => {
      if (s.lat < minLat || s.lat > maxLat || s.lon < minLon || s.lon > maxLon)
        return false;
      if (pct >= 100 || s.id === selectedId) return true;
      return fnv1a(s.id) % 100 < pct;
    });
  }, [viewport, mergeEpoch, props.selectedStop?.id]);

  const stopsLoading = viewportNeedsHydration && stopsQuery.isFetching;

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
      zoomControl={false}
      zoomSnap={0}
      zoomDelta={1}
    >
      <ZoomControl position="topright" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        keepBuffer={6}
        updateWhenZooming={false}
        updateWhenIdle={false}
      />
      <SmoothWheelZoom />
      <PinchToPan />
      <ViewportReporter onViewportChange={onViewportChange} />
      {flyTarget}
      {props.userLat !== undefined && props.userLon !== undefined ? (
        <Marker
          position={[props.userLat, props.userLon]}
          icon={USER_LOCATION_ICON}
          interactive={false}
        />
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
