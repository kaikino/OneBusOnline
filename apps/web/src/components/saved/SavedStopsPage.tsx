import type { Reminder, Stop } from "@onebus/shared";
import { Bell, BellOff, BellPlus, ChevronRight, Star, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useReminders, useSavedStops } from "../../hooks/useSaved";
import { formatTimeOfDay, reminderDateMs } from "../../lib/format";
import { pushSupport, sendTestNotification } from "../../lib/push";
import { reminders, toggleSaved, updateReminder } from "../../lib/saved";
import { DayToggles, MinutesBeforeSelect } from "./ReminderControls";
import { ReminderForm } from "./ReminderForm";

const ONCE_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const iconButton = "rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100";

function ReminderItem({ reminder }: { reminder: Reminder }) {
  const update = (change: Partial<Reminder>) => updateReminder(reminder.id, change);

  return (
    <li className="rounded-md bg-slate-900/70 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <p className={`min-w-0 flex-1 truncate text-sm ${reminder.enabled ? "" : "opacity-50"}`}>
          <span className="font-semibold text-sky-300">{reminder.routeShortName}</span>
          <span className="ml-1.5 text-slate-300">{reminder.headsign}</span>
          <span className="ml-1.5 text-slate-100">{formatTimeOfDay(reminder.time)}</span>
        </p>
        <button
          type="button"
          onClick={() => update({ enabled: !reminder.enabled })}
          aria-pressed={reminder.enabled}
          aria-label={reminder.enabled ? "Pause notification" : "Resume notification"}
          className={iconButton}
        >
          {reminder.enabled ? (
            <Bell className="h-4 w-4 text-sky-400" aria-hidden />
          ) : (
            <BellOff className="h-4 w-4" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => reminders.update((list) => list.filter((r) => r.id !== reminder.id))}
          aria-label="Delete notification"
          className={`${iconButton} hover:text-red-400`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div
        className={`mt-1.5 flex flex-wrap items-center gap-2 ${reminder.enabled ? "" : "opacity-50"}`}
      >
        {reminder.date ? (
          <>
            <span className="text-xs text-slate-400">
              Once · {ONCE_DATE.format(reminderDateMs(reminder.date, reminder.time))}
            </span>
            <button
              type="button"
              onClick={() => {
                const day = new Date(reminderDateMs(reminder.date!, reminder.time)).getDay();
                update({ date: undefined, days: [day] });
              }}
              className="rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500"
            >
              Repeat weekly
            </button>
          </>
        ) : (
          <DayToggles days={reminder.days} onChange={(days) => update({ days })} />
        )}
        <MinutesBeforeSelect
          value={reminder.minutesBefore}
          onChange={(minutesBefore) => update({ minutesBefore })}
          className="px-1.5 py-1 text-xs"
        />
      </div>
    </li>
  );
}

function SavedStop(props: { stop: Stop; reminders: Reminder[]; onSelect: () => void }) {
  const [adding, setAdding] = useState(false);

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={props.onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="h-3 w-3 shrink-0 rounded-full border-2 border-white bg-pink-500" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-100">{props.stop.name}</span>
            {props.stop.code && (
              <span className="block text-xs text-slate-500">Code {props.stop.code}</span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
          aria-label="Add bus notification"
          className={iconButton}
        >
          <BellPlus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => toggleSaved(props.stop)}
          aria-label="Remove saved stop"
          className={iconButton}
        >
          <Star className="h-4 w-4 fill-pink-500 text-pink-500" aria-hidden />
        </button>
      </div>
      {props.reminders.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {props.reminders.map((reminder) => (
            <ReminderItem key={reminder.id} reminder={reminder} />
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-2">
          <ReminderForm stop={props.stop} onDone={() => setAdding(false)} />
        </div>
      )}
    </li>
  );
}

function NotificationStatus(props: { hasReminders: boolean; syncError: string | null }) {
  const [testResult, setTestResult] = useState<string>();
  const support = pushSupport();

  let warning = props.syncError;
  if (support === "needs-install") {
    warning =
      "To get bus notifications on iPhone, add OneBusOnline to your Home Screen (Share → Add to Home Screen) and open it from there.";
  } else if (support === "unsupported") {
    warning = "This browser can't show notifications.";
  } else if (props.hasReminders && Notification.permission === "denied") {
    warning = "Notifications are blocked. Allow them in your browser or system settings.";
  }

  const test = () => {
    setTestResult("Sending…");
    sendTestNotification().then(
      () => setTestResult("Sent — check your notifications."),
      (err: Error) => setTestResult(err.message),
    );
  };

  return (
    <>
      {warning && (
        <p className="rounded-lg border border-amber-700/60 bg-amber-950/60 px-3 py-2 text-xs text-amber-100">
          {warning}
        </p>
      )}
      {support === "supported" && props.hasReminders && (
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>{testResult ?? "Notifications arrive even when the app is closed."}</span>
          <button
            type="button"
            onClick={test}
            className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            Send test
          </button>
        </div>
      )}
    </>
  );
}

interface Props {
  onClose: () => void;
  onSelectStop: (stop: Stop) => void;
  syncError: string | null;
}

export function SavedStopsPage({ onClose, onSelectStop, syncError }: Props) {
  const stops = useSavedStops();
  const allReminders = useReminders();

  return (
    <section className="absolute inset-0 z-[2500] flex flex-col bg-slate-950">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-50">
          <Star className="h-5 w-5 fill-pink-500 text-pink-500" aria-hidden />
          Saved stops
        </h2>
        <button type="button" onClick={onClose} aria-label="Close saved stops" className={iconButton}>
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        <NotificationStatus hasReminders={allReminders.length > 0} syncError={syncError} />
        {stops.length === 0 ? (
          <p className="pt-8 text-center text-sm text-slate-400">
            No saved stops yet. Open a stop and tap its star to save it here.
          </p>
        ) : (
          <ul className="space-y-3">
            {stops.map((stop) => (
              <SavedStop
                key={stop.id}
                stop={stop}
                reminders={allReminders
                  .filter((reminder) => reminder.stopId === stop.id)
                  .sort(
                    (a, b) =>
                      a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true }) ||
                      a.headsign.localeCompare(b.headsign) ||
                      a.time.localeCompare(b.time),
                  )}
                onSelect={() => onSelectStop(stop)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
