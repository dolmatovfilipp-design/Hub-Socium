/** S14 — offline queue for posts / messages / drafts. */

export type OfflineKind = 'post' | 'message' | 'draft'

export type OfflineItem = {
  id: string
  kind: OfflineKind
  payload: Record<string, unknown>
  createdAt: string
  label: string
}

const KEY = 'hub_offline_queue_v1'

function read(): OfflineItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function write(items: OfflineItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent('hub-offline-queue'))
}

export function listOfflineQueue(): OfflineItem[] {
  return read()
}

export function offlineQueueCount(): number {
  return read().length
}

export function enqueueOffline(kind: OfflineKind, payload: Record<string, unknown>, label: string): OfflineItem {
  const item: OfflineItem = {
    id: `oq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    payload,
    createdAt: new Date().toISOString(),
    label,
  }
  write([item, ...read()])
  return item
}

export function removeOffline(id: string) {
  write(read().filter((x) => x.id !== id))
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

type Flushers = {
  post?: (payload: Record<string, unknown>) => Promise<void>
  message?: (payload: Record<string, unknown>) => Promise<void>
  draft?: (payload: Record<string, unknown>) => Promise<void>
}

let flushing = false

export async function flushOfflineQueue(flushers: Flushers): Promise<number> {
  if (flushing || isBrowserOffline()) return 0
  flushing = true
  let done = 0
  try {
    const items = [...read()].reverse() // oldest first
    for (const item of items) {
      const fn = flushers[item.kind]
      if (!fn) continue
      try {
        await fn(item.payload)
        removeOffline(item.id)
        done++
      } catch {
        // keep item; stop to preserve order
        break
      }
    }
  } finally {
    flushing = false
  }
  return done
}
