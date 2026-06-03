import type { ArrivalRow } from "@onebus/shared";
import { useRef } from "react";
import { displayTimeMs, minutesUntil, punctualityClasses } from "../../arrivalUi";
import { headsignKey, rowMatchesFilter, type RouteFilter } from "../../lib/routeFilter";
import { useTouchPrimaryTap } from "../../hooks/useTouchPrimaryTap";

const ARRIVAL_CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function ExpandedRow({
  row,
  nowMs,
  routeFilter,
  onRouteFilterChange,
}: {
  row: ArrivalRow;
  nowMs: number;
  routeFilter: RouteFilter | null;
  onRouteFilterChange?: (filter: RouteFilter | null) => void;
}) {
  const t = displayTimeMs(row);
  const mins = minutesUntil(t, nowMs);
  const roundedMins = Math.trunc(mins);
  const label = roundedMins === 0 ? "NOW" : mins < 1 && mins >= 0 ? "< 1 min" : `${roundedMins} min`;
  const isOld = mins <= -1;
  const scheduledOnly = row.punctuality === "scheduled_only";
  const etaStatus = (() => {
    if (scheduledOnly) return "Scheduled";
    if (row.punctuality === "on_time") return "Live • On time";
    if (row.punctuality === "late") {
      const sec = row.scheduleDeviationSec ?? 0;
      const minLate = Math.max(1, Math.round(sec / 60));
      return `Live • ${minLate} min late`;
    }
    if (row.punctuality === "early") {
      const sec = Math.abs(row.scheduleDeviationSec ?? 0);
      const minEarly = Math.max(1, Math.round(sec / 60));
      return `Live • ${minEarly} min early`;
    }
    return "Live";
  })();
  const arrivalClock = ARRIVAL_CLOCK.format(new Date(t));
  const arrivalVerb = mins <= -1 ? "Arrived" : "Arriving";

  const routeActive = routeFilter != null && rowMatchesFilter(row, routeFilter);
  const tileClass = isOld
    ? "border-slate-800 bg-slate-900/60 text-slate-400"
      : routeActive
        ? "border-slate-300/70 bg-slate-900"
        : "border-slate-800 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900";

  const handleClick = () => {
    if (!onRouteFilterChange) return;
    onRouteFilterChange(
      routeActive
        ? null
        : { routeId: row.routeId, headsign: headsignKey(row.headsign) }
    );
  };

  const rowBtnRef = useRef<HTMLButtonElement>(null);
  const onDedupedClick = useTouchPrimaryTap(rowBtnRef, handleClick);

  const ariaLabel = routeActive
    ? `Clear filter for ${row.routeShortName}${row.headsign ? ` toward ${row.headsign}` : ""}`
    : `Show only ${row.routeShortName}${row.headsign ? ` toward ${row.headsign}` : ""}`;

  return (
    <li>
      <button
        ref={rowBtnRef}
        type="button"
        onClick={onDedupedClick}
        aria-pressed={routeActive}
        aria-label={ariaLabel}
        className={`flex w-full touch-manipulation items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${tileClass}`}
      >
        <div className="min-w-0">
          <div className={`font-medium ${isOld ? "text-slate-400" : "text-slate-100"}`}>
            <span className={isOld ? "text-slate-400" : "text-sky-300"}>{row.routeShortName}</span>
            {row.headsign ? (
              <span className={`ml-2 ${isOld ? "text-slate-400" : "text-slate-300"}`}>{row.headsign}</span>
            ) : null}
          </div>
          <div className="text-xs text-slate-500">
            {`${arrivalVerb} at ${arrivalClock} (${etaStatus})`}
          </div>
        </div>
        <div
          className={`shrink-0 text-right text-lg font-semibold tabular-nums ${isOld ? "text-slate-400" : punctualityClasses(row.punctuality)}`}
        >
          {label}
        </div>
      </button>
    </li>
  );
}
