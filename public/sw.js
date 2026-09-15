// Shows alerts from the server and opens the page when one is tapped.

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Fantasy Football Gamer', body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Fantasy Football Gamer', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const open = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = open.find(c => new URL(c.url).origin === self.location.origin);
    if (page) return page.focus();
    return clients.openWindow('/');
  })());
});
