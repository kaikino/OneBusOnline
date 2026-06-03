import { useEffect } from "react";
import { useMap } from "react-leaflet";

export function FlyTo(props: { lat: number; lon: number; zoom?: number; seq?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([props.lat, props.lon], props.zoom ?? 15, { duration: 1 });
  }, [map, props.lat, props.lon, props.zoom, props.seq]);
  return null;
}
