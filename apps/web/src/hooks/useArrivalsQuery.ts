import type { ArrivalRow } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ARRIVALS_EXTEND_STEP_MIN,
  ARRIVALS_QUERY_WINDOW,
  fetchArrivals,
  loadCachedArrivals,
  saveCachedArrivals,
} from "../api";

/**
 * Owns the live arrivals query for a stop: react-query fetch + localStorage
 * cache fallback, the "show more" horizon, manual refresh spinner, and the
 * stale / server-unreachable banner derivations.
 */
export function useArrivalsQuery(params: {
  stopId: string;
  open: boolean;
  nowMs: number;
}) {
  const { stopId, open, nowMs } = params;
  const before = ARRIVALS_QUERY_WINDOW.minutesBefore;

  const [minutesAfterLimit, setMinutesAfterLimit] = useState(
    ARRIVALS_QUERY_WINDOW.minutesAfter,
  );

  useEffect(() => {
    setMinutesAfterLimit(ARRIVALS_QUERY_WINDOW.minutesAfter);
  }, [stopId]);

  const query = useQuery({
    queryKey: ["arrivals", stopId, minutesAfterLimit, before],
    queryFn: () =>
      fetchArrivals(stopId, {
        minutesAfter: minutesAfterLimit,
        minutesBefore: before,
      }),
    enabled: open && Boolean(stopId),
    staleTime: 15_000,
    refetchInterval: open ? 20_000 : false,
    placeholderData: (previousData) =>
      previousData ??
      (stopId
        ? loadCachedArrivals(stopId, minutesAfterLimit, before) ?? undefined
        : undefined),
  });

  useEffect(() => {
    if (query.data && stopId) {
      saveCachedArrivals(stopId, query.data, minutesAfterLimit, before);
    }
  }, [query.data, stopId, minutesAfterLimit, before]);

  const [manualSpinning, setManualSpinning] = useState(false);
  const spinning = query.isFetching || manualSpinning;

  const handleRefetch = async () => {
    setManualSpinning(true);
    const minSpin = new Promise((r) => setTimeout(r, 600));
    await Promise.all([query.refetch(), minSpin]);
    setManualSpinning(false);
  };

  const nextMinutesAfter = minutesAfterLimit + ARRIVALS_EXTEND_STEP_MIN;
  const nextHours = nextMinutesAfter / 60;
  const nextHoursLabel = Number.isInteger(nextHours)
    ? String(nextHours)
    : nextHours.toFixed(1).replace(/\.0$/, "");

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const cached = stopId
    ? loadCachedArrivals(stopId, minutesAfterLimit, before)
    : null;
  const rows = query.data?.arrivals ?? cached?.arrivals ?? [];

  const dedupedRows = useMemo(() => {
    const seen = new Set<string>();
    const out: ArrivalRow[] = [];
    for (const r of rows) {
      const key = `${r.tripId}::${r.stopId}::${r.scheduledArrivalTimeMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [rows]);

  const showStaleBanner = offline && query.isError && rows.length > 0;

  const dataAgeMs = query.dataUpdatedAt ? nowMs - query.dataUpdatedAt : 0;
  const serverUnreachable = !offline && query.failureCount > 0 && rows.length > 0;
  const dataAgeLabel = dataAgeMs >= 120_000
    ? `${Math.floor(dataAgeMs / 60_000)} min ago`
    : dataAgeMs >= 60_000
      ? "1 min ago"
      : "";

  return {
    rows,
    dedupedRows,
    isError: query.isError,
    isPending: query.isPending,
    isSuccess: query.isSuccess,
    isFetching: query.isFetching,
    offline,
    spinning,
    handleRefetch,
    minutesAfterLimit,
    setMinutesAfterLimit,
    nextMinutesAfter,
    nextHoursLabel,
    showStaleBanner,
    serverUnreachable,
    dataAgeLabel,
  };
}
