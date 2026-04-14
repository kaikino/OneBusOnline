import { useQuery } from "@tanstack/react-query";
import type { StopSummary } from "@onebus/shared";
import { Bus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

const PREVIEW_HEIGHT_PX = 148;
const EXPANDED_VH = 0.74;
const VELOCITY_THRESHOLD = 0.4;

function expandedHeightPx(): number {
  return Math.round(window.innerHeight * EXPANDED_VH);
}

/**
 * The panel always has the expanded height. In "preview" mode it's pushed down
 * so only PREVIEW_HEIGHT_PX is visible. This offset is the resting translateY
 * for preview mode.
 */
function previewRestY(): number {
  return expandedHeightPx() - PREVIEW_HEIGHT_PX;
}

/** Release threshold: midpoint between expanded rest (0) and preview rest. */
function releaseSwitchY(): number {
  return previewRestY() / 2;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,select,textarea,[role='button'],[contenteditable='true']",
    ),
  );
}

export function ArrivalsDrawer(props: {
  stop: StopSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nowMs: number;
}) {
  const stopId = props.stop?.id ?? "";
  const before = ARRIVALS_QUERY_WINDOW.minutesBefore;

  // `expanded` only controls which content to show (chips vs full list).
  // The panel height is always expandedHeightPx().
  // In preview mode, translateY = previewRestY() (pushed down).
  // In expanded mode, translateY = 0.
  const [expanded, setExpanded] = useState(false);
  const [translateY, setTranslateY] = useState(previewRestY);
  const [dragging, setDragging] = useState(false);

  const expandedRef = useRef(false);
  const draggingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragStartYRef = useRef(0);
  const dragBaseTranslateRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const pointerHistoryRef = useRef<{ y: number; t: number }[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollPointerStartY = useRef<number | null>(null);
  const scrollTakeover = useRef(false);

  const [minutesAfterLimit, setMinutesAfterLimit] = useState(
    ARRIVALS_QUERY_WINDOW.minutesAfter,
  );

  useEffect(() => {
    setMinutesAfterLimit(ARRIVALS_QUERY_WINDOW.minutesAfter);
    setExpanded(false);
    expandedRef.current = false;
    setTranslateY(previewRestY());
    setDragging(false);
  }, [stopId]);

  // Outside tap: expanded -> preview, preview -> close.
  // Only fires on clean taps (no drag/scroll/zoom).
  const outsideDownRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!props.open) return;
    const isOutside = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return false;
      if (!(e.target instanceof Node)) return false;
      return !panel.contains(e.target);
    };
    const onDown = (e: PointerEvent) => {
      if (isOutside(e)) {
        outsideDownRef.current = { x: e.clientX, y: e.clientY };
      } else {
        outsideDownRef.current = null;
      }
    };
    const onUp = (e: PointerEvent) => {
      const start = outsideDownRef.current;
      outsideDownRef.current = null;
      if (!start) return;
      if (!isOutside(e)) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 10 * 10) return; // moved too much — drag/scroll
      if (expandedRef.current) {
        expandedRef.current = false;
        setExpanded(false);
        setTranslateY(previewRestY());
      } else {
        props.onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
    };
  }, [props.open, props.onOpenChange]);

  // --- Data fetching ---
  const query = useQuery({
    queryKey: ["arrivals", stopId, minutesAfterLimit, before],
    queryFn: () =>
      fetchArrivals(stopId, {
        minutesAfter: minutesAfterLimit,
        minutesBefore: before,
      }),
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
  const cached = stopId
    ? loadCachedArrivals(stopId, minutesAfterLimit, before)
    : null;
  const rows = query.data?.arrivals ?? cached?.arrivals ?? [];

  const previewRows = useMemo(() => {
    const out: typeof rows = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const routeKey = row.routeId || row.routeShortName;
      if (seen.has(routeKey)) continue;
      seen.add(routeKey);
      out.push(row);
      if (out.length >= 6) break;
    }
    return out;
  }, [rows]);

  const hiddenCount = Math.max(0, rows.length - previewRows.length);
  const showStaleBanner = offline && query.isError && rows.length > 0;

  const dataAgeMs = query.dataUpdatedAt ? props.nowMs - query.dataUpdatedAt : 0;
  const serverUnreachable = !offline && query.failureCount > 0 && rows.length > 0;
  const dataAgeLabel = dataAgeMs >= 120_000
    ? `${Math.floor(dataAgeMs / 60_000)} min ago`
    : dataAgeMs >= 60_000
      ? "1 min ago"
      : "";

  // --- Drag helpers ---
  const beginDrag = (clientY: number, timeStamp: number, pointerId: number, el: Element) => {
    dragStartYRef.current = clientY;
    dragBaseTranslateRef.current = translateY;
    pointerIdRef.current = pointerId;
    pointerHistoryRef.current = [{ y: clientY, t: timeStamp }];
    draggingRef.current = true;
    setDragging(true);
    el.setPointerCapture(pointerId);
  };

  const applyDrag = (clientY: number, timeStamp: number) => {
    const dy = clientY - dragStartYRef.current;
    const rawTranslate = dragBaseTranslateRef.current + dy;
    // Clamp: can't drag above expanded rest (0) or below off-screen
    const clamped = Math.max(-40, Math.min(expandedHeightPx(), rawTranslate));

    // Switch content mid-drag based on position
    const switchY = previewRestY();
    const shouldExpand = clamped < switchY;
    if (shouldExpand !== expandedRef.current) {
      expandedRef.current = shouldExpand;
      setExpanded(shouldExpand);
    }

    const hist = pointerHistoryRef.current;
    hist.push({ y: clientY, t: timeStamp });
    while (hist.length > 1 && timeStamp - hist[0].t > 100) hist.shift();
    setTranslateY(clamped);
  };

  const finishDrag = (clientY: number, timeStamp: number) => {
    const hist = pointerHistoryRef.current;
    const oldest = hist[0];
    const dt = oldest ? timeStamp - oldest.t : 0;
    const dy = oldest ? clientY - oldest.y : 0;
    const velocity = dt > 5 ? dy / dt : 0;

    const finalTranslate = dragBaseTranslateRef.current + (clientY - dragStartYRef.current);
    const clamped = Math.max(-40, Math.min(expandedHeightPx(), finalTranslate));

    let targetExpanded: boolean;
    if (velocity > VELOCITY_THRESHOLD) {
      targetExpanded = false;
    } else if (velocity < -VELOCITY_THRESHOLD) {
      targetExpanded = true;
    } else {
      targetExpanded = clamped < releaseSwitchY();
    }

    expandedRef.current = targetExpanded;
    setExpanded(targetExpanded);

    pointerHistoryRef.current = [];
    draggingRef.current = false;

    // Set translateY to current position, enable transition, then animate to rest
    setTranslateY(clamped);
    setDragging(false);

    const restY = targetExpanded ? 0 : previewRestY();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTranslateY(restY);
      });
    });
  };

  // --- Handle / overlay pointer handlers ---
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (isInteractiveTarget(e.target)) return;
    e.preventDefault();
    beginDrag(e.clientY, e.timeStamp, e.pointerId, e.currentTarget);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    applyDrag(e.clientY, e.timeStamp);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current == null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointerIdRef.current = null;
    finishDrag(e.clientY, e.timeStamp);
  };

  const cancelDrag = () => {
    pointerIdRef.current = null;
    scrollPointerStartY.current = null;
    scrollTakeover.current = false;
    draggingRef.current = false;
    setDragging(false);
    setTranslateY(expandedRef.current ? 0 : previewRestY());
  };

  // --- Scroll-area: intercept overscroll at boundaries via touch events ---
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !props.open) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      scrollPointerStartY.current = e.touches[0].clientY;
      scrollTakeover.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const clientY = e.touches[0].clientY;
      const now = e.timeStamp;

      if (scrollTakeover.current) {
        e.preventDefault();
        applyDrag(clientY, now);
        return;
      }

      if (scrollPointerStartY.current == null) return;
      const dy = clientY - scrollPointerStartY.current;
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;

      if ((dy > 6 && atTop) || (dy < -6 && atBottom)) {
        scrollTakeover.current = true;
        draggingRef.current = true;
        e.preventDefault();
        dragStartYRef.current = clientY;
        dragBaseTranslateRef.current = translateY;
        pointerHistoryRef.current = [{ y: clientY, t: now }];
        setDragging(true);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (scrollTakeover.current) {
        scrollTakeover.current = false;
        scrollPointerStartY.current = null;
        const clientY = e.changedTouches[0]?.clientY ?? 0;
        finishDrag(clientY, e.timeStamp);
      } else {
        scrollPointerStartY.current = null;
      }
    };

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });
    scroller.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [props.open, translateY]);

  if (!props.open) return null;

  const panelHeight = expandedHeightPx();

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-[2001]">
      <section
        ref={panelRef}
        style={{
          height: panelHeight,
          transform: `translateY(${translateY}px)`,
        }}
        className={`pointer-events-auto relative flex flex-col rounded-t-2xl border border-slate-700 bg-slate-950 px-4 pt-2 pb-4 outline-none will-change-transform ${
          dragging ? "" : "transition-transform duration-500 ease-out"
        }`}
      >
        {/* Background extension so map never peeks through */}
        <div className="absolute -left-4 -right-4 top-0 -z-10 h-[200vh] bg-slate-950" />

        {/* Drag zone: handle + header */}
        <div
          className="cursor-ns-resize touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
        >
          <div className="px-1 pt-1 -mx-1 mb-1">
            <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-slate-600" />
          </div>
          <div className="flex items-start justify-between gap-2 pr-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-50">
              <Bus className="h-5 w-5 shrink-0 text-sky-400" aria-hidden />
              {props.stop?.name ?? "Stop"}
            </h2>
            {query.isFetching && !query.isPending ? (
              <RefreshCw
                className="mt-1 h-4 w-4 shrink-0 animate-spin text-slate-500"
                aria-label="Refreshing"
              />
            ) : null}
          </div>
          {expanded && props.stop?.code ? (
            <p className="mt-1 text-sm text-slate-400">{`Code ${props.stop.code}`}</p>
          ) : null}
        </div>

        {/* Drag overlay — in preview mode or during any active drag */}
        {(!expanded || dragging) && (
          <div
            className="absolute bottom-0 left-0 right-0 z-10 touch-none select-none"
            style={{ top: 0 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelDrag}
          />
        )}

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          className={`mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain ${!expanded ? "overflow-hidden" : "touch-auto"}`}
        >
          {query.isError && rows.length === 0 ? (
            <p className="text-sm text-red-400">
              {offline
                ? "You are offline with no saved arrivals for this stop yet."
                : "Failed to fetch arrivals."}
            </p>
          ) : null}
          {showStaleBanner ? (
            <p className="mb-2 text-xs text-amber-400">
              Offline — showing last saved arrivals for this stop.
            </p>
          ) : null}
          {serverUnreachable ? (
            <p className="mb-2 text-xs text-amber-400">
              Server unreachable — arrivals may be outdated.{dataAgeLabel ? ` Last updated ${dataAgeLabel}.` : ""}
            </p>
          ) : null}
          {rows.length === 0 && query.isPending ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : null}
          {rows.length === 0 && query.isSuccess ? (
            <p className="text-sm text-slate-500">No upcoming arrivals.</p>
          ) : null}

          {expanded ? (
            <>
              <ul className="space-y-2">
                {(expanded ? rows : previewRows).map((row) => (
                  <ExpandedRow key={`${row.tripId}-${row.scheduledArrivalTimeMs}`} row={row} nowMs={props.nowMs} />
                ))}
              </ul>
              {Boolean(stopId) && (
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
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {previewRows.map((row) => (
                  <PreviewChip key={`${row.tripId}-${row.scheduledArrivalTimeMs}`} row={row} nowMs={props.nowMs} />
                ))}
              </div>
              {hiddenCount > 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  +{hiddenCount} more
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ─── Sub-components ─── */

function PreviewChip({ row, nowMs }: { row: any; nowMs: number }) {
  const t = displayTimeMs(row);
  const mins = minutesUntil(t, nowMs);
  const roundedMins = Math.round(mins);
  const label = mins < 1 && mins >= 0 ? "<1 min" : `${roundedMins} min`;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 ${punctualityClasses(row.punctuality)}`}
    >
      <span className="text-sm font-bold text-sky-300">
        {row.routeShortName}
      </span>
      <span className="text-sm font-semibold tabular-nums">{label}</span>
    </div>
  );
}

function ExpandedRow({ row, nowMs }: { row: any; nowMs: number }) {
  const t = displayTimeMs(row);
  const mins = minutesUntil(t, nowMs);
  const roundedMins = Math.round(mins);
  const label = mins < 1 && mins >= 0 ? "< 1 min" : `${roundedMins} min`;
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
    <li className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2">
      <div className="min-w-0">
        <div className="font-medium text-slate-100">
          <span className="text-sky-300">{row.routeShortName}</span>
          {row.headsign ? (
            <span className="ml-2 text-slate-300">{row.headsign}</span>
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
}
