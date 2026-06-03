import type { Vehicle } from "@onebus/shared";
import { useNow } from "../../hooks/useNow";
import { formatAge } from "../../lib/format";

const ON_TIME_TOLERANCE_SEC = 90;
const STALE_GPS_MS = 60_000;

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

export function VehiclePopup({ vehicle }: { vehicle: Vehicle }) {
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
