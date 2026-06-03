import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * iOS/WebKit: route `click` can be unreliable after sheet gestures; we also need real taps.
 * While the finger is down, movement must be tracked at the *document* level — during list /
 * chip scroll, `touchmove` often stops reaching the inner `<button>`, so in-element slop alone
 * falsely treats drags as taps. Only fire when movement stays within ROUTE_TILE_TAP_SLOP_PX.
 */
const ROUTE_TILE_TAP_SLOP_PX = 12;

export function useTouchPrimaryTap(
  ref: React.RefObject<HTMLButtonElement | null>,
  onTap: () => void,
) {
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const fromTouchTs = useRef(0);
  const suppressUntilTs = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let active: { id: number; x0: number; y0: number } | null = null;
    let slopExceeded = false;

    const onDocMove = (e: TouchEvent) => {
      if (!active) return;
      const t = Array.from(e.touches).find((x) => x.identifier === active!.id);
      if (!t) return;
      const dx = t.clientX - active.x0;
      const dy = t.clientY - active.y0;
      if (dx * dx + dy * dy > ROUTE_TILE_TAP_SLOP_PX * ROUTE_TILE_TAP_SLOP_PX) {
        slopExceeded = true;
      }
    };

    const detachDoc = () => {
      document.removeEventListener("touchmove", onDocMove, { capture: true });
    };

    const attachDoc = () => {
      document.addEventListener("touchmove", onDocMove, { passive: true, capture: true });
    };

    const onStart = (e: TouchEvent) => {
      detachDoc();
      if (e.targetTouches.length !== 1) {
        active = null;
        return;
      }
      const t = e.targetTouches[0];
      active = { id: t.identifier, x0: t.clientX, y0: t.clientY };
      slopExceeded = false;
      attachDoc();
    };

    const onEnd = (e: TouchEvent) => {
      detachDoc();
      const endNow = Date.now();

      if (!active) {
        return;
      }
      const s = active;
      active = null;

      const t = Array.from(e.changedTouches).find((x) => x.identifier === s.id);
      if (!t || slopExceeded) {
        suppressUntilTs.current = endNow;
        if (e.cancelable) e.preventDefault();
        return;
      }
      const dx = t.clientX - s.x0;
      const dy = t.clientY - s.y0;
      if (dx * dx + dy * dy > ROUTE_TILE_TAP_SLOP_PX * ROUTE_TILE_TAP_SLOP_PX) {
        suppressUntilTs.current = endNow;
        if (e.cancelable) e.preventDefault();
        return;
      }

      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      fromTouchTs.current = endNow;
      onTapRef.current();
    };

    const onCancel = () => {
      detachDoc();
      active = null;
      slopExceeded = false;
      suppressUntilTs.current = Date.now();
    };

    const capture = true;
    el.addEventListener("touchstart", onStart, { passive: true, capture });
    el.addEventListener("touchend", onEnd, { passive: false, capture });
    el.addEventListener("touchcancel", onCancel, { capture });

    return () => {
      detachDoc();
      el.removeEventListener("touchstart", onStart, { capture });
      el.removeEventListener("touchend", onEnd, { capture });
      el.removeEventListener("touchcancel", onCancel, { capture });
    };
  }, []);

  return useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (Date.now() - suppressUntilTs.current < 550) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (Date.now() - fromTouchTs.current < 700) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onTapRef.current();
  }, []);
}
