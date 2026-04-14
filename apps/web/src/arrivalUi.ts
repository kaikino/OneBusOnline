import type { Punctuality } from "@onebus/shared";

export const PUNCTUALITY_COLOR: Record<Punctuality, string> = {
  on_time: "text-emerald-500",
  early: "text-orange-400",
  late: "text-red-500",
  scheduled: "text-slate-400",
};

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const formatClock = (timeMs: number) => CLOCK.format(timeMs);

export const minutesUntil = (timeMs: number, nowMs: number) => (timeMs - nowMs) / 60_000;

/** Arrivals stay listed for a while after the bus has left. */
export const hasDeparted = (timeMs: number, nowMs: number) => minutesUntil(timeMs, nowMs) <= -1;

export function etaLabel(timeMs: number, nowMs: number): string {
  const minutes = Math.trunc(minutesUntil(timeMs, nowMs));
  return minutes === 0 ? "NOW" : `${minutes} min`;
}

export function punctualityLabel(punctuality: Punctuality, deviationSec: number): string {
  if (punctuality === "scheduled") return "Scheduled";
  if (punctuality === "on_time") return "On time";
  const minutes = Math.max(1, Math.round(Math.abs(deviationSec) / 60));
  return `${minutes} min ${punctuality}`;
}
