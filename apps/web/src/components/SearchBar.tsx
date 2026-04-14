import type { LatLon, Stop } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { searchStops } from "../api";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function stopDetails(stop: Stop): string {
  const distance =
    stop.distanceMeters !== undefined
      ? `${stop.distanceMeters} m`
      : `${stop.lat.toFixed(4)}, ${stop.lon.toFixed(4)}`;
  return [stop.code, stop.direction, distance].filter(Boolean).join(" · ");
}

export function SearchBar(props: { origin?: LatLon; onPickStop: (stop: Stop) => void }) {
  const [input, setInput] = useState("");

  const query = useDebounced(input.trim(), DEBOUNCE_MS);
  const searching = query.length >= MIN_QUERY_LENGTH;

  const search = useQuery({
    queryKey: ["stopSearch", query, props.origin],
    queryFn: () => searchStops(query, props.origin),
    enabled: searching,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="absolute left-3 top-3 z-[1000] w-[calc(100%-5.5rem)] md:w-96">
      <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900 shadow-lg">
        <Search className="ml-3 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <input
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
          onClick={() => setInput("")}
          aria-label="Clear search"
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
                    setInput("");
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
