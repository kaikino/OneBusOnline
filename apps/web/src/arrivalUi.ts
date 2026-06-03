import type { ArrivalPunctuality, ArrivalRow } from "@onebus/shared";

export function minutesUntil(epochMs: number, nowMs: number): number {
  return (epochMs - nowMs) / 60_000;
}

export function displayTimeMs(row: ArrivalRow): number {
  if (row.predicted && row.predictedArrivalTimeMs > 0) {
    return row.predictedArrivalTimeMs;
  }
  return row.scheduledArrivalTimeMs;
}

/**
 * ETA pill label shared by the preview chips and expanded rows.
 * `subMinuteLabel` differs by surface: chips render "<1 min", rows "< 1 min".
 */
export function etaLabel(mins: number, subMinuteLabel = "< 1 min"): string {
  const roundedMins = Math.trunc(mins);
  if (roundedMins === 0) return "NOW";
  if (mins < 1 && mins >= 0) return subMinuteLabel;
  return `${roundedMins} min`;
}

/** Absolute schedule deviation in whole minutes, floored at 1. */
export function deviationMinutes(deviationSec: number): number {
  return Math.max(1, Math.round(Math.abs(deviationSec) / 60));
}

export function punctualityClasses(p: ArrivalPunctuality): string {
  switch (p) {
    case "on_time":
      return "text-emerald-600";
    case "early":
      return "text-orange-500";
    case "late":
      return "text-red-600";
    default:
      return "text-slate-500";
  }
}

export const PUNCTUALITY_DOC =
  "Green: on time (real-time, within ±90s deviation). Blue: early. Red: delayed. Gray: schedule only.";
