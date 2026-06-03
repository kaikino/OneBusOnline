import { type DivIcon, divIcon } from "leaflet";

const STOP_SIZE = 24;
const VEHICLE_SIZE = 22;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// react-leaflet rebuilds a marker's DOM whenever its icon identity changes, so icons are shared.
const cache = new Map<string, DivIcon>();

function markerIcon(className: string, size: number, heading?: number): DivIcon {
  const degrees = heading === undefined ? undefined : Math.round(heading);
  const key = `${className}:${degrees}`;
  let icon = cache.get(key);
  if (!icon) {
    const arrow =
      degrees === undefined ? "" : `<i class="marker-arrow" style="--heading:${degrees}deg"></i>`;
    icon = divIcon({
      className: `marker ${className}`,
      iconSize: [size, size],
      html: `${arrow}<i class="marker-dot"></i>`,
    });
    cache.set(key, icon);
  }
  return icon;
}

export type StopMarkerState = "default" | "selected" | "dimmed";

export function stopIcon(direction: string | undefined, state: StopMarkerState): DivIcon {
  const octant = COMPASS.indexOf(direction ?? "");
  return markerIcon(`marker-stop marker-${state}`, STOP_SIZE, octant < 0 ? undefined : octant * 45);
}

export function vehicleIcon(heading: number | undefined, hasGps: boolean): DivIcon {
  return markerIcon(`marker-vehicle ${hasGps ? "marker-live" : ""}`, VEHICLE_SIZE, heading);
}

export const USER_ICON = divIcon({ className: "marker-user", iconSize: [16, 16] });
