const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MINUTES_BEFORE = [2, 5, 10, 15, 20, 30];

export function DayToggles(props: { days: number[]; onChange: (days: number[]) => void }) {
  const toggle = (day: number) =>
    props.onChange(
      props.days.includes(day)
        ? props.days.filter((d) => d !== day)
        : [...props.days, day].sort((a, b) => a - b),
    );

  return (
    <div className="flex gap-1">
      {DAYS.map((name, day) => {
        const on = props.days.includes(day);
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(day)}
            aria-pressed={on}
            aria-label={name}
            className={`h-7 w-7 rounded-full border text-xs font-semibold transition ${
              on
                ? "border-sky-500 bg-sky-500/20 text-sky-100"
                : "border-slate-700 text-slate-500 hover:border-slate-500"
            }`}
          >
            {name[0]}
          </button>
        );
      })}
    </div>
  );
}

export function MinutesBeforeSelect(props: {
  value: number;
  onChange: (minutes: number) => void;
  className?: string;
}) {
  const options = MINUTES_BEFORE.includes(props.value)
    ? MINUTES_BEFORE
    : [...MINUTES_BEFORE, props.value].sort((a, b) => a - b);

  return (
    <select
      value={props.value}
      onChange={(event) => props.onChange(Number(event.target.value))}
      aria-label="Minutes before the bus arrives"
      className={`rounded-md border border-slate-700 bg-slate-950 text-slate-200 ${props.className ?? ""}`}
    >
      {options.map((minutes) => (
        <option key={minutes} value={minutes}>
          {minutes} min before
        </option>
      ))}
    </select>
  );
}
