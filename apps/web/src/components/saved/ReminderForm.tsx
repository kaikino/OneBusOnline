import type { Arrival, Stop } from "@onebus/shared";
import { useState } from "react";
import { useArrivals } from "../../hooks/useArrivals";
import { formatTimeOfDay, timeOfDay } from "../../lib/format";
import { subscribeToPush } from "../../lib/push";
import { reminders } from "../../lib/saved";
import { DayToggles, MinutesBeforeSelect } from "./ReminderControls";

const WEEKDAYS = [1, 2, 3, 4, 5];
const SUGGESTED_TIMES = 8;

interface RouteOption {
  key: string;
  routeId: string;
  routeShortName: string;
  headsign: string;
  /** Upcoming scheduled times at the stop, offered as shortcuts. */
  times: string[];
}

function routeOptions(arrivals: Arrival[]): RouteOption[] {
  const options = new Map<string, RouteOption>();
  for (const arrival of arrivals) {
    const key = `${arrival.routeId}:${arrival.headsign}`;
    let option = options.get(key);
    if (!option) {
      const { routeId, routeShortName, headsign } = arrival;
      option = { key, routeId, routeShortName, headsign, times: [] };
      options.set(key, option);
    }
    const time = timeOfDay(arrival.scheduledTimeMs);
    if (arrival.scheduledTimeMs >= Date.now() && !option.times.includes(time)) {
      option.times.push(time);
    }
  }
  return [...options.values()].sort((a, b) =>
    a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true }),
  );
}

const field = "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100";

export function ReminderForm({ stop, onDone }: { stop: Stop; onDone: () => void }) {
  const { arrivals, isLoading } = useArrivals(stop.id, true);
  const options = routeOptions(arrivals);

  const [routeKey, setRouteKey] = useState<string>();
  const [time, setTime] = useState("");
  const [days, setDays] = useState(WEEKDAYS);
  const [minutesBefore, setMinutesBefore] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const route = options.find((option) => option.key === routeKey) ?? options[0];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await subscribeToPush();
      reminders.update((list) => [
        ...list,
        {
          id: crypto.randomUUID(),
          stopId: stop.id,
          stopName: stop.name,
          routeId: route.routeId,
          routeShortName: route.routeShortName,
          headsign: route.headsign,
          time,
          days,
          minutesBefore,
          enabled: true,
        },
      ]);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  if (!route) {
    return (
      <p className="text-sm text-slate-400">
        {isLoading ? "Loading routes…" : "No buses serve this stop in the next two hours."}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs text-slate-400">Route</span>
        <select
          value={route.key}
          onChange={(event) => {
            setRouteKey(event.target.value);
            setTime("");
          }}
          className={field}
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.routeShortName} → {option.headsign}
            </option>
          ))}
        </select>
      </label>

      <div>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Scheduled at this stop</span>
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={`${field} [color-scheme:dark]`}
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {route.times.slice(0, SUGGESTED_TIMES).map((suggested) => (
            <button
              key={suggested}
              type="button"
              onClick={() => setTime(suggested)}
              className={`rounded-md border px-2 py-1 text-xs ${
                suggested === time
                  ? "border-sky-500 bg-sky-500/20 text-sky-100"
                  : "border-slate-700 text-slate-300 hover:border-slate-500"
              }`}
            >
              {formatTimeOfDay(suggested)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs text-slate-400">Repeat on</span>
        <DayToggles days={days} onChange={setDays} />
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-slate-400">Notify me</span>
        <MinutesBeforeSelect
          value={minutesBefore}
          onChange={setMinutesBefore}
          className="w-full px-2 py-1.5"
        />
      </label>

      {error && <p className="text-xs text-amber-300">{error}</p>}

      <div className="flex justify-end gap-2">
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
          disabled={saving || !time || days.length === 0}
          className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
