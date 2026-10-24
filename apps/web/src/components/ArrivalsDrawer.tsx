import type { Arrival, Stop } from "@onebus/shared";
import { Bus, RefreshCw, Star, X } from "lucide-react";
import { useState } from "react";
import { EXTEND_STEP_MINUTES, useArrivals } from "../hooks/useArrivals";
import { useNow } from "../hooks/useNow";
import { useOnline } from "../hooks/useOnline";
import { useReminders, useSavedStops } from "../hooks/useSaved";
import type { SheetSnap } from "../hooks/useSheetDrag";
import { hasDeparted } from "../lib/format";
import { type RouteFilter, matchesRoute } from "../lib/routeFilter";
import { reminderForArrival, toggleSaved } from "../lib/saved";
import { ArrivalChip } from "./arrivals/ArrivalChip";
import { ArrivalRow } from "./arrivals/ArrivalRow";
import { BottomSheet } from "./BottomSheet";
import { QuickReminder } from "./saved/QuickReminder";

interface Props {
  stop: Stop | null;
  expanded: boolean;
  onSnap: (snap: SheetSnap) => void;
  routeFilter: RouteFilter | null;
  onRouteFilterChange: (filter: RouteFilter | null) => void;
}

const routeKey = (arrival: Arrival) => `${arrival.routeId}:${arrival.headsign}`;

/** The next upcoming arrival of each route and direction. */
function nextPerRoute(arrivals: Arrival[], now: number): Arrival[] {
  const next = new Map<string, Arrival>();
  for (const arrival of arrivals) {
    if (hasDeparted(arrival.arrivalTimeMs, now) || next.has(routeKey(arrival))) continue;
    next.set(routeKey(arrival), arrival);
  }
  return [...next.values()];
}

export function ArrivalsDrawer({
  stop,
  expanded,
  onSnap,
  routeFilter,
  onRouteFilterChange,
}: Props) {
  const now = useNow(5000);
  const online = useOnline();
  const savedStops = useSavedStops();
  const allReminders = useReminders();
  /** The arrival whose notification form is open. */
  const [notifyKey, setNotifyKey] = useState<string>();

  // Keeps the stop and its arrivals on screen while the sheet slides closed.
  const [shownStop, setShownStop] = useState(stop);
  if (stop && stop !== shownStop) {
    setShownStop(stop);
    setNotifyKey(undefined);
  }

  const {
    arrivals,
    isLoading,
    isFetching,
    isRefreshing,
    isFailing,
    minutesAfter,
    refresh,
    extend,
  } = useArrivals(shownStop?.id, stop !== null);

  const listed = routeFilter
    ? arrivals.filter((arrival) => matchesRoute(routeFilter, arrival))
    : arrivals;

  const toggleProps = (arrival: Arrival) => {
    const active = routeFilter !== null && matchesRoute(routeFilter, arrival);
    return {
      arrival,
      now,
      active,
      onToggle: () =>
        onRouteFilterChange(
          active ? null : { routeId: arrival.routeId, headsign: arrival.headsign },
        ),
    };
  };

  let notice: string | null = null;
  if (arrivals.length > 0) {
    if (!online) notice = "Offline — showing last saved arrivals for this stop.";
    else if (isFailing) notice = "Server unreachable — arrivals may be outdated.";
  } else if (!online) {
    notice = "You are offline with no saved arrivals.";
  } else if (isFailing) {
    notice = "Failed to fetch arrivals.";
  } else {
    notice = isLoading ? "Loading…" : "No upcoming arrivals.";
  }

  const saved = savedStops.some((saved) => saved.id === shownStop?.id);

  const header = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-slate-50">
          <Bus className="h-5 w-5 shrink-0 text-sky-400" aria-hidden />
          <span className="truncate">{shownStop?.name}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => shownStop && toggleSaved(shownStop)}
            aria-pressed={saved}
            aria-label={saved ? "Remove saved stop" : "Save stop"}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <Star className={`h-4 w-4 ${saved ? "fill-pink-500 text-pink-500" : ""}`} aria-hidden />
          </button>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh arrivals"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </div>
      {expanded && shownStop?.code && (
        <p className="mt-1 text-sm text-slate-400">Code {shownStop.code}</p>
      )}
    </>
  );

  return (
    <BottomSheet open={stop !== null} expanded={expanded} onSnap={onSnap} header={header}>
      {(raised) => (
        <>
          {notice && <p className="mb-2 text-sm text-slate-400">{notice}</p>}
          {raised ? (
            <>
              {routeFilter && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-sky-700/60 bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-200">
                  <span className="truncate">Showing only this route</span>
                  <button
                    type="button"
                    onClick={() => onRouteFilterChange(null)}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-sky-500/20"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Clear
                  </button>
                </div>
              )}
              {listed.length === 0 && arrivals.length > 0 && (
                <p className="mb-2 text-sm text-slate-400">No upcoming arrivals for this route.</p>
              )}
              <ul className="space-y-2">
                {listed.map((arrival) => {
                  const key = `${arrival.tripId}:${arrival.scheduledTimeMs}`;
                  const reminder = shownStop
                    ? reminderForArrival(allReminders, shownStop.id, arrival)
                    : undefined;
                  return (
                    <ArrivalRow
                      key={key}
                      {...toggleProps(arrival)}
                      notifying={reminder !== undefined}
                      onNotify={() => setNotifyKey(notifyKey === key ? undefined : key)}
                    >
                      {notifyKey === key && shownStop && (
                        <QuickReminder
                          stop={shownStop}
                          arrival={arrival}
                          existing={reminder}
                          now={now}
                          onDone={() => setNotifyKey(undefined)}
                        />
                      )}
                    </ArrivalRow>
                  );
                })}
              </ul>
              <button
                type="button"
                disabled={isFetching || !online}
                onClick={extend}
                className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:border-sky-600 hover:bg-slate-800 disabled:opacity-50"
              >
                {isFetching
                  ? "Loading…"
                  : `Show more arrivals (next ${(minutesAfter + EXTEND_STEP_MINUTES) / 60} hours)`}
              </button>
            </>
          ) : (
            <div className="scrollbar-none flex touch-pan-x gap-2 overflow-x-auto">
              {nextPerRoute(arrivals, now).map((arrival) => (
                <ArrivalChip key={routeKey(arrival)} {...toggleProps(arrival)} />
              ))}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}
