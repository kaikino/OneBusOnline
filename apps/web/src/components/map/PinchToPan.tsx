import leaflet from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Two responsibilities:
 *
 * 1. **Prevent TouchZoom from using `_animateZoom`** — which sets
 *    `_animatingZoom = true` and blocks all subsequent drag/pan until a
 *    CSS transitionend or 250 ms timeout fires.  We temporarily flip
 *    `map.options.zoomAnimation` to `false` on the container-level
 *    `touchend` so that by the time TouchZoom's document-level handler
 *    runs, it takes the `_resetView` branch instead.
 *
 * 2. **Seamless pinch-to-pan** — when the user lifts one finger after a
 *    two-finger pinch, immediately begin panning with the remaining
 *    finger by invoking Leaflet's `Draggable._onDown` directly (Safari
 *    doesn't support the `TouchEvent` constructor).
 */
export function PinchToPan() {
  const map = useMap();

  useEffect(() => {
    const el = map.getContainer();
    let wasPinching = false;

    function clearBlockingState() {
      const pane: HTMLElement | undefined = (map as any)._mapPane;
      if (pane) pane.classList.remove("leaflet-zoom-anim");
      el.classList.remove("leaflet-zoom-anim");
      (map as any)._animatingZoom = false;
      const draggable = (map as any).dragging?._draggable;
      if ((leaflet as any).Draggable._dragging) {
        if (draggable && (leaflet as any).Draggable._dragging === draggable) {
          try { draggable.finishDrag(true); } catch (_) { /* noop */ }
        }
        (leaflet as any).Draggable._dragging = false;
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) wasPinching = true;
      clearBlockingState();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!wasPinching) return;

      if (e.touches.length < 2) {
        // A finger was lifted after a pinch.  Temporarily disable
        // zoomAnimation so Leaflet's TouchZoom handler (which fires on
        // `document`, after this container handler) chooses `_resetView`
        // instead of `_animateZoom`.
        map.options.zoomAnimation = false;
      }

      if (e.touches.length === 1) {
        wasPinching = false;

        const t = e.touches[0];
        const touchSnapshot = {
          pageX: t.pageX,
          pageY: t.pageY,
          clientX: t.clientX,
          clientY: t.clientY,
          screenX: t.screenX,
          screenY: t.screenY,
          identifier: t.identifier,
        };

        setTimeout(() => {
          map.options.zoomAnimation = true;
          clearBlockingState();

          const draggable = (map as any).dragging?._draggable;
          if (!draggable || !draggable._enabled) return;

          draggable._onDown({
            type: "touchstart",
            touches: [touchSnapshot],
            target: el,
            preventDefault() {},
            stopPropagation() {},
          });

          // Safety: if the remaining finger was lifted during the
          // setTimeout delay, _onUp won't fire (wasn't registered yet).
          // Schedule a cleanup to avoid leaving _dragging stuck.
          const safetyId = setTimeout(() => {
            if ((leaflet as any).Draggable._dragging === draggable && !draggable._moving) {
              clearBlockingState();
            }
          }, 200);

          const cancelSafety = () => {
            clearTimeout(safetyId);
            document.removeEventListener("touchmove", cancelSafety);
          };
          document.addEventListener("touchmove", cancelSafety, { once: true, passive: true });
        }, 0);
      } else {
        if (e.touches.length < 2) {
          // Both fingers lifted — restore zoomAnimation and clear
          // blocking state so the next single-finger pan works.
          setTimeout(() => {
            map.options.zoomAnimation = true;
            clearBlockingState();
          }, 0);
        }
        wasPinching = e.touches.length >= 2;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart, { capture: true } as EventListenerOptions);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [map]);

  return null;
}
