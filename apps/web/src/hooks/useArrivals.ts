import type { ArrivalsResponse } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchArrivals } from "../api";

const MINUTES_BEFORE = 15;
const MINUTES_AFTER = 120;
export const EXTEND_STEP_MINUTES = 120;

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

/** Live arrivals for a stop, falling back to the last saved response when the network fails. */
export function useArrivals(stopId: string | undefined) {
  const [minutesAfter, setMinutesAfter] = useState(MINUTES_AFTER);

  const [windowStopId, setWindowStopId] = useState(stopId);
  if (windowStopId !== stopId) {
    setWindowStopId(stopId);
    setMinutesAfter(MINUTES_AFTER);
  }

  const query = useQuery({
    queryKey: ["arrivals", stopId, minutesAfter],
    queryFn: () => fetchArrivals(stopId!, minutesAfter, MINUTES_BEFORE),
    enabled: stopId !== undefined,
    staleTime: 15_000,
    refetchInterval: 20_000,
    // Keeps the list in place while a longer window loads.
    placeholderData: (previous) => (previous?.stopId === stopId ? previous : undefined),
  });

  useEffect(() => {
    if (query.data && !query.isPlaceholderData) save(query.data);
  }, [query.data, query.isPlaceholderData]);

  const saved = useMemo(() => (stopId ? loadSaved(stopId) : undefined), [stopId]);

  return {
    arrivals: (query.data ?? saved)?.arrivals ?? [],
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isFailing: query.failureCount > 0,
    minutesAfter,
    refresh: () => void query.refetch(),
    extend: () => setMinutesAfter((minutes) => minutes + EXTEND_STEP_MINUTES),
  };
}
