import type { StopSummary } from "@onebus/shared";
import { memo } from "react";
import { Marker } from "react-leaflet";
import { directionToDegrees, stopIcon } from "../../lib/mapIcons";

function stopsFingerprint(stops: StopSummary[]): string {
  if (stops.length === 0) return "";
  return stops.map((s) => `${s.id}:${s.lat.toFixed(5)}:${s.lon.toFixed(5)}`).join("|");
}

export const StopMarkersLayer = memo(
  function StopMarkersLayer(props: {
    stops: StopSummary[];
    selectedId: string | undefined;
    routeFilterId: string | null;
    onSelectStop: (s: StopSummary) => void;
  }) {
    const selectedStop = props.selectedId
      ? props.stops.find((s) => s.id === props.selectedId)
      : undefined;
    const isDimmed = (s: StopSummary) =>
      props.routeFilterId != null &&
      s.id !== props.selectedId &&
      !s.routeIds.includes(props.routeFilterId);
    return (
      <>
        {props.stops.map((s) => {
          if (s.id === props.selectedId) return null;
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lon]}
              icon={stopIcon(false, directionToDegrees(s.direction), isDimmed(s))}
              eventHandlers={{
                click: () => props.onSelectStop(s),
              }}
            />
          );
        })}
        {selectedStop ? (
          <Marker
            key={`sel-${selectedStop.id}`}
            position={[selectedStop.lat, selectedStop.lon]}
            icon={stopIcon(true, directionToDegrees(selectedStop.direction), false)}
            eventHandlers={{
              click: () => props.onSelectStop(selectedStop),
            }}
          />
        ) : null}
      </>
    );
  },
  (prev, next) =>
    prev.selectedId === next.selectedId &&
    prev.routeFilterId === next.routeFilterId &&
    prev.onSelectStop === next.onSelectStop &&
    stopsFingerprint(prev.stops) === stopsFingerprint(next.stops)
);
