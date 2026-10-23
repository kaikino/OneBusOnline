import type { PushSubscriptionJson, Reminder, ReminderSync } from "@onebus/shared";

const BASE_URL = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/v1/notify`;

export type PushSupport = "supported" | "needs-install" | "unsupported";

/** iOS only offers push to the app once it's added to the Home Screen. */
export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
    return "supported";
  }
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "needs-install" : "unsupported";
}

async function send(method: string, path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("The server couldn't set up notifications.");
  return res;
}

function base64UrlBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function existingSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  return (await navigator.serviceWorker.ready).pushManager.getSubscription();
}

/** Asks for permission and subscribes this device. Must run from a tap on iOS. Throws a message for the user. */
export async function subscribeToPush(): Promise<PushSubscriptionJson> {
  const support = pushSupport();
  if (support === "needs-install") {
    throw new Error(
      "On iPhone, add OneBusOnline to your Home Screen (Share → Add to Home Screen) and open it from there to get notifications.",
    );
  }
  if (support === "unsupported") throw new Error("This browser can't show notifications.");
  if ((await Notification.requestPermission()) !== "granted") {
    throw new Error("Notifications are blocked. Allow them in your browser or system settings.");
  }
  let subscription = await existingSubscription();
  if (!subscription) {
    const res = await fetch(`${BASE_URL}/key`);
    if (!res.ok) throw new Error("Notifications aren't set up on the server.");
    const { publicKey } = (await res.json()) as { publicKey: string };
    subscription = await (await navigator.serviceWorker.ready).pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlBytes(publicKey),
    });
  }
  return subscription.toJSON() as PushSubscriptionJson;
}

/** Replaces this device's reminders on the server. Does nothing until the device has subscribed. */
export async function syncReminders(list: Reminder[]): Promise<void> {
  const subscription = await existingSubscription();
  if (!subscription) return;
  const body: ReminderSync = {
    subscription: subscription.toJSON() as PushSubscriptionJson,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reminders: list,
  };
  await send("PUT", "/reminders", body);
}

export async function sendTestNotification(): Promise<void> {
  await send("POST", "/test", { subscription: await subscribeToPush() });
}
