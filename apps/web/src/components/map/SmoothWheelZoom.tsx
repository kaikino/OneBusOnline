import type { Point } from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

const SCROLL_PX_PER_ZOOM_LEVEL = 125;
/** Trackpad pinches arrive as ctrl+wheel events with much smaller deltas. */
const PINCH_PX_PER_ZOOM_LEVEL = 33;
/** Share of the remaining distance to the target zoom covered each frame. */
const EASING = 0.35;
const SETTLED = 0.002;

/** Pixels per unit of `deltaY`, indexed by `WheelEvent.deltaMode` (pixel, line, page). */
const DELTA_MODE_PX = [1, 20, 60];

/** Continuous wheel and trackpad zoom around the cursor. Requires `zoomSnap={0}`. */
export function SmoothWheelZoom() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let targetZoom = map.getZoom();
    let anchor: Point;
    let frame: number | null = null;

    const step = () => {
      const remaining = targetZoom - map.getZoom();
      const settled = Math.abs(remaining) < SETTLED;
      const zoom = settled ? targetZoom : map.getZoom() + remaining * EASING;
      map.setZoomAround(anchor, zoom, { animate: false });
      frame = settled ? null : requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (frame === null) targetZoom = map.getZoom();
      const pxPerLevel = e.ctrlKey ? PINCH_PX_PER_ZOOM_LEVEL : SCROLL_PX_PER_ZOOM_LEVEL;
      targetZoom = Math.min(
        map.getMaxZoom(),
        Math.max(map.getMinZoom(), targetZoom - (e.deltaY * DELTA_MODE_PX[e.deltaMode]) / pxPerLevel),
      );
      anchor = map.mouseEventToContainerPoint(e);
      frame ??= requestAnimationFrame(step);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [map]);

  return null;
}
