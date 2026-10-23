import { useSyncExternalStore } from "react";
import { reminders, savedStops } from "../lib/saved";

export const useSavedStops = () => useSyncExternalStore(savedStops.subscribe, savedStops.get);

export const useReminders = () => useSyncExternalStore(reminders.subscribe, reminders.get);
