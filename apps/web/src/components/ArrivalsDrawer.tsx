import { useQuery } from "@tanstack/react-query";
import type { StopSummary } from "@onebus/shared";
import { Bus, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Drawer } from "vaul";
import {
  fetchArrivals,
  loadCachedArrivals,
  saveCachedArrivals,
} from "../api";
import {
  displayTimeMs,
  minutesUntil,
  punctualityClasses,
} from "../arrivalUi";

export function ArrivalsDrawer(props: {
  stop: StopSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nowMs: number;
}) {
  const stopId = props.stop?.id ?? "";

  const query = useQuery({
    queryKey: ["arrivals", stopId],
    queryFn: () => fetchArrivals(stopId),
    enabled: props.open && Boolean(stopId),
    staleTime: 15_000,
    refetchInterval: props.open ? 20_000 : false,
    placeholderData: () =>
      stopId ? loadCachedArrivals(stopId) ?? undefined : undefined,
  });

  useEffect(() => {
    if (query.data && stopId) {
      saveCachedArrivals(stopId, query.data);
    }
  }, [query.data, stopId]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const cached = stopId ? loadCachedArrivals(stopId) : null;
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
                const label =
                  mins < 0
                    ? "Due"
                    : mins < 1
                      ? "< 1 min"
                      : `${Math.round(mins)} min`;
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
                        {row.numberOfStopsAway > 0
                          ? `${row.numberOfStopsAway} stops away`
                          : row.predicted
                            ? "Live ETA"
                            : "Scheduled"}
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
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
