import type { StopSummary } from "@onebus/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export const PREVIEW_HEIGHT_PX = 132;
const EXPANDED_VH = 0.74;
const VELOCITY_THRESHOLD = 0.4;
const CLOSE_VELOCITY_THRESHOLD = 0.6;
const CHIPS_DIR_THRESHOLD = 6;

export function expandedHeightPx(): number {
  return Math.round(window.innerHeight * EXPANDED_VH);
}

/** Resting Y of the sheet in preview mode (preview height is fixed). */
function previewRestY(): number {
  return expandedHeightPx() - PREVIEW_HEIGHT_PX;
}

function releaseSwitchY(): number {
  return previewRestY() / 2;
}

function previewCloseY(): number {
  return Math.min(expandedHeightPx(), previewRestY() + 88);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,select,textarea,[role='button'],[contenteditable='true']",
    ),
  );
}

/**
 * Owns the bottom-sheet drag/collapse/close mechanics: pointer drag on the
 * handle, overscroll-to-drag in the expanded list, the horizontal-vs-vertical
 * chip-strip gesture, outside-tap dismissal, the `collapseSeq` collapse signal,
 * and the slide-out close animation. Behavior must stay identical to the
 * original inline implementation.
 */
export function useDragSheet(params: {
  stopId: string;
  open: boolean;
  stop: StopSummary | null;
  onOpenChange: (open: boolean) => void;
  collapseSeq?: number;
  onPreviewHeightChange?: (height: number) => void;
}) {
  const { stopId, open, stop, onOpenChange, collapseSeq, onPreviewHeightChange } =
    params;

  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const [translateY, setTranslateY] = useState(() => previewRestY());

  useEffect(() => {
    onPreviewHeightChange?.(PREVIEW_HEIGHT_PX);
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
  /** Snapshot of `stop` taken at the moment the close animation begins.
   *  We notify the parent immediately (so the selected-stop marker can
   *  recolor and the locate button can drop back), but the drawer keeps
   *  rendering for 500ms while sliding out — we read from this snapshot so
   *  the title doesn't flicker to "Stop" mid-animation. */
  const [closingStopSnapshot, setClosingStopSnapshot] = useState<StopSummary | null>(null);
  const stopForDisplay = closingStopSnapshot ?? stop;

  /** Animate to a rest position on the next frame (after the current paint). */
  const settleTo = useCallback((y: number) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTranslateY(y));
    });
  }, []);

  /** Expanded -> preview, keeping the slide animation. */
  const collapseToPreview = useCallback(() => {
    expandedRef.current = false;
    setExpanded(false);
    settleTo(previewRestY());
  }, [settleTo]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closingRef.current = false;
    setClosing(false);
    setClosingStopSnapshot(null);
  }, []);

  const animateClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setClosingStopSnapshot(stop);
    setDragging(false);
    draggingRef.current = false;
    setTranslateY(expandedHeightPx() + 40);
    // Notify the parent right away so dependent UI (stop marker color,
    // floating locate button) updates as soon as the slide-out starts,
    // not 500ms later when the animation finishes.
    onOpenChange(false);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      closingRef.current = false;
      setClosing(false);
      setClosingStopSnapshot(null);
    }, 500);
  }, [onOpenChange, stop]);

  useEffect(() => {
    cancelClose();
    setExpanded(false);
    expandedRef.current = false;
    setTranslateY(previewRestY());
    setDragging(false);
    outsideDownRef.current = null;
  }, [stopId, cancelClose]);

  useEffect(() => {
    if (!collapseSeq || !open) return;
    if (expandedRef.current) collapseToPreview();
  }, [collapseSeq, open, collapseToPreview]);

  // Outside tap: expanded -> preview, preview -> close.
  // Only fires on clean taps (no drag/scroll/zoom).
  const outsideDownRef = useRef<{ x: number; y: number; stopId: string } | null>(null);
  const stopIdRef = useRef(stopId);
  stopIdRef.current = stopId;

  useEffect(() => {
    if (!open) return;
    const isOutside = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return false;
      if (!(e.target instanceof Node)) return false;
      if (panel.contains(e.target)) return false;
      if (
        (e.target as Element).closest?.(
          "button, .leaflet-control, .leaflet-popup, .leaflet-marker-icon, input, [data-ui-control]"
        )
      )
        return false;
      return true;
    };
    const onDown = (e: PointerEvent) => {
      // If a Leaflet popup (e.g. vehicle metadata) is currently open, let
      // Leaflet handle the click — close the popup but keep the drawer.
      if (document.querySelector(".leaflet-popup")) {
        outsideDownRef.current = null;
        return;
      }
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
        collapseToPreview();
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
  }, [open, collapseToPreview, animateClose]);

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
      const switchY = previewRestY();
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
    const startedFromPreview = dragBaseTranslateRef.current >= previewRestY() - 1;

    const closeFrom = () => {
      pointerHistoryRef.current = [];
      pointerIdRef.current = null;
      setTranslateY(clamped);
      animateClose();
    };

    // Velocity-based close: fast flick down from preview closes the panel
    if (startedFromPreview && velocity > CLOSE_VELOCITY_THRESHOLD) {
      closeFrom();
      return;
    }

    let targetExpanded: boolean;
    if (velocity > VELOCITY_THRESHOLD) {
      targetExpanded = false;
    } else if (velocity < -VELOCITY_THRESHOLD) {
      targetExpanded = true;
    } else {
      targetExpanded = clamped < releaseSwitchY();
    }

    // Position-based close: released well below preview rest
    if (!targetExpanded && startedFromPreview && clamped >= previewCloseY()) {
      closeFrom();
      return;
    }

    expandedRef.current = targetExpanded;
    setExpanded(targetExpanded);

    pointerHistoryRef.current = [];
    pointerIdRef.current = null;
    draggingRef.current = false;

    setTranslateY(clamped);
    setDragging(false);

    settleTo(targetExpanded ? 0 : previewRestY());
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
    setTranslateY(expandedRef.current ? 0 : previewRestY());
  };

  // --- Scroll-area: expanded only — overscroll at top/bottom pulls the sheet. Preview uses chip strip + handle; leaving these on in preview confuses the next tap after expand/collapse (stale gestures, preventDefault vs click). ---
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !open || !expanded) return;

    const onTouchStart = (e: TouchEvent) => {
      if (chipsDragActive.current || chipsGesture.current) return;
      if (e.touches.length !== 1) return;
      // If the gesture starts on a control (route row tiles, etc.), skip
      // overscroll→panel-drag bookkeeping. Otherwise a tiny downward move at
      // scroll-top (or upward at scroll-bottom) can call preventDefault on
      // touchmove before iOS emits the click — the classic "needs two taps".
      if (isInteractiveTarget(e.target)) return;
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
  }, [expanded, open]);

  /** Preview ↔ expanded resets chip scroll-vs-drag bookkeeping so the next tap isn't eaten (stale chipsGesture or pan preventDefault killing click). */
  useEffect(() => {
    chipsGesture.current = null;
    chipsDragActive.current = false;
    scrollPointerStartY.current = null;
    scrollTakeover.current = false;
  }, [expanded]);

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
    dragBaseTranslateRef.current = previewRestY();
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
      // Touches that begin on a route chip are taps; don't attach pan bookkeeping or
      // the first touchmove can call preventDefault and block the click (iOS/WebKit).
      if (isInteractiveTarget(e.target)) return;
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
  }, [expanded, open]);

  return {
    expanded,
    dragging,
    draggingRef,
    translateY,
    closing,
    stopForDisplay,
    panelRef,
    scrollRef,
    chipsRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancelDrag,
  };
}
