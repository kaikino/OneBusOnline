import { useQuery } from "@tanstack/react-query";
import { Crosshair, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { StopSummary } from "@onebus/shared";
import { fetchAgencyCoverage } from "./api";
import { ArrivalsDrawer } from "./components/ArrivalsDrawer";
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
  const [selected, setSelected] = useState<StopSummary | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [userLocateSeq, setUserLocateSeq] = useState(0);

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

  const locate = async (opts?: { silent?: boolean; forcePrompt?: boolean }) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (!opts?.silent) setLocateError("Location is not supported on this device.");
      return;
    }
    setLocating(true);
    if (!opts?.silent) setLocateError(null);
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
    const getPos = (o: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, o)
      );
    const withOverallTimeout = async <T,>(p: Promise<T>, ms: number): Promise<T> => {
      let id: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, rej) => {
        id = setTimeout(() => rej(new Error("LOCATE_OVERALL_TIMEOUT")), ms);
      });
      try {
        return await Promise.race([p, timeout]);
      } finally {
        clearTimeout(id!);
      }
    };
    try {
      await withOverallTimeout(
        (async () => {
          try {
            const pos = await getPos({
              enableHighAccuracy: true,
              maximumAge: 30_000,
              timeout: 12_000,
            });
            setUserLat(pos.coords.latitude);
            setUserLon(pos.coords.longitude);
            setLocateError(null);
            setUserLocateSeq((s) => s + 1);
            return;
          } catch {
            // Some mobile browsers fail high-accuracy requests. Retry with a relaxed request.
          }
          try {
            const pos = await getPos({
              enableHighAccuracy: false,
              maximumAge: 5 * 60_000,
              timeout: 20_000,
            });
            setUserLat(pos.coords.latitude);
            setUserLon(pos.coords.longitude);
            setLocateError(null);
            setUserLocateSeq((s) => s + 1);
          } catch (err) {
            const denied = geolocationPermissionDenied(err);
            if (denied && opts?.forcePrompt) {
              const permission = await getPermissionState();
              if (permission === "prompt" || permission === "unknown") {
                try {
                  const pos = await getPos({
                    enableHighAccuracy: false,
                    maximumAge: 0,
                    timeout: 15_000,
                  });
                  setUserLat(pos.coords.latitude);
                  setUserLon(pos.coords.longitude);
                  setLocateError(null);
                  setUserLocateSeq((s) => s + 1);
                  return;
                } catch {
                  // fall through to user-facing error
                }
              }
            }
            if (!opts?.silent) {
              const permission = denied ? await getPermissionState() : "unknown";
              const timedOut = geolocationTimedOut(err);
              let message: string;
              if (denied) {
                message =
                  permission === "denied"
                    ? "Location blocked in browser settings. Enable location for this site, then tap Locate again."
                    : "Location permission needed. Tap Locate and choose Allow.";
              } else if (timedOut) {
                message =
                  "Location timed out. Move to an open area, check GPS/Wi‑Fi, and try again.";
              } else {
                message = "Could not get your location. Try again.";
              }
              setLocateError(message);
            }
          }
        })(),
        28_000
      );
    } catch (e) {
      if (!opts?.silent) {
        setLocateError(
          e instanceof Error && e.message === "LOCATE_OVERALL_TIMEOUT"
            ? "Location is taking too long. Check permissions and try again."
            : "Could not get your location. Try again."
        );
      }
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    void locate({ silent: true });
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
        <div>
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
            setUserLat(s.lat);
            setUserLon(s.lon);
          }}
        />
        <TransitMap
          agencyCenter={agencyCenter}
          userLat={userLat}
          userLon={userLon}
          userLocateSeq={userLocateSeq}
          selectedStop={selected}
          onSelectStop={(s) => {
            setSelected(s);
          }}
        />
        <button
          type="button"
          onClick={() => {
            void locate({ forcePrompt: true });
          }}
          disabled={locating}
          title="Locate me"
          aria-label="Locate me"
          style={{
            bottom: `calc(env(safe-area-inset-bottom, 0px) + ${
              selected ? 168 : 16
            }px)`,
          }}
          className="fixed right-4 z-[2000] inline-flex items-center justify-center rounded-full border border-slate-500 bg-slate-900/95 p-2.5 text-slate-100 shadow-lg backdrop-blur-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
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
                selected ? 224 : 72
              }px)`,
            }}
            className="fixed right-4 z-[2000] flex max-w-[min(20rem,calc(100vw-2rem))] items-start gap-2 rounded-lg border border-amber-600 bg-amber-950/95 px-3 py-2 text-xs text-amber-100 shadow-xl"
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
          if (!o) setSelected(null);
        }}
        nowMs={nowMs}
      />
    </div>
  );
}
