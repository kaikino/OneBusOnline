import type { ArrivalsResponse, Stop } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { Bus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchArrivals } from "../api";
import { PUNCTUALITY_COLOR, etaLabel, formatClock, punctualityLabel } from "../arrivalUi";
import { useOnline } from "../hooks/useOnline";

const MINUTES_AFTER = 120;
const EXTEND_STEP_MINUTES = 120;

const storageKey = (stopId: string) => `onebus:arrivals:${stopId}`;

function loadSaved(stopId: string): ArrivalsResponse | undefined {
  try {
    const saved = localStorage.getItem(storageKey(stopId));
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

function save(response: ArrivalsResponse) {
  try {
    localStorage.setItem(storageKey(response.stopId), JSON.stringify(response));
  } catch {
    // Storage is full or unavailable; arrivals just won't be available offline.
  }
}

/** Live arrivals for a stop, falling back to the last saved response when the network fails. */
function useArrivals(stopId: string) {
  const [minutesAfter, setMinutesAfter] = useState(MINUTES_AFTER);

  const [windowStopId, setWindowStopId] = useState(stopId);
  if (windowStopId !== stopId) {
    setWindowStopId(stopId);
    setMinutesAfter(MINUTES_AFTER);
  }

  const query = useQuery({
    queryKey: ["arrivals", stopId, minutesAfter],
    queryFn: () => fetchArrivals(stopId, minutesAfter),
    staleTime: 15_000,
    refetchInterval: 20_000,
    // Keeps the list in place while a longer window loads.
    placeholderData: (previous) => (previous?.stopId === stopId ? previous : undefined),
  });

  useEffect(() => {
    if (query.data && !query.isPlaceholderData) save(query.data);
  }, [query.data, query.isPlaceholderData]);

  const saved = useMemo(() => loadSaved(stopId), [stopId]);

  return {
    arrivals: (query.data ?? saved)?.arrivals ?? [],
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isFailing: query.failureCount > 0,
    minutesAfter,
    refresh: () => void query.refetch(),
    extend: () => setMinutesAfter((minutes) => minutes + EXTEND_STEP_MINUTES),
  };
}

/** The current time, refreshed every `intervalMs`. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function ArrivalsDrawer({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const now = useNow(5000);
  const online = useOnline();
  const { arrivals, isLoading, isFetching, isFailing, minutesAfter, refresh, extend } =
    useArrivals(stop.id);

  let notice: string | null = null;
  if (arrivals.length > 0) {
    if (isFailing) {
      notice = online
        ? "Server unreachable — arrivals may be outdated."
        : "Offline — showing last saved arrivals for this stop.";
    }
  } else if (isFailing) {
    notice = online ? "Failed to fetch arrivals." : "You are offline with no saved arrivals.";
  } else {
    notice = isLoading ? "Loading…" : "No upcoming arrivals.";
  }

  return (
    <section className="fixed inset-x-0 bottom-0 z-[2001] flex max-h-[60dvh] flex-col rounded-t-2xl border border-slate-700 bg-slate-950 px-4 pb-[env(safe-area-inset-bottom,0px)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-slate-50">
          <Bus className="h-5 w-5 shrink-0 text-sky-400" aria-hidden />
          <span className="truncate">{stop.name}</span>
        </h2>
        <div className="flex shrink-0 gap-1 text-slate-400">
          <button
            type="button"
            onClick={refresh}
            disabled={isFetching}
            aria-label="Refresh arrivals"
            className="rounded-md p-1 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      {stop.code && <p className="mt-1 text-sm text-slate-400">Code {stop.code}</p>}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        {notice && <p className="mb-2 text-sm text-slate-400">{notice}</p>}
        <ul className="space-y-2">
          {arrivals.map((arrival) => (
            <li
              key={`${arrival.tripId}:${arrival.scheduledTimeMs}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  <span className="text-sky-300">{arrival.routeShortName}</span>
                  <span className="ml-2 text-slate-300">{arrival.headsign}</span>
                </div>
                <div className="text-xs text-slate-500">
                  Arriving at {formatClock(arrival.arrivalTimeMs)} (
                  {punctualityLabel(arrival.punctuality, arrival.deviationSec)})
                </div>
              </div>
              <div
                className={`shrink-0 text-lg font-semibold tabular-nums ${PUNCTUALITY_COLOR[arrival.punctuality]}`}
              >
                {etaLabel(arrival.arrivalTimeMs, now)}
              </div>
            </li>
          ))}
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
      </div>
    </section>
  );
}
