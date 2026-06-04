import { type PointerEvent, type RefObject, useRef, useState } from "react";

export type SheetSnap = "expanded" | "preview" | "closed";

const FLICK_VELOCITY = 0.4;
const CLOSE_VELOCITY = 0.6;
const CLOSE_DISTANCE_PX = 88;
const VELOCITY_WINDOW_MS = 100;

interface Gesture {
  startY: number;
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
 * strip `previewHeight` px tall (plus the sheet's bottom padding).
 */
export function useSheetDrag(options: {
  sheetRef: RefObject<HTMLElement | null>;
  expanded: boolean;
  previewHeight: number;
  onSnap: (snap: SheetSnap) => void;
}) {
  const { sheetRef, expanded, previewHeight, onSnap } = options;
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ offset: number; raised: boolean } | null>(null);

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
    onSnap(snapFor(g, offsetAt(g, e.clientY), velocity));
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
