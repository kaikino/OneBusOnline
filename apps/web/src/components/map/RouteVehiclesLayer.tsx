import type { RouteVehicle } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useState } from "react";
import { Marker, Popup } from "react-leaflet";
import { fetchRouteVehicles } from "../../api";
import { headsignKey } from "../../lib/routeFilter";
import { vehicleIcon, vehicleKey } from "../../lib/mapIcons";
import { formatRelativeAge } from "../../lib/relativeTime";
import { deviationMinutes } from "../../arrivalUi";

/**
 * Mirrors server `wallClockUnixMs`: some feeds/cache entries use unix seconds.
 * Prefer fresh API data; keeps popups sane for older cached payloads.
 */
function coerceRealtimeEpochMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return ms;
  return ms >= 100_000_000_000 ? ms : ms * 1000;
}

function VehiclePopupContent({ v }: { v: RouteVehicle }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const liveGps = v.liveGpsPosition ?? v.predicted;
  const lastMs = coerceRealtimeEpochMs(v.lastUpdateMs);
  const ageMs = tick - lastMs;
  const ageLabel = formatRelativeAge(ageMs);
  const stale = liveGps && ageMs > 60_000;

  const source = (() => {
    if (!liveGps) {
      return {
        label: "Position from schedule",
        cls: "text-red-400",
      };
    }
    if (stale) {
      return {
        label: `Last GPS · ${ageLabel}`,
        cls: "text-amber-300",
      };
    }
    return {
      label: `Live GPS · ${ageLabel}`,
      cls: "text-emerald-400",
    };
  })();

  const dev = v.scheduleDeviationSec || 0;
  const punctuality = (() => {
    if (!v.predicted) return { label: "Scheduled (no live update)", cls: "text-slate-400" };
    if (Math.abs(dev) < 90) return { label: "On time", cls: "text-emerald-400" };
    if (dev > 0) {
      return { label: `${deviationMinutes(dev)} min late`, cls: "text-amber-400" };
    }
    return { label: `${deviationMinutes(dev)} min early`, cls: "text-sky-300" };
  })();

  const occupancyLabel = (() => {
    if (!v.occupancyStatus) return null;
    return v.occupancyStatus
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  })();

  return (
    <div className="min-w-[12rem] text-slate-100">
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold text-sky-300">
          {v.routeShortName ?? v.routeId}
        </span>
        {v.headsign ? (
          <span className="truncate text-sm text-slate-300">→ {v.headsign}</span>
        ) : null}
      </div>
      <div className={`mt-1 text-sm font-medium ${punctuality.cls}`}>
        {punctuality.label}
      </div>
      <div className={`mt-0.5 text-xs ${source.cls}`}>{source.label}</div>
      {v.vehicleId || occupancyLabel ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-300">
          {v.vehicleId ? (
            <>
              <dt className="text-slate-500">Bus</dt>
              <dd className="font-mono">{v.vehicleId}</dd>
            </>
          ) : null}
          {occupancyLabel ? (
            <>
              <dt className="text-slate-500">Occupancy</dt>
              <dd>{occupancyLabel}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

export const RouteVehiclesLayer = memo(
  function RouteVehiclesLayer(props: {
    routeId: string;
    /** Normalized headsing key (`RouteFilter.headsign`); restricts markers to direction. */
    directionHeadsign?: string | null;
  }) {
    const { routeId, directionHeadsign } = props;
    const query = useQuery({
      queryKey: ["routeVehicles", routeId],
      queryFn: () => fetchRouteVehicles(routeId),
      staleTime: 10_000,
      gcTime: 5 * 60 * 1000,
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    });

    const vehicles = useMemo(() => {
      const list = query.data?.vehicles ?? [];
      if (!directionHeadsign) return list;
      return list.filter(
        (v) => headsignKey(v.headsign) === directionHeadsign,
      );
    }, [directionHeadsign, query.data?.vehicles]);

    if (vehicles.length === 0) return null;

    return (
      <>
        {vehicles.map((v) => (
          <Marker
            key={vehicleKey(v)}
            position={[v.lat, v.lon]}
            icon={vehicleIcon(v.orientation, v.liveGpsPosition ?? v.predicted)}
            zIndexOffset={500}
          >
            <Popup
              className="vehicle-popup"
              closeButton={false}
              maxWidth={260}
              autoPan
            >
              <VehiclePopupContent v={v} />
            </Popup>
          </Marker>
        ))}
      </>
    );
  },
  (prev, next) => prev.routeId === next.routeId
);
