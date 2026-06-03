import type L from "leaflet";
import leaflet from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

const TRACKPAD_SCROLL_ZOOM_SPEED = 0.008;
const MOUSE_WHEEL_ZOOM_SPEED = 0.003;
const PINCH_ZOOM_SPEED = 0.03;
const WHEEL_SETTLE_MS = 150;

export function SmoothWheelZoom() {
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
