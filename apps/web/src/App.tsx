import { useQuery } from "@tanstack/react-query";
import { Crosshair, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StopSummary } from "@onebus/shared";
import { fetchAgencyCoverage } from "./api";
import { ArrivalsDrawer, type RouteFilter } from "./components/ArrivalsDrawer";
import { SearchBar } from "./components/SearchBar";
import { TransitMap } from "./components/TransitMap";

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

function useTickMs(interval = 1000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return t;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export default function App() {
  const nowMs = useTickMs();
  const online = useOnline();
  const [agencyCenter, setAgencyCenter] = useState<
    { lat: number; lon: number } | undefined
  >();
  const [userLat, setUserLat] = useState<number>();
  const [userLon, setUserLon] = useState<number>();
  const [flyToLat, setFlyToLat] = useState<number>();
  const [flyToLon, setFlyToLon] = useState<number>();
  const [selected, setSelected] = useState<StopSummary | null>(null);
  const [routeFilter, setRouteFilter] = useState<RouteFilter | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [userLocateSeq, setUserLocateSeq] = useState(0);
  const [collapseSeq, setCollapseSeq] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(148);

  useEffect(() => {
    setRouteFilter(null);
  }, [selected?.id]);

  const agenciesQuery = useQuery({
    queryKey: ["agencies", "coverage"],
    queryFn: fetchAgencyCoverage,
    staleTime: 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  useEffect(() => {
    const list = agenciesQuery.data;
    if (!list?.length) return;
    setAgencyCenter((prev) => {
      if (prev) return prev;
      const first = list[0];
      return { lat: first.lat, lon: first.lon };
    });
  }, [agenciesQuery.data]);

  const applyPosition = (pos: GeolocationPosition, flyTo = true) => {
    setUserLat(pos.coords.latitude);
    setUserLon(pos.coords.longitude);
    if (flyTo) {
      setFlyToLat(pos.coords.latitude);
      setFlyToLon(pos.coords.longitude);
      setUserLocateSeq((s) => s + 1);
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

  const locate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("Location is not supported on this device.");
      return;
    }
    setLocateError(null);

    if (userLat !== undefined && userLon !== undefined) {
      setFlyToLat(userLat);
      setFlyToLon(userLon);
      setUserLocateSeq((s) => s + 1);
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

  const locateErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const startWatch = () => {
      if (watchIdRef.current !== null) return;
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => applyPosition(pos, false),
        () => {},
        { enableHighAccuracy: true, maximumAge: 10_000 }
      );
    };

    void (async () => {
      const permission = await getPermissionState();
      if (permission === "granted") startWatch();
    })();

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative flex h-full flex-col bg-slate-950 text-slate-100">
      {!online ? (
        <div className="flex items-center justify-center gap-2 bg-amber-900/90 py-2 text-center text-sm text-amber-100">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          You are offline — map tiles and live data may be unavailable.
        </div>
      ) : null}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2 md:px-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <img
            src="/icons/icon.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-lg object-cover"
          />
          <h1 className="text-base font-semibold tracking-tight text-slate-50 md:text-lg">
            OneBusOnline
          </h1>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <SearchBar
          userLat={userLat}
          userLon={userLon}
          onPickStop={(s) => {
            setSelected(s);
            setFlyToLat(s.lat);
            setFlyToLon(s.lon);
          }}
        />
        <TransitMap
          agencyCenter={agencyCenter}
          userLat={userLat}
          userLon={userLon}
          flyToLat={flyToLat}
          flyToLon={flyToLon}
          flyToSeq={userLocateSeq}
          selectedStop={selected}
          routeFilter={routeFilter}
          onSelectStop={(s) => {
            setSelected(s);
          }}
        />
        <button
          type="button"
          onClick={() => {
            locate();
            setCollapseSeq((s) => s + 1);
          }}
          disabled={locating}
          title="Locate me"
          aria-label="Locate me"
          style={{
            bottom: `calc(env(safe-area-inset-bottom, 0px) + ${
              selected ? previewHeight + 20 : 16
            }px)`,
          }}
          className="fixed right-4 z-[2000] inline-flex items-center justify-center rounded-full border border-slate-500 bg-slate-900/95 p-2.5 text-slate-100 shadow-lg backdrop-blur-sm transition-all duration-300 ease-out hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <Crosshair
            className={`h-5 w-5 ${locating ? "animate-spin" : ""}`}
            aria-hidden
          />
        </button>
        {locateError ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              bottom: `calc(env(safe-area-inset-bottom, 0px) + ${
                selected ? previewHeight + 76 : 72
              }px)`,
            }}
            className="fixed right-4 z-[2000] flex max-w-[min(20rem,calc(100vw-2rem))] items-start gap-2 rounded-lg border border-amber-600 bg-amber-950/95 px-3 py-2 text-xs text-amber-100 shadow-xl transition-all duration-300 ease-out"
          >
            <p className="min-w-0 flex-1 leading-snug">{locateError}</p>
            <button
              type="button"
              onClick={() => setLocateError(null)}
              className="shrink-0 rounded px-1.5 py-0.5 text-amber-300/90 hover:bg-amber-900 hover:text-amber-50"
              aria-label="Dismiss location message"
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      <ArrivalsDrawer
        stop={selected}
        open={Boolean(selected)}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            setRouteFilter(null);
          }
        }}
        collapseSeq={collapseSeq}
        nowMs={nowMs}
        onPreviewHeightChange={setPreviewHeight}
        routeFilter={routeFilter}
        onRouteFilterChange={setRouteFilter}
      />
    </div>
  );
}
