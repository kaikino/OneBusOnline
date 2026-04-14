import { useQuery } from "@tanstack/react-query";
import type { StopSummary } from "@onebus/shared";
import { Bus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import {
  ARRIVALS_EXTEND_STEP_MIN,
  ARRIVALS_QUERY_WINDOW,
  fetchArrivals,
  loadCachedArrivals,
  saveCachedArrivals,
} from "../api";
import {
  displayTimeMs,
  minutesUntil,
  punctualityClasses,
} from "../arrivalUi";

const ARRIVAL_CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function ArrivalsDrawer(props: {
  stop: StopSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nowMs: number;
}) {
  const stopId = props.stop?.id ?? "";
  const before = ARRIVALS_QUERY_WINDOW.minutesBefore;

  const [minutesAfterLimit, setMinutesAfterLimit] = useState(
    ARRIVALS_QUERY_WINDOW.minutesAfter
  );

  useEffect(() => {
    setMinutesAfterLimit(ARRIVALS_QUERY_WINDOW.minutesAfter);
  }, [stopId]);

  const query = useQuery({
    queryKey: ["arrivals", stopId, minutesAfterLimit, before],
    queryFn: () =>
      fetchArrivals(stopId, { minutesAfter: minutesAfterLimit, minutesBefore: before }),
    enabled: props.open && Boolean(stopId),
    staleTime: 15_000,
    refetchInterval: props.open ? 20_000 : false,
    placeholderData: (previousData) =>
      previousData ??
      (stopId
        ? loadCachedArrivals(stopId, minutesAfterLimit, before) ?? undefined
        : undefined),
  });

  useEffect(() => {
    if (query.data && stopId) {
      saveCachedArrivals(stopId, query.data, minutesAfterLimit, before);
    }
  }, [query.data, stopId, minutesAfterLimit, before]);

  const nextMinutesAfter = minutesAfterLimit + ARRIVALS_EXTEND_STEP_MIN;
  const nextHours = nextMinutesAfter / 60;
  const nextHoursLabel = Number.isInteger(nextHours)
    ? String(nextHours)
    : nextHours.toFixed(1).replace(/\.0$/, "");

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const cached = stopId ? loadCachedArrivals(stopId, minutesAfterLimit, before) : null;
  const rows = query.data?.arrivals ?? cached?.arrivals ?? [];
  const showStaleBanner = offline && query.isError && rows.length > 0;

  return (
    <Drawer.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
      shouldScaleBackground
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[2000] bg-black/50" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[2001] flex max-h-[85vh] flex-col rounded-t-2xl border border-slate-700 bg-slate-950 px-4 pb-8 pt-2 outline-none">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-600" />
          <div className="flex items-start justify-between gap-2 pr-1">
            <Drawer.Title className="flex items-center gap-2 text-lg font-semibold text-slate-50">
              <Bus className="h-5 w-5 shrink-0 text-sky-400" aria-hidden />
              {props.stop?.name ?? "Stop"}
            </Drawer.Title>
            {query.isFetching && !query.isPending ? (
              <RefreshCw
                className="mt-1 h-4 w-4 shrink-0 animate-spin text-slate-500"
                aria-label="Refreshing"
              />
            ) : null}
          </div>
          <Drawer.Description className="mt-1 text-sm text-slate-400">
            {props.stop?.code
              ? `Code ${props.stop.code}`
              : "Arrivals refresh every ~20s when open"}
          </Drawer.Description>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {query.isError && rows.length === 0 ? (
              <p className="text-sm text-red-400">
                {offline
                  ? "You are offline with no saved arrivals for this stop yet."
                  : (query.error as Error).message}
              </p>
            ) : null}
            {showStaleBanner ? (
              <p className="mb-2 text-xs text-amber-400">
                Offline — showing last saved arrivals for this stop.
              </p>
            ) : null}
            {rows.length === 0 && query.isSuccess ? (
              <p className="text-sm text-slate-500">No upcoming arrivals.</p>
            ) : null}
            <ul className="space-y-2">
              {rows.map((row) => {
                const t = displayTimeMs(row);
                const mins = minutesUntil(t, props.nowMs);
                const roundedMins = Math.round(mins);
                const label =
                  mins < 1 && mins >= 0
                    ? "< 1 min"
                    : `${roundedMins} min`;
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
                const arrivalVerb = mins < 0 ? "Arrived" : "Arriving";
                return (
                  <li
                    key={`${row.tripId}-${row.scheduledArrivalTimeMs}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-100">
                        <span className="text-sky-300">{row.routeShortName}</span>
                        {row.headsign ? (
                          <span className="ml-2 text-slate-300">
                            {row.headsign}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500">
                        {`${arrivalVerb} at ${arrivalClock} (${etaStatus})`}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 text-right text-lg font-semibold tabular-nums ${punctualityClasses(row.punctuality)}`}
                    >
                      {label}
                    </div>
                  </li>
                );
              })}
            </ul>
            {Boolean(stopId) ? (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <button
                  type="button"
                  disabled={query.isFetching || offline}
                  onClick={() => setMinutesAfterLimit(nextMinutesAfter)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:border-sky-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {query.isFetching
                    ? "Loading…"
                    : `Show more arrivals (next ${nextHoursLabel} hours)`}
                </button>
              </div>
            ) : null}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
