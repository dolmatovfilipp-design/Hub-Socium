import { useEffect, useState } from 'react'
import { flushOfflineQueue, isBrowserOffline, listOfflineQueue, offlineQueueCount } from '../lib/offlineQueue'
import { apiCreatePost, apiSendMessageFull, isApiMode } from '../lib/api'

export function OfflineBadge() {
  const [n, setN] = useState(0)
  const [offline, setOffline] = useState(isBrowserOffline())

  useEffect(() => {
    const sync = () => setN(offlineQueueCount())
    sync()
    const onOnline = () => {
      setOffline(false)
      if (!isApiMode()) return
      void flushOfflineQueue({
        post: async (p) => {
          await apiCreatePost(String(p.body ?? ''), p.image_url as string | undefined, p.tags as string[] | undefined)
        },
        message: async (p) => {
          await apiSendMessageFull(String(p.conversationId), {
            body: String(p.body ?? ''),
            client_id: p.client_id ? String(p.client_id) : undefined,
            reply_to_id: p.reply_to_id ? String(p.reply_to_id) : undefined,
            media_url: p.media_url ? String(p.media_url) : undefined,
            msg_type: p.media_url ? 'image' : 'text',
          })
        },
        draft: async (p) => {
          // drafts already local; no-op flush marker
          void p
        },
      }).then(sync)
    }
    const onOffline = () => setOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('hub-offline-queue', sync)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('hub-offline-queue', sync)
    }
  }, [])

  if (!offline && n === 0) return null
  const label = offline
    ? n > 0
      ? `Офлайн · ${n} ждёт сеть`
      : 'Офлайн'
    : `${n} ждёт сеть`

  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(8px,env(safe-area-inset-top))] z-[var(--hub-z-toast)] -translate-x-1/2">
      <span className="offline-badge pointer-events-auto" title={listOfflineQueue().map((i) => i.label).join(', ')}>
        {label}
      </span>
    </div>
  )
}
