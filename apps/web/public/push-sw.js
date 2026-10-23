// Loaded into the generated service worker to show bus notifications.

self.addEventListener("push", (event) => {
  const message = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(message.title ?? "OneBusOnline", {
      body: message.body,
      tag: message.tag,
      renotify: Boolean(message.tag),
      icon: "/icons/icon.png",
      badge: "/icons/icon.png",
      data: { stopId: message.stopId },
    }),
  );
});

// Opens the notification's stop, in the running app when there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { stopId } = event.notification.data ?? {};
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (app) {
        await app.focus();
        if (stopId) app.postMessage({ stopId });
      } else {
        await self.clients.openWindow(stopId ? `/?stop=${encodeURIComponent(stopId)}` : "/");
      }
    })(),
  );
});
