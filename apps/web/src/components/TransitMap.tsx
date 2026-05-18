import type { RouteVehicle, StopSummary } from "@onebus/shared";
import { headsignKey } from "./ArrivalsDrawer";
import { useQuery } from "@tanstack/react-query";
import type L from "leaflet";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import leaflet from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  bboxContainsOuter,
  fetchRouteShape,
  fetchRouteVehicles,
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

function stopIcon(
  selected: boolean,
  dirDeg: number | null,
  dimmed = false
): L.DivIcon {
  const key = `${selected ? "s" : "u"}:${dimmed ? "d" : "n"}:${dirDeg ?? "x"}`;
  const cached = STOP_ICON_CACHE.get(key);
  if (cached) return cached;

  const dotSize = selected ? 18 : 18;
  const dotBorder = selected ? 2 : 2;
  const dotColor = selected ? "#facc15" : "#0ea5e9";
  const dotBorderColor = selected ? "#ffffff" : "#0f172a";
  const baseDotOpacity = selected ? 1 : 0.7;
  const dotOpacity = dimmed ? baseDotOpacity * 0.25 : baseDotOpacity;
  const dotOffset = (ICON_SIZE - dotSize) / 2;

  let html = "";

  if (dirDeg != null) {
    const triW = 12;
    const triH = 8;
    const triColor = selected ? "#facc15" : "#0ea5e9";
    const triLeft = (ICON_SIZE - triW) / 2;
    const triTop = (ICON_SIZE - triH) / 2;
    const triOpacity = dimmed ? 0.25 : 1;
    html += `<div style="position:absolute;left:${triLeft}px;top:${triTop}px;width:${triW}px;height:${triH}px;clip-path:polygon(50% 0%,0% 100%,100% 100%);background:${triColor};outline:1px solid #fff;opacity:${triOpacity};transform:rotate(${dirDeg}deg) translateY(-${ICON_HALF - 1}px);transform-origin:50% 50%;"></div>`;
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
const TRACKPAD_SCROLL_ZOOM_SPEED = 0.008;
const MOUSE_WHEEL_ZOOM_SPEED = 0.003;
const PINCH_ZOOM_SPEED = 0.03;


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

/**
 * Leaflet's ZoomControl uses `===` to compare zoom with min/max, which
 * doesn't work with fractional zoom (zoomSnap=0).  Rather than trying to
 * monkey-patch the control, we find the actual button DOM elements and
 * toggle the disabled class ourselves on every zoom change.
 */
function ZoomControlFix() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const zoomIn = container.querySelector(
      ".leaflet-control-zoom-in"
    ) as HTMLElement | null;
    const zoomOut = container.querySelector(
      ".leaflet-control-zoom-out"
    ) as HTMLElement | null;
    if (!zoomIn || !zoomOut) return;

    const CLS = "leaflet-disabled";
    let animZoom: number | null = null;

    function sync() {
      const zoom = animZoom ?? map.getZoom();
      animZoom = null;
      const atMax = zoom >= map.getMaxZoom();
      const atMin = zoom <= map.getMinZoom();
      zoomIn!.classList.toggle(CLS, atMax);
      zoomIn!.setAttribute("aria-disabled", String(atMax));
      zoomOut!.classList.toggle(CLS, atMin);
      zoomOut!.setAttribute("aria-disabled", String(atMin));
    }

    function onZoomAnim(e: any) {
      if (typeof e?.zoom === "number") animZoom = e.zoom;
      sync();
    }

    sync();
    map.on("zoom zoomend zoomlevelschange", sync);
    map.on("zoomanim", onZoomAnim);
    return () => {
      map.off("zoom zoomend zoomlevelschange", sync);
      map.off("zoomanim", onZoomAnim);
    };
  }, [map]);
  return null;
}

const WHEEL_SETTLE_MS = 150;

function SmoothWheelZoom() {
  const map = useMap();

  useEffect(() => {
    let accumulatedZoomDelta = 0;
    let mousePos: L.Point | null = null;
    let anchorLatLng: L.LatLng | null = null;
    let rafId: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    let baseZoom: number | null = null;
    let visualZoom = map.getZoom();
    let zooming = false;
    let anchorMousePos: L.Point | null = null;
    let basePanePos: L.Point | null = null;

    function computeCenter(zoom: number): L.LatLng {
      if (!anchorMousePos || !anchorLatLng) return map.getCenter();
      const viewHalf = map.getSize().divideBy(2);
      const anchorProjected = map.project(anchorLatLng, zoom);
      const centerProjected = anchorProjected.subtract(anchorMousePos).add(viewHalf);
      return map.unproject(centerProjected, zoom);
    }

    function applyVisual() {
      rafId = null;
      if (!accumulatedZoomDelta || !mousePos || !anchorLatLng) return;

      if (baseZoom === null) {
        baseZoom = map.getZoom();
        visualZoom = baseZoom;
        anchorMousePos = mousePos;
        basePanePos = (map as any)._getMapPanePos().clone();
        zooming = true;
      }

      const delta = accumulatedZoomDelta;
      accumulatedZoomDelta = 0;

      visualZoom = Math.max(
        map.getMinZoom(),
        Math.min(map.getMaxZoom(), visualZoom + delta)
      );

      const scale = map.getZoomScale(visualZoom, baseZoom);
      const origin = (map as any)._getCenterLayerPoint().add(
        anchorMousePos!.subtract(map.getSize().divideBy(2))
      );
      const offset = origin.multiplyBy(1 - scale).add(basePanePos!);

      leaflet.DomUtil.setTransform(
        (map as any)._mapPane as HTMLElement,
        offset,
        scale,
      );

      // Counter-scale each marker icon around its own center so stops
      // keep their pixel size while tiles scale.
      el.style.setProperty("--wheel-zoom-scale", String(scale));
      el.classList.add("wheel-zooming");

      // Fire zoom so ZoomControlFix can update button states
      map.fire("zoom");
    }

    function commit() {
      settleTimer = null;
      if (!zooming) return;

      const newCenter = computeCenter(visualZoom);
      baseZoom = null;
      zooming = false;
      anchorMousePos = null;
      anchorLatLng = null;
      basePanePos = null;

      // Remove transforms, then commit the real zoom.
      el.classList.remove("wheel-zooming");
      el.style.removeProperty("--wheel-zoom-scale");
      leaflet.DomUtil.setTransform(
        (map as any)._mapPane as HTMLElement,
        new leaflet.Point(0, 0),
        1,
      );
      map.setView(newCenter, visualZoom, { animate: false });
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
      const isPinch = e.ctrlKey;
      const looksLikeMouseWheel =
        e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1);
      const speed = isPinch
        ? PINCH_ZOOM_SPEED
        : looksLikeMouseWheel
          ? MOUSE_WHEEL_ZOOM_SPEED
          : TRACKPAD_SCROLL_ZOOM_SPEED;
      accumulatedZoomDelta -= raw * speed;
      mousePos = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      // Anchor must be computed at the COMMITTED zoom (baseZoom), not the
      // visual zoom, so the projection stays consistent across frames.
      if (!zooming) {
        anchorLatLng = map.containerPointToLatLng(mousePos);
      }
      if (rafId === null) rafId = requestAnimationFrame(applyVisual);

      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(commit, WHEEL_SETTLE_MS);
    }

    const el = map.getContainer();
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimer !== null) { clearTimeout(settleTimer); commit(); }
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

    function clearBlockingState() {
      const pane: HTMLElement | undefined = (map as any)._mapPane;
      if (pane) pane.classList.remove("leaflet-zoom-anim");
      el.classList.remove("leaflet-zoom-anim");
      (map as any)._animatingZoom = false;
      const draggable = (map as any).dragging?._draggable;
      if ((leaflet as any).Draggable._dragging) {
        if (draggable && (leaflet as any).Draggable._dragging === draggable) {
          try { draggable.finishDrag(true); } catch (_) { /* noop */ }
        }
        (leaflet as any).Draggable._dragging = false;
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) wasPinching = true;
      clearBlockingState();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!wasPinching) return;

      if (e.touches.length < 2) {
        // A finger was lifted after a pinch.  Temporarily disable
        // zoomAnimation so Leaflet's TouchZoom handler (which fires on
        // `document`, after this container handler) chooses `_resetView`
        // instead of `_animateZoom`.
        map.options.zoomAnimation = false;
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

        setTimeout(() => {
          map.options.zoomAnimation = true;
          clearBlockingState();

          const draggable = (map as any).dragging?._draggable;
          if (!draggable || !draggable._enabled) return;

          draggable._onDown({
            type: "touchstart",
            touches: [touchSnapshot],
            target: el,
            preventDefault() {},
            stopPropagation() {},
          });

          // Safety: if the remaining finger was lifted during the
          // setTimeout delay, _onUp won't fire (wasn't registered yet).
          // Schedule a cleanup to avoid leaving _dragging stuck.
          const safetyId = setTimeout(() => {
            if ((leaflet as any).Draggable._dragging === draggable && !draggable._moving) {
              clearBlockingState();
            }
          }, 200);

          const cancelSafety = () => {
            clearTimeout(safetyId);
            document.removeEventListener("touchmove", cancelSafety);
          };
          document.addEventListener("touchmove", cancelSafety, { once: true, passive: true });
        }, 0);
      } else {
        if (e.touches.length < 2) {
          // Both fingers lifted — restore zoomAnimation and clear
          // blocking state so the next single-finger pan works.
          setTimeout(() => {
            map.options.zoomAnimation = true;
            clearBlockingState();
          }, 0);
        }
        wasPinching = e.touches.length >= 2;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart, { capture: true } as EventListenerOptions);
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

/**
 * Decode a Google-encoded polyline string into [lat, lon] pairs.
 * Inline implementation to avoid pulling in @mapbox/polyline (~5kB).
 */
function decodePolyline(str: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push([lat * 1e-5, lng * 1e-5]);
  }
  return coords;
}

const VEHICLE_ICON_CACHE = new Map<string, L.DivIcon>();

/** `liveGps`: full opacity + glow; schedule-interpolated coords are dimmed like non-AVL. */
function vehicleIcon(orientation?: number, liveGps = true): L.DivIcon {
  const hasDir = orientation != null && Number.isFinite(orientation);
  const key = `${liveGps ? "g" : "s"}:${hasDir ? `o:${Math.round(orientation!)}` : "x"}`;
  const cached = VEHICLE_ICON_CACHE.get(key);
  if (cached) return cached;

  const size = 22;
  const half = size / 2;
  const dot = 14;
  const dotOffset = (size - dot) / 2;
  const color = "#f97316"; // orange-500 — distinct from sky stops + green user
  const border = "#ffffff";
  const wrapperOpacity = liveGps ? 1 : 0.75;
  const dotShadow = liveGps
    ? "box-shadow:0 0 6px rgba(249,115,22,0.55);"
    : "";

  let html = "";
  if (hasDir) {
    const triW = 12;
    const triH = 9;
    const triLeft = (size - triW) / 2;
    const triTop = (size - triH) / 2;
    html += `<div style="position:absolute;left:${triLeft}px;top:${triTop}px;width:${triW}px;height:${triH}px;clip-path:polygon(50% 0%,0% 100%,100% 100%);background:${color};outline:1.5px solid ${border};transform:rotate(${orientation}deg) translateY(-${half - 1}px);transform-origin:50% 50%;"></div>`;
  }
  html += `<div style="position:absolute;left:${dotOffset}px;top:${dotOffset}px;width:${dot}px;height:${dot}px;border-radius:50%;background:${color};border:2px solid ${border};${dotShadow}"></div>`;

  const icon = leaflet.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [half, half],
    html: `<div style="position:relative;width:${size}px;height:${size}px;opacity:${wrapperOpacity};">${html}</div>`,
  });
  VEHICLE_ICON_CACHE.set(key, icon);
  return icon;
}

function vehicleKey(v: RouteVehicle): string {
  // tripId first — `vehicleId` can be reused across trips in some agencies,
  // which would collapse two real buses to one React key and visually drop a
  // marker. Pair it with vehicleId so reassignments mid-day still re-key.
  return `${v.tripId}::${v.vehicleId ?? ""}`;
}

/**
 * Mirrors server `wallClockUnixMs`: some feeds/cache entries use unix seconds.
 * Prefer fresh API data; keeps popups sane for older cached payloads.
 */
function coerceRealtimeEpochMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return ms;
  return ms >= 100_000_000_000 ? ms : ms * 1000;
}

function formatRelativeAge(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) return "unknown age";
  const clampedMs = Math.max(0, deltaMs);
  const sec = Math.round(clampedMs / 1000);
  if (sec < 60) return `${sec} s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 730) return `${Math.max(1, day)} days ago`;
  const yr = Math.round(day / 365);
  return `${Math.max(1, yr)} yrs ago`;
}

function VehiclePopupContent({ v }: { v: RouteVehicle }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const liveGps = v.liveGpsPosition ?? v.predicted;
  const lastMs = coerceRealtimeEpochMs(v.lastUpdateMs);
  const ageMs = tick - lastMs;
  const ageLabel = formatRelativeAge(ageMs);
  const stale = liveGps && ageMs > 60_000;

  const source = (() => {
    if (!liveGps) {
      return {
        label: "Position from schedule",
        cls: "text-red-400",
      };
    }
    if (stale) {
      return {
        label: `Last GPS · ${ageLabel}`,
        cls: "text-amber-300",
      };
    }
    return {
      label: `Live GPS · ${ageLabel}`,
      cls: "text-emerald-400",
    };
  })();

  const dev = v.scheduleDeviationSec || 0;
  const punctuality = (() => {
    if (!v.predicted) return { label: "Scheduled (no live update)", cls: "text-slate-400" };
    if (Math.abs(dev) < 90) return { label: "On time", cls: "text-emerald-400" };
    if (dev > 0) {
      const m = Math.max(1, Math.round(dev / 60));
      return { label: `${m} min late`, cls: "text-amber-400" };
    }
    const m = Math.max(1, Math.round(Math.abs(dev) / 60));
    return { label: `${m} min early`, cls: "text-sky-300" };
  })();

  const occupancyLabel = (() => {
    if (!v.occupancyStatus) return null;
    return v.occupancyStatus
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  })();

  return (
    <div className="min-w-[12rem] text-slate-100">
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold text-sky-300">
          {v.routeShortName ?? v.routeId}
        </span>
        {v.headsign ? (
          <span className="truncate text-sm text-slate-300">→ {v.headsign}</span>
        ) : null}
      </div>
      <div className={`mt-1 text-sm font-medium ${punctuality.cls}`}>
        {punctuality.label}
      </div>
      <div className={`mt-0.5 text-xs ${source.cls}`}>{source.label}</div>
      {v.vehicleId || occupancyLabel ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-300">
          {v.vehicleId ? (
            <>
              <dt className="text-slate-500">Bus</dt>
              <dd className="font-mono">{v.vehicleId}</dd>
            </>
          ) : null}
          {occupancyLabel ? (
            <>
              <dt className="text-slate-500">Occupancy</dt>
              <dd>{occupancyLabel}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

const RouteVehiclesLayer = memo(
  function RouteVehiclesLayer(props: {
    routeId: string;
    /** Normalized headsing key (`RouteFilter.headsign`); restricts markers to direction. */
    directionHeadsign?: string | null;
  }) {
    const { routeId, directionHeadsign } = props;
    const query = useQuery({
      queryKey: ["routeVehicles", routeId],
      queryFn: () => fetchRouteVehicles(routeId),
      staleTime: 10_000,
      gcTime: 5 * 60 * 1000,
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    });

    const vehicles = useMemo(() => {
      const list = query.data?.vehicles ?? [];
      if (!directionHeadsign) return list;
      return list.filter(
        (v) => headsignKey(v.headsign) === directionHeadsign,
      );
    }, [directionHeadsign, query.data?.vehicles]);

    if (vehicles.length === 0) return null;

    return (
      <>
        {vehicles.map((v) => (
          <Marker
            key={vehicleKey(v)}
            position={[v.lat, v.lon]}
            icon={vehicleIcon(v.orientation, v.liveGpsPosition ?? v.predicted)}
            zIndexOffset={500}
          >
            <Popup
              className="vehicle-popup"
              closeButton={false}
              maxWidth={260}
              autoPan
            >
              <VehiclePopupContent v={v} />
            </Popup>
          </Marker>
        ))}
      </>
    );
  },
  (prev, next) => prev.routeId === next.routeId
);

const RoutePolylineLayer = memo(
  function RoutePolylineLayer({ routeId }: { routeId: string }) {
    const shapeQuery = useQuery({
      queryKey: ["routeShape", routeId],
      queryFn: () => fetchRouteShape(routeId),
      staleTime: 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    });

    const lines = useMemo(() => {
      const polys = shapeQuery.data?.polylines ?? [];
      const out: [number, number][][] = [];
      for (const p of polys) {
        if (!p) continue;
        const pts = decodePolyline(p);
        if (pts.length >= 2) out.push(pts);
      }
      return out;
    }, [shapeQuery.data]);

    if (lines.length === 0) return null;
    return (
      <>
        {lines.map((pts, i) => (
          <Polyline
            key={i}
            positions={pts}
            pathOptions={{
              color: "#0ea5e9",
              weight: 5,
              opacity: 0.85,
              lineJoin: "round",
              lineCap: "round",
            }}
            interactive={false}
          />
        ))}
      </>
    );
  }
);

function stopsFingerprint(stops: StopSummary[]): string {
  if (stops.length === 0) return "";
  return stops.map((s) => `${s.id}:${s.lat.toFixed(5)}:${s.lon.toFixed(5)}`).join("|");
}

const StopMarkersLayer = memo(
  function StopMarkersLayer(props: {
    stops: StopSummary[];
    selectedId: string | undefined;
    routeFilterId: string | null;
    onSelectStop: (s: StopSummary) => void;
  }) {
    const selectedStop = props.selectedId
      ? props.stops.find((s) => s.id === props.selectedId)
      : undefined;
    const isDimmed = (s: StopSummary) =>
      props.routeFilterId != null &&
      s.id !== props.selectedId &&
      !s.routeIds.includes(props.routeFilterId);
    return (
      <>
        {props.stops.map((s) => {
          if (s.id === props.selectedId) return null;
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lon]}
              icon={stopIcon(false, directionToDegrees(s.direction), isDimmed(s))}
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
            icon={stopIcon(true, directionToDegrees(selectedStop.direction), false)}
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
    prev.routeFilterId === next.routeFilterId &&
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
  routeFilter?: { routeId: string; headsign: string } | null;
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
      minZoom={3}
      maxZoom={19}
      maxBounds={[[-85, -180], [85, 180]]}
      maxBoundsViscosity={1.0}
      bounceAtZoomLimits={false}
      zoomSnap={0}
      zoomDelta={1}
    >
      <ZoomControl position="topright" />
      <ZoomControlFix />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        minZoom={2}
        maxZoom={19}
        keepBuffer={6}
        updateWhenZooming={false}
        updateWhenIdle={false}
      />
      <SmoothWheelZoom />
      <PinchToPan />
      <ViewportReporter onViewportChange={onViewportChange} />
      {flyTarget}
      {props.routeFilter?.routeId ? (
        <>
          <RoutePolylineLayer routeId={props.routeFilter.routeId} />
          <RouteVehiclesLayer
            routeId={props.routeFilter.routeId}
            directionHeadsign={props.routeFilter.headsign}
          />
        </>
      ) : null}
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
        routeFilterId={props.routeFilter?.routeId ?? null}
        onSelectStop={stableSelectStop}
      />
    </MapContainer>
    </div>
  );
}
