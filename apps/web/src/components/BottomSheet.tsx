import { type ReactNode, useRef } from "react";
import { type SheetSnap, useSheetDrag } from "../hooks/useSheetDrag";

/** Visible height of the sheet in preview mode, excluding the bottom safe area. */
export const SHEET_PREVIEW_HEIGHT = 132;

interface Props {
  open: boolean;
  expanded: boolean;
  onSnap: (snap: SheetSnap) => void;
  header: ReactNode;
  /** Receives whether the sheet shows more than its preview strip, which flips mid-drag. */
  children: (raised: boolean) => ReactNode;
}

function restingTransform(open: boolean, expanded: boolean): string {
  if (!open) return "translateY(100%)";
  if (expanded) return "translateY(0)";
  return `translateY(calc(100% - ${SHEET_PREVIEW_HEIGHT}px - env(safe-area-inset-bottom, 0px)))`;
}

export function BottomSheet({ open, expanded, onSnap, header, children }: Props) {
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
