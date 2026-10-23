import type { Arrival, Stop } from "@onebus/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchArrivals } from "../../api";
import { formatTimeOfDay, timeOfDay } from "../../lib/format";
import { subscribeToPush } from "../../lib/push";
import { reminders } from "../../lib/saved";
import { DayToggles, MinutesBeforeSelect } from "./ReminderControls";

const WEEKDAYS = [1, 2, 3, 4, 5];
/** The next 24 hours of arrivals cover every time of day a route stops here. */
const DAY_MINUTES = 24 * 60;
/** Service days run past midnight, so times before this sort after the evening. */
const SERVICE_DAY_START = "04:00";

const serviceDayOrder = (time: string) => (time < SERVICE_DAY_START ? `~${time}` : time);

interface RouteOption {
  key: string;
  routeId: string;
  routeShortName: string;
  headsign: string;
  /** Every scheduled time at the stop, in service-day order. */
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
    if (!option.times.includes(time)) option.times.push(time);
  }
  for (const option of options.values()) {
    option.times.sort((a, b) => serviceDayOrder(a).localeCompare(serviceDayOrder(b)));
  }
  return [...options.values()].sort((a, b) =>
    a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true }),
  );
}

const field = "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100";

export function ReminderForm({ stop, onDone }: { stop: Stop; onDone: () => void }) {
  const schedule = useQuery({
    queryKey: ["daySchedule", stop.id],
    queryFn: () => fetchArrivals(stop.id, DAY_MINUTES, 0),
    staleTime: 30 * 60_000,
  });
  const options = routeOptions(schedule.data?.arrivals ?? []);

  const [routeKey, setRouteKey] = useState<string>();
  const [times, setTimes] = useState<string[]>([]);
  const [customTime, setCustomTime] = useState("");
  const [days, setDays] = useState(WEEKDAYS);
  const [minutesBefore, setMinutesBefore] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const route = options.find((option) => option.key === routeKey) ?? options[0];

  const toggleTime = (time: string) =>
    setTimes((list) =>
      list.includes(time) ? list.filter((t) => t !== time) : [...list, time].sort(),
    );

  const addCustomTime = () => {
    setTimes((list) => (list.includes(customTime) ? list : [...list, customTime].sort()));
    setCustomTime("");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await subscribeToPush();
      reminders.update((list) => [
        ...list,
        ...times.map((time) => ({
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
        })),
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
        {schedule.isPending
          ? "Loading routes…"
          : schedule.isError
            ? "Couldn't load this stop's schedule."
            : "No buses serve this stop in the next 24 hours."}
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
            setTimes([]);
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
        <span className="mb-1 block text-xs text-slate-400">
          Scheduled at this stop — pick one or more
        </span>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
          {[...new Set([...route.times, ...times])]
            .sort((a, b) => serviceDayOrder(a).localeCompare(serviceDayOrder(b)))
            .map((time) => (
              <button
                key={time}
                type="button"
                onClick={() => toggleTime(time)}
                aria-pressed={times.includes(time)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  times.includes(time)
                    ? "border-sky-500 bg-sky-500/20 text-sky-100"
                    : "border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
              >
                {formatTimeOfDay(time)}
              </button>
            ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            type="time"
            value={customTime}
            onChange={(event) => setCustomTime(event.target.value)}
            aria-label="Another time"
            className={`${field} [color-scheme:dark]`}
          />
          <button
            type="button"
            onClick={addCustomTime}
            disabled={!customTime}
            className="shrink-0 rounded-md border border-slate-700 px-3 text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Add
          </button>
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
          disabled={saving || times.length === 0 || days.length === 0}
          className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : times.length > 1 ? `Save ${times.length}` : "Save"}
        </button>
      </div>
    </div>
  );
}
