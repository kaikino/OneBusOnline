import type { Arrival, Reminder, Stop } from "@onebus/shared";
import { localDate, reminderDateMs, timeOfDay } from "./format";

/** A list kept in localStorage, readable with `useSyncExternalStore` and synced across tabs. */
function storedList<T>(key: string) {
  let value: T[] | undefined;
  const listeners = new Set<() => void>();

  const read = (): T[] => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  };

  const get = () => (value ??= read());

  const set = (next: T[]) => {
    value = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage is full or unavailable; the change lasts until reload.
    }
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      value = undefined;
      listener();
    };
    listeners.add(listener);
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };

  return { get, subscribe, update: (change: (list: T[]) => T[]) => set(change(get())) };
}

export const savedStops = storedList<Stop>("onebus:saved-stops");
export const reminders = storedList<Reminder>("onebus:reminders");

export function toggleSaved(stop: Stop) {
  if (savedStops.get().some((saved) => saved.id === stop.id)) {
    savedStops.update((list) => list.filter((saved) => saved.id !== stop.id));
    // Reminders are listed under their stop, so they go with it.
    reminders.update((list) => list.filter((reminder) => reminder.stopId !== stop.id));
  } else {
    const { distanceMeters: _, ...rest } = stop;
    savedStops.update((list) => [...list, rest]);
  }
}

export function updateReminder(id: string, change: Partial<Reminder>) {
  reminders.update((list) =>
    list.map((reminder) => (reminder.id === id ? { ...reminder, ...change } : reminder)),
  );
}

/** Whether `stop` is saved, saving it if not. */
export function ensureSaved(stop: Stop) {
  if (!savedStops.get().some((saved) => saved.id === stop.id)) toggleSaved(stop);
}

/** The reminder that covers `arrival`, one-time or repeating. */
export function reminderForArrival(list: Reminder[], stopId: string, arrival: Arrival) {
  const time = timeOfDay(arrival.scheduledTimeMs);
  const date = localDate(arrival.scheduledTimeMs);
  const day = new Date(arrival.scheduledTimeMs).getDay();
  return list.find(
    (reminder) =>
      reminder.stopId === stopId &&
      reminder.routeId === arrival.routeId &&
      reminder.headsign === arrival.headsign &&
      reminder.time === time &&
      (reminder.date ? reminder.date === date : reminder.days.includes(day)),
  );
}

/** One-time reminders are kept this long after their bus, then dropped. */
const ONE_TIME_GRACE_MS = 60 * 60_000;

export function removeExpiredReminders(now = Date.now()) {
  const expired = (reminder: Reminder) =>
    reminder.date !== undefined &&
    reminderDateMs(reminder.date, reminder.time) + ONE_TIME_GRACE_MS < now;
  if (reminders.get().some(expired)) {
    reminders.update((list) => list.filter((reminder) => !expired(reminder)));
  }
}
