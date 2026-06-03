import type { ArrivalRow } from "@onebus/shared";
import { useRef } from "react";
import { displayTimeMs, minutesUntil, punctualityClasses } from "../../arrivalUi";
import { headsignKey, rowMatchesFilter, type RouteFilter } from "../../lib/routeFilter";
import { useTouchPrimaryTap } from "../../hooks/useTouchPrimaryTap";

export function PreviewChip({
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
  const label = roundedMins === 0 ? "NOW" : mins < 1 && mins >= 0 ? "<1 min" : `${roundedMins} min`;
  const isOld = mins <= -1;
  const chipActive = routeFilter != null && rowMatchesFilter(row, routeFilter);
  const borderBg = isOld
    ? "border-slate-800 bg-slate-900/60"
    : chipActive
      ? "border-slate-300/70 bg-slate-900"
      : "border-slate-700 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900";

  const handleClick = () => {
    if (!onRouteFilterChange) return;
    onRouteFilterChange(
      chipActive ? null : { routeId: row.routeId, headsign: headsignKey(row.headsign) },
    );
  };

  const btnRef = useRef<HTMLButtonElement>(null);
  const onDedupedClick = useTouchPrimaryTap(btnRef, handleClick);

  const ariaLabel = chipActive
    ? `Clear highlight for ${row.routeShortName}${row.headsign ? ` toward ${row.headsign}` : ""}`
    : `Highlight ${row.routeShortName}${row.headsign ? ` toward ${row.headsign}` : ""} on the map; open the full list to filter`;

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onDedupedClick}
      aria-pressed={chipActive}
      aria-label={ariaLabel}
      className={`touch-manipulation flex shrink-0 flex-col rounded-lg border px-2.5 py-1.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-sky-400 ${borderBg} ${isOld ? "text-slate-400" : punctualityClasses(row.punctuality)}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-bold ${isOld ? "text-slate-400" : "text-sky-300"}`}>
          {row.routeShortName}
        </span>
        <span className="text-sm font-semibold tabular-nums">{label}</span>
      </div>
      {row.headsign && (
        <span
          className={`max-w-[7rem] truncate text-[0.65rem] leading-tight ${isOld ? "text-slate-500" : "text-slate-400"}`}
        >
          {row.headsign}
        </span>
      )}
    </button>
  );
}
