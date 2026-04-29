import { useQuery } from "@tanstack/react-query";
import type { StopSummary } from "@onebus/shared";
import { Bus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const PREVIEW_HEIGHT_PX = 132;
const EXPANDED_VH = 0.74;
const VELOCITY_THRESHOLD = 0.4;
const CLOSE_VELOCITY_THRESHOLD = 0.6;

function expandedHeightPx(): number {
  return Math.round(window.innerHeight * EXPANDED_VH);
}

function previewRestY(previewH: number): number {
  return expandedHeightPx() - previewH;
}

function releaseSwitchY(previewH: number): number {
  return previewRestY(previewH) / 2;
}

function previewCloseY(previewH: number): number {
  return Math.min(expandedHeightPx(), previewRestY(previewH) + 88);
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
  /** Increment to collapse from expanded to preview mode. */
  collapseSeq?: number;
  nowMs: number;
  onPreviewHeightChange?: (height: number) => void;
}) {
  const stopId = props.stop?.id ?? "";
  const before = ARRIVALS_QUERY_WINDOW.minutesBefore;

  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  const ph = () => PREVIEW_HEIGHT_PX;

  const [translateY, setTranslateY] = useState(() => previewRestY(PREVIEW_HEIGHT_PX));

  useEffect(() => {
    props.onPreviewHeightChange?.(PREVIEW_HEIGHT_PX);
  }, []);

  const translateYRef = useRef(translateY);
  translateYRef.current = translateY;
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

  const chipsRef = useRef<HTMLDivElement | null>(null);
  const chipsGesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft0: number;
    decided: "h" | "v" | null;
    didScrollH: boolean;
  } | null>(null);
  const chipsDocCleanup = useRef<(() => void) | null>(null);
  const chipsDragActive = useRef(false);

  const closingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closingRef.current = false;
    setClosing(false);
  }, []);

  const animateClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setDragging(false);
    draggingRef.current = false;
    setTranslateY(expandedHeightPx() + 40);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      closingRef.current = false;
      setClosing(false);
      props.onOpenChange(false);
    }, 500);
  }, [props.onOpenChange]);

  const [minutesAfterLimit, setMinutesAfterLimit] = useState(
    ARRIVALS_QUERY_WINDOW.minutesAfter,
  );

  useEffect(() => {
    cancelClose();
    setMinutesAfterLimit(ARRIVALS_QUERY_WINDOW.minutesAfter);
    setExpanded(false);
    expandedRef.current = false;
    setTranslateY(previewRestY(ph()));
    setDragging(false);
    outsideDownRef.current = null;
  }, [stopId, cancelClose]);

  useEffect(() => {
    if (!props.collapseSeq || !props.open) return;
    if (expandedRef.current) {
      expandedRef.current = false;
      setExpanded(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTranslateY(previewRestY(ph()));
        });
      });
    }
  }, [props.collapseSeq, props.open]);

  // Outside tap: expanded -> preview, preview -> close.
  // Only fires on clean taps (no drag/scroll/zoom).
  const outsideDownRef = useRef<{ x: number; y: number; stopId: string } | null>(null);
  const stopIdRef = useRef(stopId);
  stopIdRef.current = stopId;

  useEffect(() => {
    if (!props.open) return;
    const isOutside = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return false;
      if (!(e.target instanceof Node)) return false;
      if (panel.contains(e.target)) return false;
      if (
        (e.target as Element).closest?.(
          "button, .leaflet-control, input, [data-ui-control]"
        )
      )
        return false;
      return true;
    };
    const onDown = (e: PointerEvent) => {
      if (isOutside(e)) {
        outsideDownRef.current = { x: e.clientX, y: e.clientY, stopId: stopIdRef.current };
      } else {
        outsideDownRef.current = null;
      }
    };
    const onUp = (e: PointerEvent) => {
      const start = outsideDownRef.current;
      outsideDownRef.current = null;
      if (!start) return;
      if (start.stopId !== stopIdRef.current) return;
      if (!isOutside(e)) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 10 * 10) return;
      if (expandedRef.current) {
        expandedRef.current = false;
        setExpanded(false);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTranslateY(previewRestY(ph()));
          });
        });
      } else {
        animateClose();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
    };
  }, [props.open, props.onOpenChange, animateClose]);

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

  const [manualSpinning, setManualSpinning] = useState(false);
  const spinning = query.isFetching || manualSpinning;

  const handleRefetch = async () => {
    setManualSpinning(true);
    const minSpin = new Promise((r) => setTimeout(r, 600));
    await Promise.all([query.refetch(), minSpin]);
    setManualSpinning(false);
  };

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
      const routeKey = `${row.routeId || row.routeShortName}::${row.headsign || ""}`;
      if (seen.has(routeKey)) continue;
      const mins = minutesUntil(displayTimeMs(row), props.nowMs);
      if (mins <= -1) continue;
      seen.add(routeKey);
      out.push(row);
    }
    return out;
  }, [rows, props.nowMs]);

  const showStaleBanner = offline && query.isError && rows.length > 0;

  const dataAgeMs = query.dataUpdatedAt ? props.nowMs - query.dataUpdatedAt : 0;
  const serverUnreachable = !offline && query.failureCount > 0 && rows.length > 0;
  const dataAgeLabel = dataAgeMs >= 120_000
    ? `${Math.floor(dataAgeMs / 60_000)} min ago`
    : dataAgeMs >= 60_000
      ? "1 min ago"
      : "";

  // --- Drag helpers ---
  const beginDrag = (clientY: number, timeStamp: number, pointerId: number, el: Element | null, skipDragState = false) => {
    dragStartYRef.current = clientY;
    dragBaseTranslateRef.current = translateYRef.current;
    pointerIdRef.current = pointerId;
    pointerHistoryRef.current = [{ y: clientY, t: timeStamp }];
    draggingRef.current = true;
    if (!skipDragState) setDragging(true);
    if (el) el.setPointerCapture(pointerId);
  };

  const applyDrag = (clientY: number, timeStamp: number) => {
    const dy = clientY - dragStartYRef.current;
    const rawTranslate = dragBaseTranslateRef.current + dy;
    // Clamp: can't drag above expanded rest (0) or below off-screen
    const clamped = Math.max(-40, Math.min(expandedHeightPx(), rawTranslate));

    // Don't switch expanded state during a chips-initiated drag — changing
    // overflow/touch-action CSS mid-gesture causes the browser to steal the
    // touch for native scrolling, killing our document listeners.
    if (!chipsDragActive.current) {
      const switchY = previewRestY(ph());
      const shouldExpand = clamped < switchY;
      if (shouldExpand !== expandedRef.current) {
        expandedRef.current = shouldExpand;
        setExpanded(shouldExpand);
      }
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
    const startedFromPreview = dragBaseTranslateRef.current >= previewRestY(ph()) - 1;

    // Velocity-based close: fast flick down from preview closes the panel
    if (startedFromPreview && velocity > CLOSE_VELOCITY_THRESHOLD) {
      pointerHistoryRef.current = [];
      pointerIdRef.current = null;
      setTranslateY(clamped);
      animateClose();
      return;
    }

    let targetExpanded: boolean;
    if (velocity > VELOCITY_THRESHOLD) {
      targetExpanded = false;
    } else if (velocity < -VELOCITY_THRESHOLD) {
      targetExpanded = true;
    } else {
      targetExpanded = clamped < releaseSwitchY(ph());
    }

    // Position-based close: released well below preview rest
    if (!targetExpanded && startedFromPreview && clamped >= previewCloseY(ph())) {
      pointerHistoryRef.current = [];
      pointerIdRef.current = null;
      setTranslateY(clamped);
      animateClose();
      return;
    }

    expandedRef.current = targetExpanded;
    setExpanded(targetExpanded);

    pointerHistoryRef.current = [];
    pointerIdRef.current = null;
    draggingRef.current = false;

    setTranslateY(clamped);
    setDragging(false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const restY = targetExpanded ? 0 : previewRestY(ph());
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
    if (chipsDragActive.current) return;
    if (pointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    applyDrag(e.clientY, e.timeStamp);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (chipsDragActive.current) return;
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
    setTranslateY(expandedRef.current ? 0 : previewRestY(ph()));
  };

  // --- Scroll-area: intercept overscroll at boundaries via touch events ---
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !props.open) return;

    const onTouchStart = (e: TouchEvent) => {
      if (chipsDragActive.current || chipsGesture.current) return;
      if (e.touches.length !== 1) return;
      scrollPointerStartY.current = e.touches[0].clientY;
      scrollTakeover.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (chipsDragActive.current || chipsGesture.current) return;
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
        dragBaseTranslateRef.current = translateYRef.current;
        pointerHistoryRef.current = [{ y: clientY, t: now }];
        setDragging(true);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (chipsDragActive.current || chipsGesture.current) { scrollPointerStartY.current = null; return; }
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
  }, [props.open]);

  const CHIPS_DIR_THRESHOLD = 6;

  const cleanupChipsDoc = () => {
    if (chipsDocCleanup.current) {
      chipsDocCleanup.current();
      chipsDocCleanup.current = null;
    }
  };

  const startChipsVerticalDrag = (g: NonNullable<typeof chipsGesture.current>, clientY: number, timeStamp: number) => {
    chipsDragActive.current = true;
    expandedRef.current = false;
    setExpanded(false);
    beginDrag(g.startY, timeStamp, g.pointerId, null, true);
    dragBaseTranslateRef.current = previewRestY(ph());
    applyDrag(clientY, timeStamp);

    const onDocMove = (ev: TouchEvent) => {
      const gg = chipsGesture.current;
      if (!gg) return;
      const tt = Array.from(ev.touches).find((x) => x.identifier === gg.pointerId);
      if (!tt) return;
      ev.preventDefault();
      applyDrag(tt.clientY, ev.timeStamp);
    };
    const onDocEnd = (ev: TouchEvent) => {
      const gg = chipsGesture.current;
      if (!gg) return;
      const lifted = Array.from(ev.changedTouches).find((x) => x.identifier === gg.pointerId);
      if (!lifted) return;
      chipsGesture.current = null;
      chipsDragActive.current = false;
      finishDrag(lifted.clientY, ev.timeStamp);
      cleanupChipsDoc();
    };

    document.addEventListener("touchmove", onDocMove, { passive: false });
    document.addEventListener("touchend", onDocEnd, { passive: true });

    chipsDocCleanup.current = () => {
      document.removeEventListener("touchmove", onDocMove);
      document.removeEventListener("touchend", onDocEnd);
    };
  };

  useEffect(() => {
    const el = chipsRef.current;
    if (!el || expanded) return;

    const onStart = (e: TouchEvent) => {
      if (chipsGesture.current) return;
      cleanupChipsDoc();
      const t = e.touches[0];
      chipsGesture.current = {
        pointerId: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        scrollLeft0: el.scrollLeft,
        decided: null,
        didScrollH: false,
      };
    };

    const onMove = (e: TouchEvent) => {
      const g = chipsGesture.current;
      if (!g || g.decided === "v") return;
      const t = Array.from(e.touches).find((tt) => tt.identifier === g.pointerId);
      if (!t) return;

      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;

      if (!g.decided) {
        if (Math.abs(dx) >= CHIPS_DIR_THRESHOLD || Math.abs(dy) >= CHIPS_DIR_THRESHOLD) {
          g.decided = g.didScrollH || Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
          if (g.decided === "v") {
            e.preventDefault();
            startChipsVerticalDrag(g, t.clientY, e.timeStamp);
            return;
          }
        }
        if (g.decided === "h") e.preventDefault();
        return;
      }

      if (g.decided === "h") {
        e.preventDefault();
        g.didScrollH = true;
        el.scrollLeft = g.scrollLeft0 - dx;
      }
    };

    const onEnd = (e: TouchEvent) => {
      const g = chipsGesture.current;
      if (!g || g.decided === "v") return;
      const lifted = Array.from(e.changedTouches).find((tt) => tt.identifier === g.pointerId);
      if (!lifted) return;
      chipsGesture.current = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [expanded, props.open]);

  if (!props.open && !closing) return null;

  const panelHeight = expandedHeightPx();

  return (
    <div className="pointer-events-none fixed left-0 right-0 z-[2001]" style={{ bottom: `env(safe-area-inset-bottom, 0px)` }}>
      <section
        ref={panelRef}
        style={{
          height: panelHeight,
          transform: `translateY(${translateY}px)`,
          paddingBottom: `max(1rem, env(safe-area-inset-bottom, 0px))`,
        }}
        className={`pointer-events-auto relative flex flex-col rounded-t-2xl border border-slate-700 bg-slate-950 px-4 pt-2 outline-none will-change-transform ${
          dragging || draggingRef.current ? "" : "transition-transform duration-500 ease-out"
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
            <h2 className={`flex items-center gap-2 text-lg font-semibold text-slate-50 ${!expanded ? "min-w-0 truncate" : ""}`}>
              <Bus className="h-5 w-5 shrink-0 text-sky-400" aria-hidden />
              <span className={!expanded ? "truncate" : undefined}>{props.stop?.name ?? "Stop"}</span>
            </h2>
            <button
              type="button"
              onClick={handleRefetch}
              disabled={spinning}
              className="relative z-20 mt-0.5 shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
              aria-label="Refresh arrivals"
            >
              <RefreshCw
                className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`}
                aria-hidden
              />
            </button>
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
          className={`mt-2 min-h-0 flex-1 overscroll-contain ${expanded ? "overflow-y-auto touch-auto" : "overflow-hidden"}`}
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
            <div
              ref={chipsRef}
              className="relative z-20 flex gap-2 overflow-x-scroll pb-1 select-none scrollbar-none"
            >
              {previewRows.map((row) => (
                <PreviewChip key={`${row.tripId}-${row.scheduledArrivalTimeMs}`} row={row} nowMs={props.nowMs} />
              ))}
            </div>
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
  const roundedMins = Math.trunc(mins);
  const label = roundedMins === 0 ? "NOW" : mins < 1 && mins >= 0 ? "<1 min" : `${roundedMins} min`;
  const isOld = mins <= -1;

  return (
    <div
      className={`flex shrink-0 flex-col rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 ${isOld ? "text-slate-400" : punctualityClasses(row.punctuality)}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-bold ${isOld ? "text-slate-400" : "text-sky-300"}`}>
          {row.routeShortName}
        </span>
        <span className="text-sm font-semibold tabular-nums">{label}</span>
      </div>
      {row.headsign && (
        <span className={`text-[0.65rem] truncate max-w-[7rem] leading-tight ${isOld ? "text-slate-500" : "text-slate-400"}`}>
          {row.headsign}
        </span>
      )}
    </div>
  );
}

function ExpandedRow({ row, nowMs }: { row: any; nowMs: number }) {
  const t = displayTimeMs(row);
  const mins = minutesUntil(t, nowMs);
  const roundedMins = Math.trunc(mins);
  const label = roundedMins === 0 ? "NOW" : mins < 1 && mins >= 0 ? "< 1 min" : `${roundedMins} min`;
  const isOld = mins <= -1;
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
  const arrivalVerb = mins <= -1 ? "Arrived" : "Arriving";

  return (
    <li className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${isOld ? "border-slate-800 bg-slate-900/60 text-slate-400" : "border-slate-800 bg-slate-900/80"}`}>
      <div className="min-w-0">
        <div className={`font-medium ${isOld ? "text-slate-400" : "text-slate-100"}`}>
          <span className={isOld ? "text-slate-400" : "text-sky-300"}>{row.routeShortName}</span>
          {row.headsign ? (
            <span className={`ml-2 ${isOld ? "text-slate-400" : "text-slate-300"}`}>{row.headsign}</span>
          ) : null}
        </div>
        <div className={`text-xs ${isOld ? "text-slate-500" : "text-slate-500"}`}>
          {`${arrivalVerb} at ${arrivalClock} (${etaStatus})`}
        </div>
      </div>
      <div
        className={`shrink-0 text-right text-lg font-semibold tabular-nums ${isOld ? "text-slate-400" : punctualityClasses(row.punctuality)}`}
      >
        {label}
      </div>
    </li>
  );
}
