import { useEffect, useRef, useState } from "react";

type GeoPermissionState = PermissionState | "unknown";

/** Safari / some WebKit builds surface denial as DOMException instead of GeolocationPositionError. */
function geolocationPermissionDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as GeolocationPositionError & { name?: string };
  if ("code" in e && typeof e.code === "number" && e.code === 1) return true;
  const name = "name" in e && typeof e.name === "string" ? e.name : "";
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

function geolocationTimedOut(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as GeolocationPositionError & { name?: string };
  if ("code" in e && typeof e.code === "number" && e.code === 3) return true;
  return e.name === "TimeoutError";
}

/**
 * Owns the user's geolocation: one-shot locate flow, background `watchPosition`,
 * permission probing, and the transient error message. Camera movement is
 * delegated to `onFlyTo` (shared with search) so this hook stays view-agnostic.
 */
export function useGeolocation(onFlyTo: (lat: number, lon: number) => void) {
  const [userLat, setUserLat] = useState<number>();
  const [userLon, setUserLon] = useState<number>();
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const locateErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFlyToRef = useRef(onFlyTo);
  onFlyToRef.current = onFlyTo;

  const applyPosition = (pos: GeolocationPosition, flyTo = true) => {
    setUserLat(pos.coords.latitude);
    setUserLon(pos.coords.longitude);
    if (flyTo) {
      onFlyToRef.current(pos.coords.latitude, pos.coords.longitude);
    }
    setLocateError(null);
  };

  const getPermissionState = async (): Promise<GeoPermissionState> => {
    if (!("permissions" in navigator) || !navigator.permissions?.query) {
      return "unknown";
    }
    try {
      const status = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      return status.state;
    } catch {
      return "unknown";
    }
  };

  const ensureWatch = () => {
    if (watchIdRef.current !== null) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => applyPosition(pos, false),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 }
    );
  };

  const showLocateError = async (err: GeolocationPositionError) => {
    const denied = geolocationPermissionDenied(err);
    const timedOut = geolocationTimedOut(err);
    let message: string;
    if (denied) {
      const permission = await getPermissionState();
      message =
        permission === "denied"
          ? "Location blocked by browser. Tap the lock icon in the address bar, enable Location, then try again."
          : "Location permission needed. Tap Locate and choose Allow.";
    } else if (timedOut) {
      message =
        "Location timed out. Check GPS/Wi‑Fi and try again.";
    } else {
      message = "Could not get your location. Try again.";
    }
    setLocateError(message);
    if (locateErrorTimer.current) clearTimeout(locateErrorTimer.current);
    locateErrorTimer.current = setTimeout(() => setLocateError(null), 3000);
  };

  const locate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("Location is not supported on this device.");
      return;
    }
    setLocateError(null);

    if (userLat !== undefined && userLon !== undefined) {
      onFlyToRef.current(userLat, userLon);
      navigator.geolocation.getCurrentPosition(
        (pos) => { applyPosition(pos); ensureWatch(); },
        () => {},
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 }
      );
      return;
    }

    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyPosition(pos);
        setLocating(false);
        ensureWatch();
      },
      (err) => {
        if (!geolocationPermissionDenied(err)) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              applyPosition(pos);
              setLocating(false);
              ensureWatch();
            },
            async (err2) => {
              await showLocateError(err2);
              setLocating(false);
            },
            { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 20_000 }
          );
          return;
        }
        void (async () => {
          await showLocateError(err);
          setLocating(false);
        })();
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 }
    );
  };

  /** On load, fly the map to the user when the browser allows (no error toast if denied). */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const onSuccess = (pos: GeolocationPosition) => {
      applyPosition(pos, true);
      ensureWatch();
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (!geolocationPermissionDenied(err)) {
          navigator.geolocation.getCurrentPosition(
            onSuccess,
            () => {},
            { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 20_000 }
          );
        }
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 }
    );
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    void (async () => {
      const permission = await getPermissionState();
      if (permission === "granted") ensureWatch();
    })();

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const clearLocateError = () => setLocateError(null);

  return { userLat, userLon, locating, locateError, locate, clearLocateError };
}
