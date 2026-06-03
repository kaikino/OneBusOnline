import type { Stop } from "@onebus/shared";
import { get, set } from "idb-keyval";

const KEY = "stops";

export async function loadSavedStops(): Promise<Stop[]> {
  return (await get<Stop[]>(KEY).catch(() => undefined)) ?? [];
}

export async function saveStops(stops: Stop[]): Promise<void> {
  await set(KEY, stops).catch(() => {});
}
