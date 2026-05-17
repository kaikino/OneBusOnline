import type { Arrival, ArrivalsResponse, Stop } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { Bus, RefreshCw, X } from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchArrivals } from "../api";
import {
  PUNCTUALITY_COLOR,
  etaLabel,
  formatClock,
  hasDeparted,
  punctualityLabel,
} from "../arrivalUi";
import { useOnline } from "../hooks/useOnline";
import { type RouteFilter, matchesRoute } from "../routeFilter";

/** Visible height of the sheet in preview mode, excluding the bottom safe area. */
export const SHEET_PREVIEW_HEIGHT = 132;

const FLICK_VELOCITY = 0.4;
const CLOSE_VELOCITY = 0.6;
const CLOSE_DISTANCE_PX = 88;
const VELOCITY_WINDOW_MS = 100;

const MINUTES_BEFORE = 15;
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
function useArrivals(stopId: string | undefined) {
  const [minutesAfter, setMinutesAfter] = useState(MINUTES_AFTER);

  const [windowStopId, setWindowStopId] = useState(stopId);
  if (windowStopId !== stopId) {
    setWindowStopId(stopId);
    setMinutesAfter(MINUTES_AFTER);
  }

  const query = useQuery({
    queryKey: ["arrivals", stopId, minutesAfter],
    queryFn: () => fetchArrivals(stopId!, minutesAfter, MINUTES_BEFORE),
    enabled: stopId !== undefined,
    staleTime: 15_000,
    refetchInterval: 20_000,
    // Keeps the list in place while a longer window loads.
    placeholderData: (previous) => (previous?.stopId === stopId ? previous : undefined),
  });

  useEffect(() => {
    if (query.data && !query.isPlaceholderData) save(query.data);
  }, [query.data, query.isPlaceholderData]);

  const saved = useMemo(() => (stopId ? loadSaved(stopId) : undefined), [stopId]);

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

export type SheetSnap = "expanded" | "preview" | "closed";

interface Gesture {
  startY: number;
  startOffset: number;
  previewOffset: number;
  maxOffset: number;
  samples: { y: number; time: number }[];
}

/**
 * Vertical drag for a bottom sheet that rests either expanded or as a preview
 * strip `previewHeight` px tall (plus the sheet's bottom padding).
 */
function useSheetDrag(options: {
  sheetRef: RefObject<HTMLElement | null>;
  expanded: boolean;
  previewHeight: number;
  onSnap: (snap: SheetSnap) => void;
}) {
  const { sheetRef, expanded, previewHeight, onSnap } = options;
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ offset: number; raised: boolean } | null>(null);

  /** Px below the expanded position. */
  const offsetAt = (g: Gesture, clientY: number) =>
    Math.min(g.maxOffset, Math.max(0, g.startOffset + clientY - g.startY));

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const sheet = sheetRef.current;
    if (!sheet || (e.target as Element).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const bottomPadding = parseFloat(getComputedStyle(sheet).paddingBottom);
    const previewOffset = sheet.offsetHeight - previewHeight - bottomPadding;
    const startOffset = expanded ? 0 : previewOffset;
    gesture.current = {
      startY: e.clientY,
      startOffset,
      previewOffset,
      maxOffset: sheet.offsetHeight,
      samples: [{ y: e.clientY, time: e.timeStamp }],
    };
    setDrag({ offset: startOffset, raised: expanded });
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    g.samples.push({ y: e.clientY, time: e.timeStamp });
    while (e.timeStamp - g.samples[0].time > VELOCITY_WINDOW_MS) g.samples.shift();
    const offset = offsetAt(g, e.clientY);
    setDrag({ offset, raised: offset < g.previewOffset });
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDrag(null);

    const oldest = g.samples[0];
    const elapsed = e.timeStamp - oldest.time;
    const velocity = elapsed > 0 ? (e.clientY - oldest.y) / elapsed : 0;
    const offset = offsetAt(g, e.clientY);
    const fromPreview = g.startOffset === g.previewOffset;
    const pastCloseDistance = offset > g.previewOffset + CLOSE_DISTANCE_PX;
    if (velocity < -FLICK_VELOCITY) onSnap("expanded");
    else if (fromPreview && (velocity > CLOSE_VELOCITY || pastCloseDistance)) onSnap("closed");
    else if (velocity > FLICK_VELOCITY) onSnap("preview");
    else onSnap(offset < g.previewOffset / 2 ? "expanded" : "preview");
  };

  const onPointerCancel = () => {
    gesture.current = null;
    setDrag(null);
  };

  return {
    /** Px below the expanded position while a drag is in progress. */
    dragOffset: drag?.offset,
    /** Whether the sheet currently shows more than its preview strip. */
    raised: drag?.raised ?? expanded,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}

function restingTransform(open: boolean, expanded: boolean): string {
  if (!open) return "translateY(100%)";
  if (expanded) return "translateY(0)";
  return `translateY(calc(100% - ${SHEET_PREVIEW_HEIGHT}px - env(safe-area-inset-bottom, 0px)))`;
}

function BottomSheet(props: {
  open: boolean;
  expanded: boolean;
  onSnap: (snap: SheetSnap) => void;
  header: ReactNode;
  /** Receives whether the sheet shows more than its preview strip, which flips mid-drag. */
  children: (raised: boolean) => ReactNode;
}) {
  const { open, expanded, onSnap, header, children } = props;
  const sheetRef = useRef<HTMLElement>(null);
  const { dragOffset, raised, handlers } = useSheetDrag({
    sheetRef,
    expanded,
    previewHeight: SHEET_PREVIEW_HEIGHT,
    onSnap,
  });
  const dragging = dragOffset !== undefined;

  return (
    <section
      ref={sheetRef}
      inert={!open}
      style={{
        transform: dragging ? `translateY(${dragOffset}px)` : restingTransform(open, expanded),
      }}
      className={`fixed inset-x-0 bottom-0 z-[2001] flex h-[74dvh] flex-col rounded-t-2xl border border-slate-700 bg-slate-950 px-4 pb-[env(safe-area-inset-bottom,0px)] ${
        dragging ? "" : "transition-transform duration-500 ease-out"
      }`}
    >
      <div className="cursor-grab touch-none select-none pt-3" {...handlers}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-600" />
        {header}
      </div>
      {children(raised)}
    </section>
  );
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

function ArrivalChip({ arrival, now }: { arrival: Arrival; now: number }) {
  return (
    <div className="flex shrink-0 flex-col rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 text-sm">
        <span className="font-bold text-sky-300">{arrival.routeShortName}</span>
        <span className={`font-semibold tabular-nums ${PUNCTUALITY_COLOR[arrival.punctuality]}`}>
          {etaLabel(arrival.arrivalTimeMs, now)}
        </span>
      </span>
      <span className="max-w-[7rem] truncate text-[0.65rem] leading-tight text-slate-400">
        {arrival.headsign}
      </span>
    </div>
  );
}

interface ArrivalRowProps {
  arrival: Arrival;
  now: number;
  active: boolean;
  onToggle: () => void;
}

function ArrivalRow({ arrival, now, active, onToggle }: ArrivalRowProps) {
  const departed = hasDeparted(arrival.arrivalTimeMs, now);

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
            {punctualityLabel(arrival.punctuality, arrival.deviationSec)})
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

interface Props {
  stop: Stop | null;
  expanded: boolean;
  onSnap: (snap: SheetSnap) => void;
  routeFilter: RouteFilter | null;
  onRouteFilterChange: (filter: RouteFilter | null) => void;
}

export function ArrivalsDrawer({ stop, expanded, onSnap, routeFilter, onRouteFilterChange }: Props) {
  const now = useNow(5000);
  const online = useOnline();
  const { arrivals, isLoading, isFetching, isFailing, minutesAfter, refresh, extend } =
    useArrivals(stop?.id);

  // Keeps the stop on screen while the sheet slides closed.
  const [shownStop, setShownStop] = useState(stop);
  if (stop && stop !== shownStop) setShownStop(stop);

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

  const header = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-slate-50">
          <Bus className="h-5 w-5 shrink-0 text-sky-400" aria-hidden />
          <span className="truncate">{shownStop?.name}</span>
        </h2>
        <button
          type="button"
          onClick={refresh}
          disabled={isFetching}
          aria-label="Refresh arrivals"
          className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </div>
      {expanded && shownStop?.code && (
        <p className="mt-1 text-sm text-slate-400">Code {shownStop.code}</p>
      )}
    </>
  );

  return (
    <BottomSheet open={stop !== null} expanded={expanded} onSnap={onSnap} header={header}>
      {(raised) => (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
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
              <ul className="space-y-2">
                {listed.map((arrival) => (
                  <ArrivalRow
                    key={`${arrival.tripId}:${arrival.scheduledTimeMs}`}
                    {...toggleProps(arrival)}
                  />
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
            </>
          ) : (
            <div className="scrollbar-none flex gap-2 overflow-x-auto">
              {nextPerRoute(arrivals, now).map((arrival) => (
                <ArrivalChip key={routeKey(arrival)} arrival={arrival} now={now} />
              ))}
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
