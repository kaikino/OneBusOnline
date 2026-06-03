export function formatRelativeAge(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) return "unknown age";
  const clampedMs = Math.max(0, deltaMs);
  const sec = Math.round(clampedMs / 1000);
  if (sec < 60) return `${sec} s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 730) return `${Math.max(1, day)} days ago`;
  const yr = Math.round(day / 365);
  return `${Math.max(1, yr)} yrs ago`;
}
