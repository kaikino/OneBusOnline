import type { LatLon, Stop } from "@onebus/shared";
import type { Map as LeafletMap } from "leaflet";
import { Crosshair, WifiOff } from "lucide-react";
import { useRef, useState } from "react";
import { ArrivalsDrawer } from "./components/ArrivalsDrawer";
import { SearchBar } from "./components/SearchBar";
import { TransitMap } from "./components/TransitMap";
import { useOnline } from "./hooks/useOnline";

const FOCUS_ZOOM = 15;

export default function App() {
  const online = useOnline();
  const mapRef = useRef<LeafletMap>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [userPosition, setUserPosition] = useState<LatLon>();
  const [locating, setLocating] = useState(false);

  const flyTo = ({ lat, lon }: LatLon) => {
    mapRef.current?.flyTo([lat, lon], FOCUS_ZOOM, { duration: 1 });
  };

  const locate = () => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = { lat: coords.latitude, lon: coords.longitude };
        setUserPosition(position);
        flyTo(position);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-900/90 py-2 text-sm text-amber-100">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          You are offline — map tiles and live data may be unavailable.
        </div>
      )}
      <header className="shrink-0 border-b border-slate-800 bg-slate-900 px-3 py-2 md:px-4">
        <h1 className="text-base font-semibold tracking-tight text-slate-50 md:text-lg">
          OneBusOnline
        </h1>
      </header>
      <main className="relative min-h-0 flex-1">
        <SearchBar
          origin={userPosition}
          onPickStop={(picked) => {
            setStop(picked);
            flyTo(picked);
          }}
        />
        <TransitMap
          ref={mapRef}
          userPosition={userPosition}
          selectedStop={stop}
          onSelectStop={setStop}
        />
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          aria-label="Locate me"
          className="absolute bottom-4 right-4 z-[1000] rounded-full border border-slate-500 bg-slate-900/95 p-2.5 shadow-lg backdrop-blur-sm hover:bg-slate-800 disabled:opacity-70"
        >
          <Crosshair className={`h-5 w-5 ${locating ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </main>
      {stop && <ArrivalsDrawer stop={stop} onClose={() => setStop(null)} />}
    </div>
  );
}
