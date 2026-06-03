import type { StopSummary } from "@onebus/shared";
import { useCallback, useRef } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  ZoomControl,
} from "react-leaflet";
import { USER_LOCATION_ICON } from "../lib/mapIcons";
import { ViewportReporter } from "./map/ViewportReporter";
import { ZoomControlFix } from "./map/ZoomControlFix";
import { SmoothWheelZoom } from "./map/SmoothWheelZoom";
import { PinchToPan } from "./map/PinchToPan";
import { FlyTo } from "./map/FlyTo";
import { RouteVehiclesLayer } from "./map/RouteVehiclesLayer";
import { RoutePolylineLayer } from "./map/RoutePolylineLayer";
import { StopMarkersLayer } from "./map/StopMarkersLayer";
import { useStopsMapCache } from "../hooks/useStopsMapCache";

const DEFAULT_CENTER: [number, number] = [47.6062, -122.3321];
const DEFAULT_ZOOM = 13;

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
  const onSelectRef = useRef(props.onSelectStop);
  onSelectRef.current = props.onSelectStop;
  const stableSelectStop = useCallback((s: StopSummary) => {
    onSelectRef.current(s);
  }, []);

  const { stopsToPlot, stopsLoading, onViewportChange } = useStopsMapCache(
    props.selectedStop?.id,
  );

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
