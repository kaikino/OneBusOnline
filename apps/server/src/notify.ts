import type { Arrival, PushMessage, PushSubscriptionJson, Reminder } from "@onebus/shared";
import { Client, Receiver } from "@upstash/qstash";
import { createHash, randomUUID } from "node:crypto";
import express, { type RequestHandler, Router } from "express";
import webpush from "web-push";
import { z } from "zod";
import { PREFIX, cacheEnabled, store } from "./cache.js";
import { arrivalsForStop, obaConfigured } from "./oba.js";

/** A trip belongs to a reminder when it's scheduled within this of the reminder's time. */
const MATCH_WINDOW_MS = 5 * 60_000;
/** QStash caps delays at 7 days, so longer waits hop. */
const MAX_DELAY_MS = 6 * 24 * 60 * 60_000;
/** Wake-ups this close to their target are treated as on time. */
const SLACK_MS = 60_000;

const env = (name: string) => process.env[name]?.trim() || undefined;

const vapidPublicKey = env("VAPID_PUBLIC_KEY");
const vapidPrivateKey = env("VAPID_PRIVATE_KEY");
const vapid =
  vapidPublicKey && vapidPrivateKey
    ? {
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey,
        subject: env("VAPID_SUBJECT") ?? "mailto:admin@example.com",
      }
    : null;

const qstashToken = env("QSTASH_TOKEN");
const qstash = qstashToken ? new Client({ token: qstashToken, baseUrl: env("QSTASH_URL") }) : null;
const receiver = new Receiver({
  currentSigningKey: env("QSTASH_CURRENT_SIGNING_KEY") ?? "",
  nextSigningKey: env("QSTASH_NEXT_SIGNING_KEY") ?? "",
});
const vercelUrl = env("VERCEL_PROJECT_PRODUCTION_URL");
const appUrl = env("APP_URL") ?? (vercelUrl && `https://${vercelUrl}`);

const production = process.env.NODE_ENV === "production";
/** Without QStash, local development schedules wake-ups with in-process timers. */
const useTimers = !qstash && !production;

export const pushConfigured =
  vapid !== null &&
  obaConfigured &&
  (useTimers || (qstash !== null && appUrl !== undefined && (cacheEnabled || !production)));

/** What a queued wake-up carries back to the server. */
interface Wake {
  deviceId: string;
  reminderId: string;
  /** The bus's scheduled time at the stop. */
  scheduledMs: number;
  /** When this wake-up is meant to run. */
  wakeMs: number;
  /** Set once the wake-up has been moved for a late bus, so it moves at most once. */
  rechecked?: boolean;
}

interface Entry {
  subscription: PushSubscriptionJson;
  timeZone: string;
  reminder: Reminder;
  /** The queued wake-up; wake-ups with any other id are stale and ignored. */
  wakeId?: string;
  /** The scheduled time last handled, so a retried wake-up doesn't notify twice. */
  handledMs?: number;
}

// Wake-up queue

const timers = new Map<string, NodeJS.Timeout>();

async function schedule(wake: Wake): Promise<string> {
  const atMs = Math.min(wake.wakeMs, Date.now() + MAX_DELAY_MS);
  if (qstash) {
    const { messageId } = await qstash.publishJSON({
      url: `${appUrl}/api/v1/notify/wake`,
      body: wake,
      notBefore: Math.floor(atMs / 1000),
      retries: 3,
    });
    return messageId;
  }
  const id = randomUUID();
  const timer = setTimeout(() => {
    timers.delete(id);
    onWake(wake, id).catch((err) => console.error("Reminder:", err));
  }, Math.max(0, atMs - Date.now()));
  timers.set(id, timer);
  return id;
}

async function cancel(wakeId: string | undefined): Promise<void> {
  if (!wakeId) return;
  if (qstash) {
    // Already delivered or gone; a stale wake-up is ignored anyway.
    await qstash.messages.delete(wakeId).catch(() => {});
  } else {
    clearTimeout(timers.get(wakeId));
    timers.delete(wakeId);
  }
}

// Storage: one hash per device, keyed by reminder id.

const memoryDevices = new Map<string, Map<string, Entry>>();

const deviceKey = (deviceId: string) => `${PREFIX}device:${deviceId}`;

function redis() {
  const redis = store();
  if (cacheEnabled && !redis) throw new Error("Redis unavailable");
  return redis;
}

async function loadEntries(deviceId: string): Promise<Map<string, Entry>> {
  const client = redis();
  if (!client) return new Map(memoryDevices.get(deviceId));
  const all = await client.hgetall(deviceKey(deviceId));
  return new Map(Object.entries(all).map(([id, json]) => [id, JSON.parse(json) as Entry]));
}

async function saveEntries(deviceId: string, entries: Map<string, Entry>): Promise<void> {
  const client = redis();
  if (!client) {
    if (entries.size > 0) memoryDevices.set(deviceId, entries);
    else memoryDevices.delete(deviceId);
    return;
  }
  const multi = client.multi().del(deviceKey(deviceId));
  for (const [id, entry] of entries) multi.hset(deviceKey(deviceId), id, JSON.stringify(entry));
  await multi.exec();
}

async function saveEntry(deviceId: string, entry: Entry): Promise<void> {
  const client = redis();
  if (client) await client.hset(deviceKey(deviceId), entry.reminder.id, JSON.stringify(entry));
  else memoryDevices.get(deviceId)?.set(entry.reminder.id, entry);
}

async function removeDevice(deviceId: string): Promise<void> {
  const entries = await loadEntries(deviceId);
  await Promise.all([...entries.values()].map((entry) => cancel(entry.wakeId)));
  await saveEntries(deviceId, new Map());
}

// Time zones

interface ZonedDate {
  year: number;
  month: number;
  day: number;
}

const zonedFormats = new Map<string, Intl.DateTimeFormat>();

function zoned(timeMs: number, timeZone: string): ZonedDate & { hour: number; minute: number } {
  let format = zonedFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    zonedFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(timeMs).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The instant a wall-clock time occurs in `timeZone`. */
function zonedTimeMs(date: ZonedDate, hour: number, minute: number, timeZone: string): number {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const shown = zoned(asUtc, timeZone);
  const offset = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) - asUtc;
  return asUtc - offset;
}

/** The scheduled time of the first occurrence whose notification is due after `afterMs`. */
function nextOccurrence(reminder: Reminder, timeZone: string, afterMs: number): number | undefined {
  const [hour, minute] = reminder.time.split(":").map(Number);
  const leadMs = reminder.minutesBefore * 60_000;
  const today = zoned(afterMs, timeZone);
  // Steps through calendar dates rather than 24-hour periods, which skip or repeat days around DST.
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (!reminder.days.includes(date.getUTCDay())) continue;
    const scheduledMs = zonedTimeMs(
      { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
      hour,
      minute,
      timeZone,
    );
    if (scheduledMs - leadMs > afterMs) return scheduledMs;
  }
  return undefined;
}

async function scheduleNext(deviceId: string, entry: Entry, afterMs: number) {
  const { reminder, timeZone } = entry;
  const scheduledMs = reminder.enabled ? nextOccurrence(reminder, timeZone, afterMs) : undefined;
  if (scheduledMs === undefined) return undefined;
  return schedule({
    deviceId,
    reminderId: reminder.id,
    scheduledMs,
    wakeMs: scheduledMs - reminder.minutesBefore * 60_000,
  });
}

// Notifying

function matchingTrip(arrivals: Arrival[], reminder: Reminder, scheduledMs: number) {
  let best: Arrival | undefined;
  for (const arrival of arrivals) {
    if (arrival.routeId !== reminder.routeId || arrival.headsign !== reminder.headsign) continue;
    const offBy = Math.abs(arrival.scheduledTimeMs - scheduledMs);
    if (offBy <= MATCH_WINDOW_MS && (!best || offBy < Math.abs(best.scheduledTimeMs - scheduledMs))) {
      best = arrival;
    }
  }
  return best;
}

function message(entry: Entry, trip: Arrival | undefined, etaMs: number, now: number): PushMessage {
  const { reminder, timeZone } = entry;
  const minutes = Math.max(0, Math.round((etaMs - now) / 60_000));
  const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const route = `${reminder.routeShortName} → ${reminder.headsign}`;
  let status = "scheduled";
  if (trip && trip.punctuality !== "scheduled") {
    const off = Math.max(1, Math.round(Math.abs(trip.deviationSec) / 60));
    status = trip.punctuality === "on_time" ? "live, on time" : `live, ${off} min ${trip.punctuality}`;
  }
  return {
    title: minutes === 0 ? `${route} arriving now` : `${route} in ${minutes} min`,
    body: `${reminder.stopName} · ${clock.format(etaMs)} (${status})`,
    tag: `reminder:${reminder.id}`,
    stopId: reminder.stopId,
  };
}

type SendResult = "sent" | "expired" | "failed";

async function send(subscription: PushSubscriptionJson, payload: PushMessage): Promise<SendResult> {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: vapid!,
      TTL: 10 * 60,
      urgency: "high",
    });
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // The browser unsubscribed or the subscription lapsed.
    if (status === 404 || status === 410) return "expired";
    console.error("Push failed:", status ?? (err as Error).message);
    return "failed";
  }
}

/**
 * Runs a reminder's wake-up, queued for `minutesBefore` its scheduled time. Checks the
 * live trip once: a late bus moves the notification once to match, otherwise it's sent.
 * OneBusAway being unreachable falls back to the schedule; a trip that isn't running
 * stays quiet. Then the next occurrence is queued.
 */
export async function onWake(wake: Wake, wakeId: string): Promise<void> {
  const entry = (await loadEntries(wake.deviceId)).get(wake.reminderId);
  if (!entry || entry.wakeId !== wakeId) return;

  const now = Date.now();
  const leadMs = entry.reminder.minutesBefore * 60_000;
  const requeue = async (next: Wake) => {
    entry.wakeId = await schedule(next);
    await saveEntry(wake.deviceId, entry);
  };

  // Still early: a hop over QStash's delay limit.
  if (wake.wakeMs - now > SLACK_MS) return requeue(wake);

  if (entry.handledMs !== wake.scheduledMs) {
    const arrivals = await arrivalsForStop(entry.reminder.stopId, 120, 15).then(
      (res) => res.arrivals,
      () => null,
    );
    const trip = arrivals ? matchingTrip(arrivals, entry.reminder, wake.scheduledMs) : undefined;
    if (!arrivals || trip) {
      const etaMs = trip?.arrivalTimeMs ?? wake.scheduledMs;
      if (!wake.rechecked && etaMs - leadMs - now > SLACK_MS) {
        return requeue({ ...wake, wakeMs: etaMs - leadMs, rechecked: true });
      }
      if (etaMs > now - SLACK_MS) {
        const result = await send(entry.subscription, message(entry, trip, etaMs, now));
        if (result === "expired") return removeDevice(wake.deviceId);
        // Throwing makes QStash retry this wake-up.
        if (result === "failed") throw new Error("Push failed");
      }
    }
    entry.handledMs = wake.scheduledMs;
  }

  entry.wakeId = await scheduleNext(wake.deviceId, entry, Math.max(now, wake.scheduledMs - leadMs));
  await saveEntry(wake.deviceId, entry);
}

// Routes

const deviceId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

const isTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().max(512), auth: z.string().max(512) }),
});

const reminderSchema = z.object({
  id: z.string().min(1).max(64),
  stopId: z.string().min(1).max(128),
  stopName: z.string().max(200),
  routeId: z.string().min(1).max(128),
  routeShortName: z.string().max(64),
  headsign: z.string().max(200),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  minutesBefore: z.number().int().min(0).max(120),
  enabled: z.boolean(),
});

const syncBody = z.object({
  subscription: subscriptionSchema,
  timeZone: z.string().max(64).refine(isTimeZone, "Unknown time zone"),
  reminders: z.array(reminderSchema).max(50),
});

const wakeBody = z.object({
  deviceId: z.string(),
  reminderId: z.string(),
  scheduledMs: z.number(),
  wakeMs: z.number(),
  rechecked: z.boolean().optional(),
});

const requirePush: RequestHandler = (_req, res, next) => {
  if (pushConfigured) return next();
  res.status(503).json({ error: "Push notifications are not configured" });
};

export const notifyRoutes = Router();

notifyRoutes.use("/notify", requirePush);

notifyRoutes.get("/notify/key", (_req, res) => {
  res.json({ publicKey: vapid!.publicKey });
});

/** Replaces this device's reminders, queuing wake-ups for new and changed ones. */
notifyRoutes.put("/notify/reminders", express.json(), async (req, res) => {
  const { subscription, timeZone, reminders } = syncBody.parse(req.body);
  const id = deviceId(subscription.endpoint);
  const previous = await loadEntries(id);
  const entries = new Map<string, Entry>();

  for (const reminder of reminders) {
    const old = previous.get(reminder.id);
    previous.delete(reminder.id);
    const unchanged =
      old?.timeZone === timeZone && JSON.stringify(old.reminder) === JSON.stringify(reminder);
    if (old && unchanged) {
      entries.set(reminder.id, { ...old, subscription });
      continue;
    }
    await cancel(old?.wakeId);
    const entry: Entry = { subscription, timeZone, reminder };
    entry.wakeId = await scheduleNext(id, entry, Date.now());
    entries.set(reminder.id, entry);
  }
  await Promise.all([...previous.values()].map((old) => cancel(old.wakeId)));

  await saveEntries(id, entries);
  res.json({ ok: true });
});

notifyRoutes.post("/notify/test", express.json(), async (req, res) => {
  const { subscription } = z.object({ subscription: subscriptionSchema }).parse(req.body);
  const result = await send(subscription, {
    title: "OneBusOnline",
    body: "Bus notifications are working.",
    tag: "test",
  });
  res.status(result === "sent" ? 200 : 502).json({ ok: result === "sent" });
});

/** Called by QStash when a wake-up is due. The raw body is needed to check its signature. */
notifyRoutes.post("/notify/wake", express.text({ type: "*/*" }), async (req, res) => {
  const signature = req.header("upstash-signature");
  const wakeId = req.header("upstash-message-id");
  const verified =
    qstash !== null &&
    signature !== undefined &&
    wakeId !== undefined &&
    (await receiver.verify({ signature, body: req.body }).catch(() => false));
  if (!verified) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  await onWake(wakeBody.parse(JSON.parse(req.body)), wakeId);
  res.json({ ok: true });
});
