import type { LatLng, Map as LeafletMap, Point } from "leaflet";
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

/**
 * Leaflet's public setters rebuild every tile on each call. Its own pinch
 * handler zooms continuously through these internals instead.
 */
interface ContinuousZoom {
  _moveStart(zoomChanged: boolean, noMoveStart: boolean): void;
  _move(center: LatLng, zoom: number): void;
  _moveEnd(zoomChanged: boolean): void;
}

/** The center that keeps the map location under `anchor` fixed at `zoom`. */
function centerAround(map: LeafletMap, anchor: Point, zoom: number): LatLng {
  const viewCenter = map.getSize().divideBy(2);
  const offset = anchor.subtract(viewCenter).multiplyBy(1 - 1 / map.getZoomScale(zoom));
  return map.containerPointToLatLng(viewCenter.add(offset));
}

/** Continuous wheel and trackpad zoom around the cursor. Requires `zoomSnap={0}`. */
export function SmoothWheelZoom() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const zoomer = map as LeafletMap & ContinuousZoom;
    let targetZoom = map.getZoom();
    let anchor: Point;
    let frame: number | null = null;

    const step = () => {
      const remaining = targetZoom - map.getZoom();
      const settled = Math.abs(remaining) < SETTLED;
      const zoom = settled ? targetZoom : map.getZoom() + remaining * EASING;
      zoomer._move(centerAround(map, anchor, zoom), zoom);
      if (settled) {
        frame = null;
        zoomer._moveEnd(true);
      } else {
        frame = requestAnimationFrame(step);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (frame === null) {
        targetZoom = map.getZoom();
        map.stop();
        zoomer._moveStart(true, false);
        frame = requestAnimationFrame(step);
      }
      const pxPerLevel = e.ctrlKey ? PINCH_PX_PER_ZOOM_LEVEL : SCROLL_PX_PER_ZOOM_LEVEL;
      targetZoom = Math.min(
        map.getMaxZoom(),
        Math.max(map.getMinZoom(), targetZoom - (e.deltaY * DELTA_MODE_PX[e.deltaMode]) / pxPerLevel),
      );
      anchor = map.mouseEventToContainerPoint(e);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [map]);

  return null;
}
