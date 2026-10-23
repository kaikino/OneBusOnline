import type { Stop } from "@onebus/shared";
import { memo } from "react";
import { Marker } from "react-leaflet";
import { type StopMarkerState, stopIcon } from "../../lib/mapIcons";

interface Props {
  stops: Stop[];
  selected: Stop | null;
  savedIds: ReadonlySet<string>;
  /** When set, stops this route doesn't serve are dimmed. */
  highlightRouteId?: string;
  onSelect: (stop: Stop) => void;
}

export const StopMarkers = memo(function StopMarkers({
  stops,
  selected,
  savedIds,
  highlightRouteId,
  onSelect,
}: Props) {
  const stateOf = (stop: Stop): StopMarkerState => {
    if (highlightRouteId && !stop.routeIds.includes(highlightRouteId)) return "dimmed";
    return savedIds.has(stop.id) ? "saved" : "default";
  };

  return (
    <>
      {stops
        .filter((stop) => stop.id !== selected?.id)
        .map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.lat, stop.lon]}
            icon={stopIcon(stop.direction, stateOf(stop))}
            zIndexOffset={savedIds.has(stop.id) ? 200 : 0}
            eventHandlers={{ click: () => onSelect(stop) }}
          />
        ))}
      {selected && (
        <Marker
          position={[selected.lat, selected.lon]}
          icon={stopIcon(selected.direction, "selected")}
          zIndexOffset={250}
        />
      )}
    </>
  );
});
