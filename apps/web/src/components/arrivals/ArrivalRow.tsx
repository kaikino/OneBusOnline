import type { Arrival } from "@onebus/shared";
import { Bell, BellPlus } from "lucide-react";
import type { ReactNode } from "react";
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
  /** Whether a notification is set for this arrival. */
  notifying: boolean;
  onNotify: () => void;
  /** Shown under the tile, such as the notification form. */
  children?: ReactNode;
}

export function ArrivalRow({
  arrival,
  now,
  active,
  onToggle,
  notifying,
  onNotify,
  children,
}: Props) {
  const departed = hasDeparted(arrival.arrivalTimeMs, now);
  const status = punctualityLabel(arrival.punctuality, arrival.deviationSec);

  let tile = "border-slate-800 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900";
  if (active) tile = "border-slate-300/70 bg-slate-900";
  if (departed) tile = "border-slate-800 bg-slate-900/60 opacity-60";

  return (
    <li>
      <div className={`flex items-stretch rounded-lg border transition ${tile}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={active}
          className={`flex min-w-0 flex-1 items-center justify-between gap-3 py-2 pl-3 text-left ${departed ? "pr-3" : ""}`}
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
        {!departed && (
          <button
            type="button"
            onClick={onNotify}
            aria-label={notifying ? "Edit bus notification" : "Notify me about this bus"}
            className="shrink-0 px-3 text-slate-500 hover:text-slate-200"
          >
            {notifying ? (
              <Bell className="h-4 w-4 fill-sky-400 text-sky-400" aria-hidden />
            ) : (
              <BellPlus className="h-4 w-4" aria-hidden />
            )}
          </button>
        )}
      </div>
      {children}
    </li>
  );
}
