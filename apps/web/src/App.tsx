import { useQuery } from "@tanstack/react-query";
import { Crosshair, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { StopSummary } from "@onebus/shared";
import { fetchAgencyCoverage } from "./api";
import { ArrivalsDrawer } from "./components/ArrivalsDrawer";
import type { RouteFilter } from "./lib/routeFilter";
import { SearchBar } from "./components/SearchBar";
import { TransitMap } from "./components/TransitMap";
import { useGeolocation } from "./hooks/useGeolocation";

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
  const [flyToLat, setFlyToLat] = useState<number>();
  const [flyToLon, setFlyToLon] = useState<number>();
  const [selected, setSelected] = useState<StopSummary | null>(null);
  const [routeFilter, setRouteFilter] = useState<RouteFilter | null>(null);
  const [userLocateSeq, setUserLocateSeq] = useState(0);
  const [collapseSeq, setCollapseSeq] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(148);

  /** Move the map camera. `bumpSeq` re-fires FlyTo even when coords are
   *  unchanged (used by the locate button); search keeps the camera where new
   *  coords already differ, so it skips the bump. */
  const flyTo = useCallback((lat: number, lon: number, bumpSeq = true) => {
    setFlyToLat(lat);
    setFlyToLon(lon);
    if (bumpSeq) setUserLocateSeq((s) => s + 1);
  }, []);

  const { userLat, userLon, locating, locateError, locate, clearLocateError } =
    useGeolocation(flyTo);

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
            flyTo(s.lat, s.lon, false);
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
              onClick={clearLocateError}
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
