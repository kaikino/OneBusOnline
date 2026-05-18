import {
  type Bbox,
  type LatLon,
  type Stop,
  type Vehicle,
  bboxContains,
  bboxContainsPoint,
  quantizeBbox,
} from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { type DivIcon, type Map as LeafletMap, divIcon } from "leaflet";
import { type Ref, useCallback, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  ZoomControl,
  useMapEvents,
} from "react-leaflet";
import {
  fetchRouteShape,
  fetchRouteVehicles,
  fetchStopsInBbox,
  fetchStopsSnapshot,
} from "../api";
import { formatAge } from "../arrivalUi";
import { useNow } from "../hooks/useNow";
import { decodePolyline } from "../polyline";
import type { RouteFilter } from "../routeFilter";
import { loadSavedStops, saveStops } from "../stopsPersistence";

const SEATTLE: [number, number] = [47.6062, -122.3321];
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions/">CARTO</a>';

const ROUTE_LINE_STYLE = { color: "#0ea5e9", weight: 5, opacity: 0.85 };

const ON_TIME_TOLERANCE_SEC = 90;
const STALE_GPS_MS = 60_000;

const MIN_FETCH_ZOOM = 13;
const SAVE_DELAY_MS = 2000;

const STOP_SIZE = 24;
const VEHICLE_SIZE = 22;
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

type StopMarkerState = "default" | "selected" | "dimmed";

function stopIcon(direction: string | undefined, state: StopMarkerState): DivIcon {
  const octant = COMPASS.indexOf(direction ?? "");
  return markerIcon(`marker-stop marker-${state}`, STOP_SIZE, octant < 0 ? undefined : octant * 45);
}

function vehicleIcon(heading: number | undefined, hasGps: boolean): DivIcon {
  return markerIcon(`marker-vehicle ${hasGps ? "marker-live" : ""}`, VEHICLE_SIZE, heading);
}

const USER_ICON = divIcon({ className: "marker-user", iconSize: [16, 16] });

/** Percentage of known stops drawn at a zoom level, to keep zoomed-out views readable. */
function visiblePercent(zoom: number): number {
  if (zoom >= 14) return 100;
  if (zoom >= 13.5) return 50;
  if (zoom >= 13) return 25;
  if (zoom >= 12) return 10;
  if (zoom >= 11) return 5;
  return 1;
}

/** FNV-1a hash mapped to 0-99, so the same stops stay visible as the map moves. */
function samplingRank(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash % 100;
}

interface Viewport {
  bbox: Bbox;
  zoom: number;
}

/**
 * Accumulates every stop seen so far (saved locally, cached on the server, or
 * fetched for a viewport) and returns the ones to draw for `viewport`.
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
    const percent = visiblePercent(viewport.zoom);
    return [...stops.values()].filter(
      (stop) =>
        bboxContainsPoint(viewport.bbox, stop.lat, stop.lon) && samplingRank(stop.id) < percent,
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

function RouteLine({ routeId }: { routeId: string }) {
  const { data: shape } = useQuery({
    queryKey: ["routeShape", routeId],
    queryFn: () => fetchRouteShape(routeId),
    staleTime: 60 * 60_000,
  });

  const lines = useMemo(() => shape?.polylines.map(decodePolyline) ?? [], [shape]);

  return <Polyline positions={lines} pathOptions={ROUTE_LINE_STYLE} interactive={false} />;
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function scheduleStatus({ predicted, deviationSec }: Vehicle) {
  if (!predicted) return { label: "Scheduled", color: "text-slate-400" };
  if (Math.abs(deviationSec) <= ON_TIME_TOLERANCE_SEC) {
    return { label: "On time", color: "text-emerald-500" };
  }
  const minutes = Math.round(Math.abs(deviationSec) / 60);
  return deviationSec > 0
    ? { label: `${minutes} min late`, color: "text-red-500" }
    : { label: `${minutes} min early`, color: "text-orange-400" };
}

function positionSource(vehicle: Vehicle, now: number) {
  if (!vehicle.hasGps) return { label: "Position from schedule", color: "text-red-400" };
  const age = now - vehicle.lastUpdateMs;
  return age > STALE_GPS_MS
    ? { label: `Last GPS · ${formatAge(age)}`, color: "text-amber-300" }
    : { label: `Live GPS · ${formatAge(age)}`, color: "text-emerald-400" };
}

function VehiclePopup({ vehicle }: { vehicle: Vehicle }) {
  const now = useNow(5000);
  const schedule = scheduleStatus(vehicle);
  const source = positionSource(vehicle, now);

  return (
    <div className="min-w-[12rem]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold text-sky-300">{vehicle.routeShortName}</span>
        {vehicle.headsign && (
          <span className="truncate text-sm text-slate-300">→ {vehicle.headsign}</span>
        )}
      </div>
      <div className={`mt-1 text-sm font-medium ${schedule.color}`}>{schedule.label}</div>
      <div className={`mt-0.5 text-xs ${source.color}`}>{source.label}</div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-300">
        {vehicle.vehicleId && (
          <>
            <dt className="text-slate-500">Bus</dt>
            <dd className="font-mono">{vehicle.vehicleId}</dd>
          </>
        )}
        {vehicle.occupancy && (
          <>
            <dt className="text-slate-500">Occupancy</dt>
            <dd>{titleCase(vehicle.occupancy)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function RouteVehicles({ route }: { route: RouteFilter }) {
  const { data: vehicles = [] } = useQuery({
    queryKey: ["routeVehicles", route.routeId],
    queryFn: () => fetchRouteVehicles(route.routeId),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  return (
    <>
      {vehicles
        .filter((vehicle) => vehicle.headsign === route.headsign)
        .map((vehicle) => (
          <Marker
            key={vehicle.vehicleId ?? vehicle.tripId}
            position={[vehicle.lat, vehicle.lon]}
            icon={vehicleIcon(vehicle.heading, vehicle.hasGps)}
            zIndexOffset={500}
          >
            <Popup className="vehicle-popup" closeButton={false} maxWidth={260}>
              <VehiclePopup vehicle={vehicle} />
            </Popup>
          </Marker>
        ))}
    </>
  );
}

interface Props {
  ref: Ref<LeafletMap>;
  userPosition?: LatLon;
  selectedStop: Stop | null;
  /** When set, the route and its buses are drawn and stops it doesn't serve are dimmed. */
  routeFilter: RouteFilter | null;
  onSelectStop: (stop: Stop) => void;
}

export function TransitMap({
  ref,
  userPosition,
  selectedStop,
  routeFilter,
  onSelectStop,
}: Props) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const stops = useStops(viewport);

  const stateOf = (stop: Stop): StopMarkerState => {
    if (stop.id === selectedStop?.id) return "selected";
    return routeFilter && !stop.routeIds.includes(routeFilter.routeId) ? "dimmed" : "default";
  };

  return (
    <MapContainer
      ref={ref}
      center={SEATTLE}
      zoom={13}
      minZoom={3}
      maxZoom={19}
      zoomSnap={0.5}
      wheelPxPerZoomLevel={120}
      maxBounds={[
        [-85, -180],
        [85, 180],
      ]}
      maxBoundsViscosity={1}
      zoomControl={false}
      className="h-full w-full"
    >
      <ZoomControl position="topright" />
      <TileLayer attribution={ATTRIBUTION} url={TILE_URL} keepBuffer={6} />
      <ViewportReporter onChange={setViewport} />
      {routeFilter && (
        <>
          <RouteLine routeId={routeFilter.routeId} />
          <RouteVehicles route={routeFilter} />
        </>
      )}
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
          icon={stopIcon(stop.direction, stateOf(stop))}
          eventHandlers={{ click: () => onSelectStop(stop) }}
        />
      ))}
    </MapContainer>
  );
}
