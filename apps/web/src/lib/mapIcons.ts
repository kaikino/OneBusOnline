import type L from "leaflet";
import leaflet from "leaflet";
import type { RouteVehicle } from "@onebus/shared";

const ICON_SIZE = 24;
const ICON_HALF = ICON_SIZE / 2;

export const USER_LOCATION_ICON = leaflet.divIcon({
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#22c55e;border:2.5px solid #fff;box-shadow:0 0 6px rgba(34,197,94,0.5);"></div>',
});

export function directionToDegrees(direction?: string): number | null {
  if (!direction) return null;
  const d = direction.trim().toUpperCase();
  if (!d) return null;
  if (/^-?\d+(\.\d+)?$/.test(d)) {
    const n = Number(d);
    if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
  }
  const cardinal = d.replace(/[^NSEW]/g, "");
  const m: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
    E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
    W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return m[cardinal] ?? null;
}

const STOP_ICON_CACHE = new Map<string, L.DivIcon>();

export function stopIcon(
  selected: boolean,
  dirDeg: number | null,
  dimmed = false
): L.DivIcon {
  const key = `${selected ? "s" : "u"}:${dimmed ? "d" : "n"}:${dirDeg ?? "x"}`;
  const cached = STOP_ICON_CACHE.get(key);
  if (cached) return cached;

  const dotSize = selected ? 18 : 18;
  const dotBorder = selected ? 2 : 2;
  const dotColor = selected ? "#facc15" : "#0ea5e9";
  const dotBorderColor = selected ? "#ffffff" : "#0f172a";
  const baseDotOpacity = selected ? 1 : 0.7;
  const dotOpacity = dimmed ? baseDotOpacity * 0.25 : baseDotOpacity;
  const dotOffset = (ICON_SIZE - dotSize) / 2;

  let html = "";

  if (dirDeg != null) {
    const triW = 12;
    const triH = 8;
    const triColor = selected ? "#facc15" : "#0ea5e9";
    const triLeft = (ICON_SIZE - triW) / 2;
    const triTop = (ICON_SIZE - triH) / 2;
    const triOpacity = dimmed ? 0.25 : 1;
    html += `<div style="position:absolute;left:${triLeft}px;top:${triTop}px;width:${triW}px;height:${triH}px;clip-path:polygon(50% 0%,0% 100%,100% 100%);background:${triColor};outline:1px solid #fff;opacity:${triOpacity};transform:rotate(${dirDeg}deg) translateY(-${ICON_HALF - 1}px);transform-origin:50% 50%;"></div>`;
  }

  html += `<div style="position:absolute;left:${dotOffset}px;top:${dotOffset}px;width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dotColor};border:${dotBorder}px solid ${dotBorderColor};opacity:${dotOpacity};"></div>`;

  const icon = leaflet.divIcon({
    className: "",
    iconSize: [ICON_SIZE, ICON_SIZE],
    iconAnchor: [ICON_HALF, ICON_HALF],
    html: `<div style="position:relative;width:${ICON_SIZE}px;height:${ICON_SIZE}px;">${html}</div>`,
  });
  STOP_ICON_CACHE.set(key, icon);
  return icon;
}

const VEHICLE_ICON_CACHE = new Map<string, L.DivIcon>();

/** `liveGps`: full opacity + glow; schedule-interpolated coords are dimmed like non-AVL. */
export function vehicleIcon(orientation?: number, liveGps = true): L.DivIcon {
  const hasDir = orientation != null && Number.isFinite(orientation);
  const key = `${liveGps ? "g" : "s"}:${hasDir ? `o:${Math.round(orientation!)}` : "x"}`;
  const cached = VEHICLE_ICON_CACHE.get(key);
  if (cached) return cached;

  const size = 22;
  const half = size / 2;
  const dot = 14;
  const dotOffset = (size - dot) / 2;
  const color = "#f97316"; // orange-500 — distinct from sky stops + green user
  const border = "#ffffff";
  const wrapperOpacity = liveGps ? 1 : 0.75;
  const dotShadow = liveGps
    ? "box-shadow:0 0 6px rgba(249,115,22,0.55);"
    : "";

  let html = "";
  if (hasDir) {
    const triW = 12;
    const triH = 9;
    const triLeft = (size - triW) / 2;
    const triTop = (size - triH) / 2;
    html += `<div style="position:absolute;left:${triLeft}px;top:${triTop}px;width:${triW}px;height:${triH}px;clip-path:polygon(50% 0%,0% 100%,100% 100%);background:${color};outline:1.5px solid ${border};transform:rotate(${orientation}deg) translateY(-${half - 1}px);transform-origin:50% 50%;"></div>`;
  }
  html += `<div style="position:absolute;left:${dotOffset}px;top:${dotOffset}px;width:${dot}px;height:${dot}px;border-radius:50%;background:${color};border:2px solid ${border};${dotShadow}"></div>`;

  const icon = leaflet.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [half, half],
    html: `<div style="position:relative;width:${size}px;height:${size}px;opacity:${wrapperOpacity};">${html}</div>`,
  });
  VEHICLE_ICON_CACHE.set(key, icon);
  return icon;
}

export function vehicleKey(v: RouteVehicle): string {
  // tripId first — `vehicleId` can be reused across trips in some agencies,
  // which would collapse two real buses to one React key and visually drop a
  // marker. Pair it with vehicleId so reassignments mid-day still re-key.
  return `${v.tripId}::${v.vehicleId ?? ""}`;
}
