self.addEventListener("push", (event) => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = {};
    }
  }

  const title = data.title || "Tsadie";
  const body = data.body || "Time to check the bus.";
  const url = data.url || "/";
  const tag = data.tag || `tsadie-alert-${Date.now()}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      requireInteraction: true,
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200, 100, 400],
      data: {
        url,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(url);
        }

        return undefined;
      }),
  );
});
