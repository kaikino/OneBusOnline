import type { ArrivalsResponse } from "@onebus/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchArrivals } from "../api";

const MINUTES_BEFORE = 15;
const MINUTES_AFTER = 120;
export const EXTEND_STEP_MINUTES = 120;
/** A refresh spins at least this long, so a fast or cached answer still shows it happened. */
const MIN_REFRESH_SPIN_MS = 600;

const storageKey = (stopId: string) => `onebus:arrivals:${stopId}`;

function loadSaved(stopId: string): ArrivalsResponse | undefined {
  try {
    const saved = localStorage.getItem(storageKey(stopId));
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

function save(response: ArrivalsResponse) {
  try {
    localStorage.setItem(storageKey(response.stopId), JSON.stringify(response));
  } catch {
    // Storage is full or unavailable; arrivals just won't be available offline.
  }
}

/**
 * Live arrivals for a stop, falling back to the last saved response when the
 * network fails. While not `live`, the last arrivals are kept but not refreshed.
 */
export function useArrivals(stopId: string | undefined, live: boolean) {
  const [minutesAfter, setMinutesAfter] = useState(MINUTES_AFTER);

  const [windowStopId, setWindowStopId] = useState(stopId);
  if (windowStopId !== stopId) {
    setWindowStopId(stopId);
    setMinutesAfter(MINUTES_AFTER);
  }

  const queryClient = useQueryClient();
  const queryKey = ["arrivals", stopId, minutesAfter];
  const query = useQuery({
    queryKey,
    queryFn: () => fetchArrivals(stopId!, minutesAfter, MINUTES_BEFORE),
    enabled: stopId !== undefined && live,
    staleTime: 15_000,
    refetchInterval: 20_000,
    // Keeps the list in place while a longer window loads.
    placeholderData: (previous) => (previous?.stopId === stopId ? previous : undefined),
  });

  useEffect(() => {
    if (query.data && !query.isPlaceholderData) save(query.data);
  }, [query.data, query.isPlaceholderData]);

  const saved = useMemo(() => (stopId ? loadSaved(stopId) : undefined), [stopId]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (!stopId) return;
    setRefreshing(true);
    await Promise.allSettled([
      queryClient.fetchQuery({
        queryKey,
        queryFn: () => fetchArrivals(stopId, minutesAfter, MINUTES_BEFORE, true),
        staleTime: 0,
      }),
      new Promise((resolve) => setTimeout(resolve, MIN_REFRESH_SPIN_MS)),
    ]);
    setRefreshing(false);
  };

  return {
    arrivals: (query.data ?? saved)?.arrivals ?? [],
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isRefreshing: refreshing || query.isFetching,
    isFailing: query.isError || query.isRefetchError,
    minutesAfter,
    refresh: () => void refresh(),
    extend: () => setMinutesAfter((minutes) => minutes + EXTEND_STEP_MINUTES),
  };
}
