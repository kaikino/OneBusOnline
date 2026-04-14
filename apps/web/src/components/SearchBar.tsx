import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { StopSummary } from "@onebus/shared";
import { fetchStopsSearch } from "../api";

const DEBOUNCE_MS = 350;

export function SearchBar(props: {
  userLat?: number;
  userLon?: number;
  onPickStop: (s: StopSummary) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const searchActive = debounced.length >= 2;

  const searchQuery = useQuery({
    queryKey: [
      "stopsSearch",
      debounced,
      props.userLat ?? null,
      props.userLon ?? null,
    ],
    queryFn: () => fetchStopsSearch(debounced, props.userLat, props.userLon),
    enabled: searchActive,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  const results = searchActive ? (searchQuery.data ?? []) : [];
  const loading = searchActive && searchQuery.isFetching;
  const searchError =
    searchActive && searchQuery.isError
      ? searchQuery.error instanceof Error
        ? searchQuery.error.message
        : "Search failed — check API and network."
      : null;

  return (
    <div className="pointer-events-auto absolute left-3 right-3 top-3 z-[1000] md:left-4 md:right-auto md:w-96">
      <div className="relative flex items-center rounded-xl border border-slate-700 bg-slate-900 shadow-lg">
        <Search className="ml-3 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <input
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          placeholder="Search stops…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          aria-label="Search stops"
        />
        {q ? (
          <button
            type="button"
            className="mr-2 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={() => {
              setQ("");
            }}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        {loading ? (
          <Loader2 className="mr-3 h-4 w-4 shrink-0 animate-spin text-sky-400" />
        ) : null}
      </div>
      {open && debounced.length >= 2 ? (
        <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-700 bg-slate-900 py-2 shadow-xl">
          {loading ? (
            <p className="px-3 py-2 text-sm text-slate-400">Searching…</p>
          ) : null}
          {searchError ? (
            <p className="px-3 py-2 text-sm text-red-400">{searchError}</p>
          ) : null}
          {!loading && !searchError && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">
              No stops found. Try another name or zoom the map and tap a stop.
            </p>
          ) : null}
          {results.length > 0 ? (
            <ul className="py-0">
              {results.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-800"
                    onClick={() => {
                      props.onPickStop(s);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    <span className="font-medium text-slate-100">{s.name}</span>
                    <span className="text-xs text-slate-400">
                      {s.code ? `${s.code} · ` : ""}
                      {s.direction ? `${s.direction} · ` : ""}
                      {s.distanceMeters != null
                        ? `${Math.round(s.distanceMeters)} m`
                        : `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
