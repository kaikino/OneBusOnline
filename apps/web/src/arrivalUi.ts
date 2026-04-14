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
