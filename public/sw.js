/* Hub service worker — push scaffold (PB-07). No send pipeline. */
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
  try {
    if (event.data) {
      const data = event.data.json()
      if (data.title) title = String(data.title)
      if (data.body) body = String(data.body)
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
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/app')
    }),
  )
})
