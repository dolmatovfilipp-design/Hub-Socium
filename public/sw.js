/* Hub service worker — Web Push display + click (PB-07). Server send via VAPID. */
self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(Promise.resolve())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let title = 'Hub'
  let body = 'Новое уведомление'
  let url = '/app'
  try {
    if (event.data) {
      const data = event.data.json()
      if (data.title) title = String(data.title)
      if (data.body) body = String(data.body)
      if (data.url) url = String(data.url)
    }
  } catch (_) {
    try {
      body = event.data ? event.data.text() : body
    } catch (_) {}
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/app'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          if ('navigate' in c && target) {
            try { c.navigate(target) } catch (_) {}
          }
          return c.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    }),
  )
})
