import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

export type SheetSnap = "expanded" | "preview" | "closed";

const DRAG_SLOP_PX = 6;
const FLICK_VELOCITY = 0.4;
const CLOSE_VELOCITY = 0.6;
const CLOSE_DISTANCE_PX = 88;
const VELOCITY_WINDOW_MS = 100;

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  startedInScroller: boolean;
  /** False until the pointer has moved far enough, vertically, to count as a drag. */
  dragging: boolean;
  startOffset: number;
  previewOffset: number;
  maxOffset: number;
  samples: { y: number; time: number }[];
}

/** Velocity is in px/ms, positive downward. Offsets are px below the expanded position. */
function snapFor(gesture: Gesture, offset: number, velocity: number): SheetSnap {
  const fromPreview = gesture.startOffset === gesture.previewOffset;
  const pastCloseDistance = offset > gesture.previewOffset + CLOSE_DISTANCE_PX;
  if (velocity < -FLICK_VELOCITY) return "expanded";
  if (fromPreview && (velocity > CLOSE_VELOCITY || pastCloseDistance)) return "closed";
  if (velocity > FLICK_VELOCITY) return "preview";
  return offset < gesture.previewOffset / 2 ? "expanded" : "preview";
}

/**
 * Vertical drag for a bottom sheet that rests either expanded or as a preview
 * strip `previewHeight` px tall (plus the sheet's bottom padding). A drag can
 * start anywhere on the sheet; inside `scrollerRef` it only takes over when the
 * content can't scroll any further in the direction of the pull.
 */
export function useSheetDrag(options: {
  sheetRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  expanded: boolean;
  previewHeight: number;
  onSnap: (snap: SheetSnap) => void;
}) {
  const { sheetRef, scrollerRef, expanded, previewHeight, onSnap } = options;
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ offset: number; raised: boolean } | null>(null);

  // Touch browsers scroll unless the touchmove itself is cancelled.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const blockScroll = (e: TouchEvent) => {
      if (gesture.current?.dragging && e.cancelable) e.preventDefault();
    };
    sheet.addEventListener("touchmove", blockScroll, { passive: false });
    return () => sheet.removeEventListener("touchmove", blockScroll);
  }, [sheetRef]);

  const offsetAt = (g: Gesture, clientY: number) =>
    Math.min(g.maxOffset, Math.max(0, g.startOffset + clientY - g.startY));

  const canScrollNatively = (g: Gesture, deltaY: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || !g.startedInScroller) return false;
    return deltaY > 0
      ? scroller.scrollTop > 0
      : scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
  };

  const onPointerDown = (down: ReactPointerEvent<HTMLElement>) => {
    const sheet = sheetRef.current;
    if (!sheet || gesture.current || down.button !== 0) return;

    const bottomPadding = parseFloat(getComputedStyle(sheet).paddingBottom);
    const previewOffset = sheet.offsetHeight - previewHeight - bottomPadding;
    const g: Gesture = {
      pointerId: down.pointerId,
      startX: down.clientX,
      startY: down.clientY,
      startedInScroller: scrollerRef.current?.contains(down.target as Node) ?? false,
      dragging: false,
      startOffset: expanded ? 0 : previewOffset,
      previewOffset,
      maxOffset: sheet.offsetHeight,
      samples: [],
    };
    gesture.current = g;

    // The pointer is followed on the window: it can leave the sheet before the drag is recognised.
    const stopFollowing = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      gesture.current = null;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;

      if (!g.dragging) {
        const deltaX = e.clientX - g.startX;
        const deltaY = e.clientY - g.startY;
        if (Math.hypot(deltaX, deltaY) < DRAG_SLOP_PX) return;
        if (Math.abs(deltaX) > Math.abs(deltaY) || canScrollNatively(g, deltaY)) {
          stopFollowing();
          return;
        }
        g.dragging = true;
        // Capturing also keeps the release from clicking whatever the drag started on.
        sheet.setPointerCapture(g.pointerId);
      }

      g.samples.push({ y: e.clientY, time: e.timeStamp });
      while (e.timeStamp - g.samples[0].time > VELOCITY_WINDOW_MS) g.samples.shift();
      const offset = offsetAt(g, e.clientY);
      setDrag({ offset, raised: offset < g.previewOffset });
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;
      stopFollowing();
      if (!g.dragging) return;

      setDrag(null);
      const oldest = g.samples[0];
      const elapsed = e.timeStamp - oldest.time;
      const velocity = elapsed > 0 ? (e.clientY - oldest.y) / elapsed : 0;
      onSnap(snapFor(g, offsetAt(g, e.clientY), velocity));
    };

    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;
      stopFollowing();
      setDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  return {
    /** Px below the expanded position while a drag is in progress. */
    dragOffset: drag?.offset,
    /** Whether the sheet currently shows more than its preview strip. */
    raised: drag?.raised ?? expanded,
    handlers: { onPointerDown },
  };
}
