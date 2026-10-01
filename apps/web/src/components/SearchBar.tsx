import type { LatLon, Stop } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchStops } from "../api";
import { useDebounced } from "../hooks/useDebounced";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

function stopDetails(stop: Stop): string {
  const distance =
    stop.distanceMeters !== undefined
      ? `${stop.distanceMeters} m`
      : `${stop.lat.toFixed(4)}, ${stop.lon.toFixed(4)}`;
  return [stop.code, stop.direction, distance].filter(Boolean).join(" · ");
}

export function SearchBar(props: { origin?: LatLon; onPickStop: (stop: Stop) => void }) {
  const [open, setOpen] = useState(false);
  // Fixed while the search is open, so position updates don't restart it.
  const [origin, setOrigin] = useState<LatLon>();
  const [input, setInput] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const query = useDebounced(input.trim(), DEBOUNCE_MS);
  // The debounced query lags the input, so an emptied box is checked as well.
  const searching = query.length >= MIN_QUERY_LENGTH && input.trim().length >= MIN_QUERY_LENGTH;

  const search = useQuery({
    queryKey: ["stopSearch", query, origin],
    queryFn: () => searchStops(query, origin),
    enabled: searching,
    staleTime: 5 * 60_000,
  });

  const close = () => {
    setOpen(false);
    setInput("");
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOrigin(props.origin);
          setOpen(true);
        }}
        aria-label="Search stops"
        className="absolute left-3 top-3 z-[1000] rounded-full border border-slate-500 bg-slate-900/95 p-2.5 text-slate-100 shadow-lg backdrop-blur-sm transition hover:bg-slate-800"
      >
        <Search className="h-5 w-5" aria-hidden />
      </button>
    );
  }

  return (
    <div ref={wrapperRef} className="absolute left-3 top-3 z-[1000] w-[calc(100%-5.5rem)] md:w-96">
      <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900 shadow-lg">
        <Search className="ml-3 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <input
          autoFocus
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          placeholder="Search stops…"
          aria-label="Search stops"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {search.isFetching && (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-400" aria-hidden />
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close search"
          className="mx-2 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {searching && (
        <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-700 bg-slate-900 py-2 shadow-xl">
          {search.isPending && <p className="px-3 py-2 text-sm text-slate-400">Searching…</p>}
          {search.isError && <p className="px-3 py-2 text-sm text-red-400">Search failed.</p>}
          {search.data?.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-400">
              No stops found. Try another name or stop number.
            </p>
          )}
          <ul>
            {search.data?.map((stop) => (
              <li key={stop.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-800"
                  onClick={() => {
                    props.onPickStop(stop);
                    close();
                  }}
                >
                  <span className="font-medium text-slate-100">{stop.name}</span>
                  <span className="text-xs text-slate-400">{stopDetails(stop)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
