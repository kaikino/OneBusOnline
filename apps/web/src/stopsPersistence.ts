import type { StopSummary } from "@onebus/shared";
import { createStore, get, setMany } from "idb-keyval";
import type { BboxParams } from "./api";

const store = createStore("onebus-stops", "stops-cache");

const K_MERGED = "mergedById";
const K_LAST_BBOX = "lastNetworkBbox";
const K_VERSION = "schemaVersion";
const SCHEMA = 1;

export type PersistedStopsState = {
  byId: Map<string, StopSummary>;
  lastNetworkBbox: BboxParams | null;
};

export async function loadPersistedStops(): Promise<PersistedStopsState> {
  if (typeof indexedDB === "undefined") {
    return { byId: new Map(), lastNetworkBbox: null };
  }
  try {
    const ver = await get<number>(K_VERSION, store);
    if (ver != null && ver !== SCHEMA) {
      return { byId: new Map(), lastNetworkBbox: null };
    }
    const raw = await get<Record<string, StopSummary>>(K_MERGED, store);
    const last = await get<BboxParams | null>(K_LAST_BBOX, store);
    const byId = new Map<string, StopSummary>();
    if (raw) {
      for (const [id, row] of Object.entries(raw)) {
        byId.set(id, row);
      }
    }
    return { byId, lastNetworkBbox: last ?? null };
  } catch {
    return { byId: new Map(), lastNetworkBbox: null };
  }
}

export async function savePersistedStops(
  byId: Map<string, StopSummary>,
  lastNetworkBbox: BboxParams | null
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await setMany(
      [
        [K_VERSION, SCHEMA],
        [K_MERGED, Object.fromEntries(byId)],
        [K_LAST_BBOX, lastNetworkBbox],
      ],
      store
    );
  } catch {}
}
