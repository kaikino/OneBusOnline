import { useCallback, useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";

const VIEWPORT_DEBOUNCE_MS = 100;

export type ViewportBbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export function boundsToBbox(bounds: {
  getSouthWest: () => { lat: number; lng: number };
  getNorthEast: () => { lat: number; lng: number };
}): ViewportBbox {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return {
    minLat: sw.lat,
    minLon: sw.lng,
    maxLat: ne.lat,
    maxLon: ne.lng,
  };
}

export function ViewportReporter({
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
