import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Leaflet's ZoomControl uses `===` to compare zoom with min/max, which
 * doesn't work with fractional zoom (zoomSnap=0).  Rather than trying to
 * monkey-patch the control, we find the actual button DOM elements and
 * toggle the disabled class ourselves on every zoom change.
 */
export function ZoomControlFix() {
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
