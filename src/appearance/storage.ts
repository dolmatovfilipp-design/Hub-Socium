import {
  accentById,
  defaultPrefs,
  fontById,
  noneBackground,
  type AccentId,
  type AppearanceMode,
  type AppearancePatch,
  type AppearancePrefs,
  type ChatBackground,
  type FontScale,
  type WallpaperEntry,
} from './types'

const STORE_KEY = 'hub-appearance-v1'
const MANIFEST_KEY = 'hub-wallpaper-manifest-v1'

type PendingChat = { background: ChatBackground | null }

type AppearanceStore = {
  prefs: AppearancePrefs
  chats: Record<string, ChatBackground>
  pending: AppearancePatch | null
  pendingChats: Record<string, PendingChat>
}

function emptyStore(): AppearanceStore {
  const prefs = defaultPrefs()
  if (typeof localStorage !== 'undefined') {
    const legacy = localStorage.getItem('hub-theme-pref')
    if (legacy === 'light' || legacy === 'dark' || legacy === 'system') prefs.appearance = legacy
  }
  return { prefs, chats: {}, pending: null, pendingChats: {} }
}

function asMode(value: unknown): AppearanceMode | null {
  return value === 'dark' || value === 'light' || value === 'system' ? value : null
}

function asAccent(value: unknown): AccentId | null {
  return accentById(String(value)).id === value ? (value as AccentId) : null
}

function asFont(value: unknown): FontScale | null {
  return fontById(String(value)).id === value ? (value as FontScale) : null
}

export function normalizeBackground(input: Partial<ChatBackground> | null | undefined): ChatBackground {
  const kind = input?.kind
  if (kind !== 'wallpaper' && kind !== 'custom') return noneBackground()
  const blur = clamp(input?.blur, 0, 24)
  const dim = clamp(input?.dim, 0, 75)
  if (kind === 'wallpaper') {
    const url = safeWallpaperURL(input?.url)
    let id = safeId(input?.id)
    if (!id && url) id = stem(url)
    if (!id) return noneBackground()
    return { kind, id, url: url || undefined, blur, dim }
  }
  const url = safeMediaURL(input?.url)
  if (!url) return noneBackground()
  return { kind, url, blur, dim }
}

function clamp(value: unknown, lo: number, hi: number) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
  return Math.min(hi, Math.max(lo, n))
}

function safeId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,64}$/.test(value) ? value : ''
}

export function safeWallpaperURL(value: unknown): string {
  if (typeof value !== 'string') return ''
  return /^\/wallpapers\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value) ? value : ''
}

export function safeMediaURL(value: unknown): string {
  if (typeof value !== 'string') return ''
  return /^\/v1\/media\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
    ? value
    : ''
}

function stem(url: string) {
  const base = url.slice(url.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function sanitizePrefs(raw: Partial<AppearancePrefs> | undefined): AppearancePrefs {
  const base = defaultPrefs()
  if (!raw) return base
  return {
    themeId: typeof raw.themeId === 'string' && raw.themeId ? raw.themeId : base.themeId,
    appearance: asMode(raw.appearance) ?? base.appearance,
    accent: asAccent(raw.accent) ?? base.accent,
    fontScale: asFont(raw.fontScale) ?? base.fontScale,
    background: normalizeBackground(raw.background),
  }
}

export function readStore(): AppearanceStore {
  if (typeof localStorage === 'undefined') return emptyStore()
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<AppearanceStore>
    const chats: Record<string, ChatBackground> = {}
    for (const [id, bg] of Object.entries(parsed.chats ?? {})) {
      if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) continue
      chats[id] = normalizeBackground(bg)
    }
    const pendingChats: Record<string, PendingChat> = {}
    for (const [id, item] of Object.entries(parsed.pendingChats ?? {})) {
      if (!item) continue
      pendingChats[id] = { background: item.background == null ? null : normalizeBackground(item.background) }
    }
    return {
      prefs: sanitizePrefs(parsed.prefs),
      chats,
      pending: parsed.pending ?? null,
      pendingChats,
    }
  } catch {
    return emptyStore()
  }
}

export function writeStore(next: AppearanceStore) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    /* quota: the in-memory caller still applied the change */
  }
}

export function readManifestCache(): WallpaperEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(MANIFEST_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as WallpaperEntry[]
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.src) : []
  } catch {
    return []
  }
}

export function writeManifestCache(entries: WallpaperEntry[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(entries))
  } catch {
    /* ignore */
  }
}

const DB = 'hub-appearance'
const BLOBS = 'blobs'
const objectURLs = new Map<string, string>()

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(BLOBS)) req.result.createObjectStore(BLOBS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function blobScope(conversationId?: string) {
  return conversationId ? `chat:${conversationId}` : 'global'
}

export async function rememberCustomImage(conversationId: string | undefined, blob: Blob) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOBS, 'readwrite')
    tx.objectStore(BLOBS).put(blob, blobScope(conversationId))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  const prev = objectURLs.get(blobScope(conversationId))
  if (prev) URL.revokeObjectURL(prev)
  objectURLs.delete(blobScope(conversationId))
}

export async function customImageURL(conversationId: string | undefined): Promise<string | null> {
  const key = blobScope(conversationId)
  const cached = objectURLs.get(key)
  if (cached) return cached
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(BLOBS, 'readonly')
      const req = tx.objectStore(BLOBS).get(key)
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    objectURLs.set(key, url)
    return url
  } catch {
    return null
  }
}
