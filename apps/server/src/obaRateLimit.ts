import { RateLimitError } from "onebusaway-sdk";

const MIN_INTERVAL_MS = Number(process.env.OBA_MIN_REQUEST_INTERVAL_MS ?? 0);

let paceTail: Promise<void> = Promise.resolve();
let lastObaCallMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function paceObaRequest(): Promise<void> {
  const next = paceTail.then(async () => {
    if (MIN_INTERVAL_MS > 0) {
      const gap = lastObaCallMs + MIN_INTERVAL_MS - Date.now();
      if (gap > 0) await sleep(gap);
      lastObaCallMs = Date.now();
    }
  });
  paceTail = next.catch(() => {});
  await next;
}

export async function obaCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await paceObaRequest();
    try {
      return await fn();
    } catch (e) {
      const last = attempt === maxAttempts - 1;
      if (!(e instanceof RateLimitError) || last) throw e;
      let delayMs = Math.min(25_000, Math.round(900 * 1.85 ** attempt));
      const hdrs = e.headers as { get?: (n: string) => string | null } | undefined;
      const ra = hdrs?.get?.("retry-after");
      if (ra) {
        const sec = parseInt(ra, 10);
        if (!Number.isNaN(sec)) delayMs = Math.max(delayMs, sec * 1000);
      }
      await sleep(delayMs);
      console.warn(
        `[bff] OBA ${label}: 429 — backing off ${delayMs}ms (retry ${attempt + 2}/${maxAttempts})`
      );
    }
  }
  throw new Error("obaCall: exhausted retries");
}
