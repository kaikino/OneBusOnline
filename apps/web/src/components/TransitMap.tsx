import type { LatLon, Stop } from "@onebus/shared";
import type { Map as LeafletMap } from "leaflet";
import { type Ref, useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, ZoomControl, useMapEvents } from "react-leaflet";
import { type Viewport, useStops } from "../hooks/useStops";
import { USER_ICON } from "../lib/mapIcons";
import type { RouteFilter } from "../lib/routeFilter";
import { RouteLine } from "./map/RouteLine";
import { RouteVehicles } from "./map/RouteVehicles";
import { SmoothWheelZoom } from "./map/SmoothWheelZoom";
import { StopMarkers } from "./map/StopMarkers";

const SEATTLE: [number, number] = [47.6062, -122.3321];
// Without a key CARTO still serves tiles, but watermarked.
const CARTO_KEY = import.meta.env.VITE_CARTO_API_KEY;
const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${
  CARTO_KEY ? `?key=${CARTO_KEY}` : ""
}`;
/** Smooth zooming moves the map every frame; stops are only recomputed once it rests. */
const VIEWPORT_SETTLE_MS = 100;

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions/">CARTO</a>';

function MapEvents(props: {
  onViewportChange: (viewport: Viewport) => void;
  onBackgroundClick: () => void;
}) {
  const popupOpen = useRef(false);

  const reportViewport = () => {
    const bounds = map.getBounds();
    props.onViewportChange({
      zoom: map.getZoom(),
      bbox: {
        minLat: bounds.getSouth(),
        minLon: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLon: bounds.getEast(),
      },
    });
  };

  const settleTimer = useRef<number>(undefined);
  const scheduleReport = () => {
    clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(reportViewport, VIEWPORT_SETTLE_MS);
  };

  const map = useMapEvents({
    moveend: scheduleReport,
    popupopen: () => (popupOpen.current = true),
    popupclose: () => (popupOpen.current = false),
    // A tap on the map dismisses an open popup first, and only then reaches the app.
    click: () => (popupOpen.current ? map.closePopup() : props.onBackgroundClick()),
  });

  useEffect(() => {
    reportViewport();
    return () => clearTimeout(settleTimer.current);
  }, [map]);

  return null;
}

interface Props {
  ref: Ref<LeafletMap>;
  userPosition?: LatLon;
  selectedStop: Stop | null;
  routeFilter: RouteFilter | null;
  onSelectStop: (stop: Stop) => void;
  onBackgroundClick: () => void;
}

export function TransitMap({
  ref,
  userPosition,
  selectedStop,
  routeFilter,
  onSelectStop,
  onBackgroundClick,
}: Props) {
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
      scrollWheelZoom={false}
      maxBounds={[
        [-85, -180],
        [85, 180],
      ]}
      maxBoundsViscosity={1}
      zoomControl={false}
      closePopupOnClick={false}
      className="h-full w-full"
    >
      <ZoomControl position="topright" />
      <TileLayer attribution={ATTRIBUTION} url={TILE_URL} keepBuffer={6} />
      <SmoothWheelZoom />
      <MapEvents onViewportChange={setViewport} onBackgroundClick={onBackgroundClick} />
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
      <StopMarkers
        stops={stops}
        selected={selectedStop}
        highlightRouteId={routeFilter?.routeId}
        onSelect={onSelectStop}
      />
    </MapContainer>
  );
}
