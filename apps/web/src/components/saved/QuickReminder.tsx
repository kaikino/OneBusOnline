import type { Arrival, Reminder, Stop } from "@onebus/shared";
import { useState } from "react";
import { formatClock, localDate, timeOfDay } from "../../lib/format";
import { subscribeToPush } from "../../lib/push";
import { ensureSaved, reminders } from "../../lib/saved";
import { DayToggles, MinutesBeforeSelect } from "./ReminderControls";

const WEEKDAYS = [1, 2, 3, 4, 5];

interface Props {
  stop: Stop;
  arrival: Arrival;
  /** The reminder already covering this arrival, to edit or remove. */
  existing?: Reminder;
  now: number;
  onDone: () => void;
}

/** Sets a notification for one arrival from its tile: once by default, or repeating. */
export function QuickReminder({ stop, arrival, existing, now, onDone }: Props) {
  const day = new Date(arrival.scheduledTimeMs).getDay();
  const [repeat, setRepeat] = useState(existing ? !existing.date : false);
  const [days, setDays] = useState(
    existing && !existing.date ? existing.days : WEEKDAYS.includes(day) ? WEEKDAYS : [day],
  );
  const [minutesBefore, setMinutesBefore] = useState(existing?.minutesBefore ?? 5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A late bus can still be caught, so this goes by when it's expected.
  const tooLate = !repeat && arrival.arrivalTimeMs - minutesBefore * 60_000 <= now;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await subscribeToPush();
      const reminder: Reminder = {
        id: existing?.id ?? crypto.randomUUID(),
        stopId: stop.id,
        stopName: stop.name,
        routeId: arrival.routeId,
        routeShortName: arrival.routeShortName,
        headsign: arrival.headsign,
        time: timeOfDay(arrival.scheduledTimeMs),
        days: repeat ? days : [],
        minutesBefore,
        enabled: true,
      };
      if (!repeat) reminder.date = localDate(arrival.scheduledTimeMs);
      // Notifications are managed from the saved stops page, so the stop is saved with them.
      ensureSaved(stop);
      reminders.update((list) => [...list.filter((r) => r.id !== reminder.id), reminder]);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const remove = () => {
    reminders.update((list) => list.filter((r) => r.id !== existing?.id));
    onDone();
  };

  return (
    <div className="mt-1.5 space-y-2.5 rounded-lg border border-slate-700 bg-slate-900/60 p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <MinutesBeforeSelect
          value={minutesBefore}
          onChange={setMinutesBefore}
          className="px-2 py-1.5"
        />
        <span className="text-xs text-slate-400">
          the {formatClock(arrival.scheduledTimeMs)} bus
        </span>
      </div>

      <label className="flex items-center gap-2 text-slate-300">
        <input
          type="checkbox"
          checked={repeat}
          onChange={(event) => setRepeat(event.target.checked)}
          className="h-4 w-4 accent-sky-500"
        />
        Repeat every week
      </label>
      {repeat && <DayToggles days={days} onChange={setDays} />}

      {tooLate && (
        <p className="text-xs text-amber-300">That's already passed — pick fewer minutes.</p>
      )}
      {error && <p className="text-xs text-amber-300">{error}</p>}

      <div className="flex justify-end gap-2">
        {existing && (
          <button
            type="button"
            onClick={remove}
            className="mr-auto rounded-md px-3 py-1.5 text-red-300 hover:bg-slate-800"
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-1.5 text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || tooLate || (repeat && days.length === 0)}
          className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Notify me"}
        </button>
      </div>
    </div>
  );
}
