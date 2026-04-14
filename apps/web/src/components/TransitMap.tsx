import {
  type Bbox,
  type LatLon,
  type Stop,
  bboxContains,
  bboxContainsPoint,
  quantizeBbox,
} from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { type DivIcon, type Map as LeafletMap, divIcon } from "leaflet";
import { type Ref, useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, ZoomControl, useMapEvents } from "react-leaflet";
import { fetchStopsInBbox, fetchStopsSnapshot } from "../api";
import { loadSavedStops, saveStops } from "../stopsPersistence";

const SEATTLE: [number, number] = [47.6062, -122.3321];
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions/">CARTO</a>';

const MIN_FETCH_ZOOM = 13;
const SAVE_DELAY_MS = 2000;

const STOP_SIZE = 24;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// react-leaflet rebuilds a marker's DOM whenever its icon identity changes, so icons are shared.
const iconCache = new Map<string, DivIcon>();

function markerIcon(className: string, size: number, heading?: number): DivIcon {
  const degrees = heading === undefined ? undefined : Math.round(heading);
  const key = `${className}:${degrees}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const arrow =
      degrees === undefined ? "" : `<i class="marker-arrow" style="--heading:${degrees}deg"></i>`;
    icon = divIcon({
      className: `marker ${className}`,
      iconSize: [size, size],
      html: `${arrow}<i class="marker-dot"></i>`,
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function stopIcon(direction: string | undefined, selected: boolean): DivIcon {
  const octant = COMPASS.indexOf(direction ?? "");
  return markerIcon(
    `marker-stop ${selected ? "marker-selected" : ""}`,
    STOP_SIZE,
    octant < 0 ? undefined : octant * 45,
  );
}

const USER_ICON = divIcon({ className: "marker-user", iconSize: [16, 16] });

interface Viewport {
  bbox: Bbox;
  zoom: number;
}

/**
 * Accumulates every stop seen so far (saved locally, cached on the server, or
 * fetched for a viewport) and returns the ones inside `viewport`.
 */
function useStops(viewport: Viewport | null): Stop[] {
  const [stops, setStops] = useState<ReadonlyMap<string, Stop>>(new Map());
  const [fetchedBbox, setFetchedBbox] = useState<Bbox | null>(null);

  const merge = useCallback((incoming: Stop[]) => {
    if (incoming.length === 0) return;
    setStops((known) => {
      const merged = new Map(known);
      for (const stop of incoming) merged.set(stop.id, stop);
      return merged;
    });
  }, []);

  useEffect(() => {
    void loadSavedStops().then(merge);
    fetchStopsSnapshot().then(merge, () => {});
  }, [merge]);

  useEffect(() => {
    if (stops.size === 0) return;
    const id = setTimeout(() => void saveStops([...stops.values()]), SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [stops]);

  const bbox = viewport && viewport.zoom >= MIN_FETCH_ZOOM ? quantizeBbox(viewport.bbox) : null;
  const alreadyFetched = bbox !== null && fetchedBbox !== null && bboxContains(fetchedBbox, bbox);

  const { data: fetched } = useQuery({
    queryKey: ["stops", bbox],
    queryFn: async () => ({ bbox: bbox!, stops: await fetchStopsInBbox(bbox!) }),
    enabled: bbox !== null && !alreadyFetched,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!fetched) return;
    merge(fetched.stops);
    setFetchedBbox(fetched.bbox);
  }, [fetched, merge]);

  return useMemo(() => {
    if (!viewport) return [];
    return [...stops.values()].filter((stop) =>
      bboxContainsPoint(viewport.bbox, stop.lat, stop.lon),
    );
  }, [stops, viewport]);
}

function ViewportReporter({ onChange }: { onChange: (viewport: Viewport) => void }) {
  const report = () => {
    const bounds = map.getBounds();
    onChange({
      zoom: map.getZoom(),
      bbox: {
        minLat: bounds.getSouth(),
        minLon: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLon: bounds.getEast(),
      },
    });
  };

  const map = useMapEvents({ moveend: report });

  useEffect(report, [map]);

  return null;
}

interface Props {
  ref: Ref<LeafletMap>;
  userPosition?: LatLon;
  selectedStop: Stop | null;
  onSelectStop: (stop: Stop) => void;
}

export function TransitMap({ ref, userPosition, selectedStop, onSelectStop }: Props) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const stops = useStops(viewport);

  return (
    <MapContainer
      ref={ref}
      center={SEATTLE}
      zoom={13}
      minZoom={3}
      maxZoom={19}
      zoomSnap={0}
      wheelPxPerZoomLevel={120}
      zoomControl={false}
      className="h-full w-full"
    >
      <ZoomControl position="topright" />
      <TileLayer attribution={ATTRIBUTION} url={TILE_URL} />
      <ViewportReporter onChange={setViewport} />
      {userPosition && (
        <Marker
          position={[userPosition.lat, userPosition.lon]}
          icon={USER_ICON}
          interactive={false}
        />
      )}
      {stops.map((stop) => (
        <Marker
          key={stop.id}
          position={[stop.lat, stop.lon]}
          icon={stopIcon(stop.direction, stop.id === selectedStop?.id)}
          eventHandlers={{ click: () => onSelectStop(stop) }}
        />
      ))}
    </MapContainer>
  );
}
