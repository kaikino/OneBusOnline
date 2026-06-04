import type { LatLon, Stop } from "@onebus/shared";
import type { Map as LeafletMap } from "leaflet";
import { Crosshair, WifiOff } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ArrivalsDrawer } from "./components/ArrivalsDrawer";
import { SHEET_PREVIEW_HEIGHT } from "./components/BottomSheet";
import { SearchBar } from "./components/SearchBar";
import { TransitMap } from "./components/TransitMap";
import { useGeolocation } from "./hooks/useGeolocation";
import { useOnline } from "./hooks/useOnline";
import type { SheetSnap } from "./hooks/useSheetDrag";
import type { RouteFilter } from "./lib/routeFilter";

const FOCUS_ZOOM = 15;

export default function App() {
  const online = useOnline();
  const mapRef = useRef<LeafletMap>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [routeFilter, setRouteFilter] = useState<RouteFilter | null>(null);

  const flyTo = useCallback(({ lat, lon }: LatLon) => {
    mapRef.current?.flyTo([lat, lon], FOCUS_ZOOM, { duration: 1 });
  }, []);

  const geolocation = useGeolocation(flyTo);

  const selectStop = (next: Stop | null) => {
    setStop(next);
    setDrawerExpanded(false);
    setRouteFilter(null);
  };

  const snapDrawer = (snap: SheetSnap) => {
    if (snap === "closed") selectStop(null);
    else setDrawerExpanded(snap === "expanded");
  };

  const floatingBottom = (gap: number) =>
    `calc(env(safe-area-inset-bottom, 0px) + ${(stop ? SHEET_PREVIEW_HEIGHT : 0) + gap}px)`;

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-900/90 py-2 text-sm text-amber-100">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          You are offline — map tiles and live data may be unavailable.
        </div>
      )}
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2 md:px-4">
        <img src="/icons/icon.png" alt="" className="h-8 w-8 rounded-lg" />
        <h1 className="text-base font-semibold tracking-tight text-slate-50 md:text-lg">
          OneBusOnline
        </h1>
      </header>
      <main className="relative min-h-0 flex-1">
        <SearchBar
          origin={geolocation.position}
          onPickStop={(picked) => {
            selectStop(picked);
            flyTo(picked);
          }}
        />
        <TransitMap
          ref={mapRef}
          userPosition={geolocation.position}
          selectedStop={stop}
          routeFilter={routeFilter}
          onSelectStop={selectStop}
          onBackgroundClick={() => snapDrawer(drawerExpanded ? "preview" : "closed")}
        />
        <button
          type="button"
          onClick={() => {
            geolocation.locate();
            setDrawerExpanded(false);
          }}
          disabled={geolocation.locating}
          aria-label="Locate me"
          style={{ bottom: floatingBottom(16) }}
          className="fixed right-4 z-[2000] rounded-full border border-slate-500 bg-slate-900/95 p-2.5 shadow-lg backdrop-blur-sm transition-all duration-300 ease-out hover:bg-slate-800 disabled:opacity-70"
        >
          <Crosshair
            className={`h-5 w-5 ${geolocation.locating ? "animate-spin" : ""}`}
            aria-hidden
          />
        </button>
        {geolocation.error && (
          <p
            role="status"
            style={{ bottom: floatingBottom(72) }}
            className="fixed right-4 z-[2000] max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-amber-600 bg-amber-950/95 px-3 py-2 text-xs leading-snug text-amber-100 shadow-xl"
          >
            {geolocation.error}
          </p>
        )}
      </main>
      <ArrivalsDrawer
        stop={stop}
        expanded={drawerExpanded}
        onSnap={snapDrawer}
        routeFilter={routeFilter}
        onRouteFilterChange={setRouteFilter}
      />
    </div>
  );
}
