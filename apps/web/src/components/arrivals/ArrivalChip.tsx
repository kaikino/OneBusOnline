import type { Arrival } from "@onebus/shared";
import { PUNCTUALITY_COLOR, etaLabel } from "../../lib/format";

interface Props {
  arrival: Arrival;
  now: number;
  active: boolean;
  onToggle: () => void;
}

export function ArrivalChip({ arrival, now, active, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`flex shrink-0 flex-col rounded-lg border px-2.5 py-1.5 text-left transition ${
        active
          ? "border-slate-300/70 bg-slate-900"
          : "border-slate-700 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900"
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm">
        <span className="font-bold text-sky-300">{arrival.routeShortName}</span>
        <span className={`font-semibold tabular-nums ${PUNCTUALITY_COLOR[arrival.punctuality]}`}>
          {etaLabel(arrival.arrivalTimeMs, now)}
        </span>
      </span>
      <span className="max-w-[7rem] truncate text-[0.65rem] leading-tight text-slate-400">
        {arrival.headsign}
      </span>
    </button>
  );
}
