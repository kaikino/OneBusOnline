import { useQuery } from "@tanstack/react-query";
import { Crosshair, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { StopSummary } from "@onebus/shared";
import { fetchAgencyCoverage } from "./api";
import { PUNCTUALITY_DOC } from "./arrivalUi";
import { ArrivalsDrawer } from "./components/ArrivalsDrawer";
import { SearchBar } from "./components/SearchBar";
import { TransitMap } from "./components/TransitMap";

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

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLat(pos.coords.latitude);
        setUserLon(pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }
    );
  };

  useEffect(() => {
    locate();
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
            OneBusAway
          </h1>
          <p className="hidden text-xs text-slate-500 md:block" title={PUNCTUALITY_DOC}>
            Arrival colors: green on time · blue early · red late
          </p>
        </div>
        <button
          type="button"
          onClick={locate}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
        >
          <Crosshair className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Locate</span>
        </button>
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
          selectedStop={selected}
          onSelectStop={(s) => {
            setSelected(s);
          }}
        />
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
