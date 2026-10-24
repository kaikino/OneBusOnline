import { useEffect, useState } from "react";
import { syncReminders } from "../lib/push";
import { removeExpiredReminders } from "../lib/saved";
import { useReminders } from "./useSaved";

const SYNC_DELAY_MS = 500;
const EXPIRY_CHECK_MS = 60_000;

/**
 * Sends the reminders to the server whenever they change, and on launch since
 * subscriptions can rotate. Also drops one-time reminders once they're past. Returns the
 * last sync error.
 */
export function useReminderSync(): string | null {
  const list = useReminders();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    removeExpiredReminders();
    const id = setInterval(removeExpiredReminders, EXPIRY_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let current = true;
    const id = setTimeout(() => {
      syncReminders(list).then(
        () => current && setError(null),
        (err: Error) => current && setError(err.message),
      );
    }, SYNC_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(id);
    };
  }, [list]);

  return error;
}
