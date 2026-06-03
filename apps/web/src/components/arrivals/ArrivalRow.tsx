import type { Arrival } from "@onebus/shared";
import {
  PUNCTUALITY_COLOR,
  etaLabel,
  formatClock,
  hasDeparted,
  punctualityLabel,
} from "../../lib/format";

interface Props {
  arrival: Arrival;
  now: number;
  active: boolean;
  onToggle: () => void;
}

export function ArrivalRow({ arrival, now, active, onToggle }: Props) {
  const departed = hasDeparted(arrival.arrivalTimeMs, now);
  const status = punctualityLabel(arrival.punctuality, arrival.deviationSec);

  let tile = "border-slate-800 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900";
  if (active) tile = "border-slate-300/70 bg-slate-900";
  if (departed) tile = "border-slate-800 bg-slate-900/60 opacity-60";

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${tile}`}
      >
        <div className="min-w-0">
          <div className="font-medium">
            <span className="text-sky-300">{arrival.routeShortName}</span>
            <span className="ml-2 text-slate-300">{arrival.headsign}</span>
          </div>
          <div className="text-xs text-slate-500">
            {departed ? "Arrived" : "Arriving"} at {formatClock(arrival.arrivalTimeMs)} (
            {arrival.punctuality === "scheduled" ? status : `Live • ${status}`})
          </div>
        </div>
        <div
          className={`shrink-0 text-lg font-semibold tabular-nums ${PUNCTUALITY_COLOR[arrival.punctuality]}`}
        >
          {etaLabel(arrival.arrivalTimeMs, now)}
        </div>
      </button>
    </li>
  );
}
