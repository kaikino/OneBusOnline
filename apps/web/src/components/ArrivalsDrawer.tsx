import type { ArrivalRow, StopSummary } from "@onebus/shared";
import { Bus, RefreshCw, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import { displayTimeMs, minutesUntil } from "../arrivalUi";
import {
  headsignKey,
  rowMatchesFilter,
  type RouteFilter,
} from "../lib/routeFilter";
import { useArrivalsQuery } from "../hooks/useArrivalsQuery";
import { useDragSheet, expandedHeightPx } from "../hooks/useDragSheet";
import { PreviewChip } from "./arrivals/PreviewChip";
import { ExpandedRow } from "./arrivals/ExpandedRow";

export function ArrivalsDrawer(props: {
  stop: StopSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Increment to collapse from expanded to preview mode. */
  collapseSeq?: number;
  nowMs: number;
  onPreviewHeightChange?: (height: number) => void;
  /** When set, list is restricted to arrivals on this route + direction. */
  routeFilter?: RouteFilter | null;
  onRouteFilterChange?: (filter: RouteFilter | null) => void;
}) {
  const stopId = props.stop?.id ?? "";

  const {
    rows,
    dedupedRows,
    isError,
    isPending,
    isSuccess,
    isFetching,
    offline,
    spinning,
    handleRefetch,
    setMinutesAfterLimit,
    nextMinutesAfter,
    nextHoursLabel,
    showStaleBanner,
    serverUnreachable,
    dataAgeLabel,
  } = useArrivalsQuery({ stopId, open: props.open, nowMs: props.nowMs });

  const {
    expanded,
    dragging,
    draggingRef,
    translateY,
    closing,
    stopForDisplay,
    panelRef,
    scrollRef,
    chipsRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancelDrag,
  } = useDragSheet({
    stopId,
    open: props.open,
    stop: props.stop,
    onOpenChange: props.onOpenChange,
    collapseSeq: props.collapseSeq,
    onPreviewHeightChange: props.onPreviewHeightChange,
  });

  const routeFilter = props.routeFilter ?? null;

  const displayedRows = useMemo(() => {
    if (!routeFilter) return dedupedRows;
    return dedupedRows.filter((r) => rowMatchesFilter(r, routeFilter));
  }, [dedupedRows, routeFilter]);

  const previewRows = useMemo(() => {
    const out: ArrivalRow[] = [];
    const seen = new Set<string>();
    for (const row of dedupedRows) {
      const routeKey = `${row.routeId || row.routeShortName}::${headsignKey(row.headsign)}`;
      if (seen.has(routeKey)) continue;
      const mins = minutesUntil(displayTimeMs(row), props.nowMs);
      if (mins <= -1) continue;
      seen.add(routeKey);
      out.push(row);
    }
    return out;
  }, [dedupedRows, props.nowMs]);

  const filteredRouteLabel = useMemo(() => {
    if (!routeFilter) return null;
    const match = rows.find((r) => rowMatchesFilter(r, routeFilter));
    if (!match) return routeFilter.routeId;
    const short = match.routeShortName || match.routeId;
    return match.headsign ? `${short} → ${match.headsign}` : short;
  }, [rows, routeFilter]);

  const clearRouteFilter = useCallback(() => {
    props.onRouteFilterChange?.(null);
  }, [props.onRouteFilterChange]);

  if (!props.open && !closing) return null;

  const panelHeight = expandedHeightPx();

  return (
    <div className="pointer-events-none fixed left-0 right-0 z-[2001]" style={{ bottom: `env(safe-area-inset-bottom, 0px)` }}>
      <section
        ref={panelRef}
        style={{
          height: panelHeight,
          transform: `translateY(${translateY}px)`,
          paddingBottom: `max(1rem, env(safe-area-inset-bottom, 0px))`,
        }}
        className={`pointer-events-auto relative flex flex-col rounded-t-2xl border border-slate-700 bg-slate-950 px-4 pt-2 outline-none will-change-transform ${
          dragging || draggingRef.current ? "" : "transition-transform duration-500 ease-out"
        }`}
      >
        {/* Background extension so map never peeks through */}
        <div className="absolute -left-4 -right-4 top-0 -z-10 h-[200vh] bg-slate-950" />

        {/* Drag zone: handle + header */}
        <div
          className="relative z-40 cursor-ns-resize touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
        >
          <div className="px-1 pt-1 -mx-1 mb-1">
            <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-slate-600" />
          </div>
          <div className="flex items-start justify-between gap-2 pr-1">
            <h2 className={`flex items-center gap-2 text-lg font-semibold text-slate-50 ${!expanded ? "min-w-0 truncate" : ""}`}>
              <Bus className="h-5 w-5 shrink-0 text-sky-400" aria-hidden />
              <span className={!expanded ? "truncate" : undefined}>{stopForDisplay?.name ?? "Stop"}</span>
            </h2>
            <button
              type="button"
              onClick={handleRefetch}
              disabled={spinning}
              className="relative z-20 mt-0.5 shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
              aria-label="Refresh arrivals"
            >
              <RefreshCw
                className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`}
                aria-hidden
              />
            </button>
          </div>
          {expanded && stopForDisplay?.code ? (
            <p className="mt-1 text-sm text-slate-400">{`Code ${stopForDisplay.code}`}</p>
          ) : null}
        </div>

        {/* Non-interactive fill only — WAS pointer-blocking + catching drags/WebKit tapped the wrong layer */}
        {(!expanded || dragging) && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 top-0 z-[5] touch-none select-none"
            aria-hidden
          />
        )}

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          className={`relative z-[35] isolate mt-2 min-h-0 flex-1 overscroll-contain ${expanded ? "overflow-y-auto touch-manipulation" : "overflow-hidden"}`}
        >
          {isError && rows.length === 0 ? (
            <p className="text-sm text-red-400">
              {offline
                ? "You are offline with no saved arrivals for this stop yet."
                : "Failed to fetch arrivals."}
            </p>
          ) : null}
          {showStaleBanner ? (
            <p className="mb-2 text-xs text-amber-400">
              Offline — showing last saved arrivals for this stop.
            </p>
          ) : null}
          {serverUnreachable ? (
            <p className="mb-2 text-xs text-amber-400">
              Server unreachable — arrivals may be outdated.{dataAgeLabel ? ` Last updated ${dataAgeLabel}.` : ""}
            </p>
          ) : null}
          {rows.length === 0 && isPending ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : null}
          {rows.length === 0 && isSuccess ? (
            <p className="text-sm text-slate-500">No upcoming arrivals.</p>
          ) : null}

          {expanded ? (
            <>
              {routeFilter ? (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-sky-700/60 bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-200">
                  <span className="min-w-0 truncate">
                    Showing only
                    <span className="ml-1 font-semibold text-sky-100">
                      {filteredRouteLabel ?? routeFilter.routeId}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={clearRouteFilter}
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-sky-200 hover:bg-sky-500/20 hover:text-sky-50"
                    aria-label="Clear route filter"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    <span>Clear</span>
                  </button>
                </div>
              ) : null}
              {routeFilter && displayedRows.length === 0 && rows.length > 0 ? (
                <p className="text-sm text-slate-500">
                  No upcoming arrivals for {filteredRouteLabel ?? routeFilter.routeId}.
                </p>
              ) : null}
              <ul className="space-y-2">
                {displayedRows.map((row) => (
                  <ExpandedRow
                    key={`${row.tripId}::${row.stopId}::${row.scheduledArrivalTimeMs}`}
                    row={row}
                    nowMs={props.nowMs}
                    routeFilter={routeFilter}
                    onRouteFilterChange={props.onRouteFilterChange}
                  />
                ))}
              </ul>
              {Boolean(stopId) && (
                <div className="mt-3 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    disabled={isFetching || offline}
                    onClick={() => setMinutesAfterLimit(nextMinutesAfter)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:border-sky-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isFetching
                      ? "Loading…"
                      : `Show more arrivals (next ${nextHoursLabel} hours)`}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div ref={chipsRef} className="relative z-[35] isolate flex gap-2 overflow-x-scroll pb-1 select-none scrollbar-none">
              {previewRows.map((row) => (
                <PreviewChip
                  key={`${row.routeId}::${headsignKey(row.headsign)}`}
                  row={row}
                  nowMs={props.nowMs}
                  routeFilter={routeFilter}
                  onRouteFilterChange={props.onRouteFilterChange}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
