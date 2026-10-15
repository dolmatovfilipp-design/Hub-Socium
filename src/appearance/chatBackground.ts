import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  canSync,
  fetchAppearancePrefs,
  fetchConversationBackground,
  putAppearancePrefs,
  putConversationBackground,
} from './api'
import { applyPrefs } from './apply'
import {
  customImageURL,
  normalizeBackground,
  readManifestCache,
  readStore,
  rememberCustomImage,
  safeMediaURL,
  safeWallpaperURL,
  writeManifestCache,
  writeStore,
} from './storage'
import type { AppearancePatch, AppearancePrefs, ChatBackground, WallpaperEntry } from './types'

export const APPEARANCE_EVENT = 'hub-appearance'
export const APPEARANCE_ERROR_EVENT = 'hub-appearance-error'

export { normalizeBackground, rememberCustomImage }

function emit() {
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT))
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : 'Не удалось сохранить'
  window.dispatchEvent(new CustomEvent(APPEARANCE_ERROR_EVENT, { detail: message }))
}

export function readAppearance(): AppearancePrefs {
  return readStore().prefs
}

export function backgroundForChat(conversationId?: string): ChatBackground {
  const store = readStore()
  if (conversationId && store.chats[conversationId]) return store.chats[conversationId]
  return store.prefs.background
}

type RawWallpaper = { id?: string; name?: string; file?: string; src?: string }

let manifestFlight: Promise<WallpaperEntry[]> | null = null

/** Loads /wallpapers/manifest.json. Any number of entries; missing file yields the cache or []. */
export async function loadWallpaperManifest(): Promise<WallpaperEntry[]> {
  if (!manifestFlight) {
    manifestFlight = fetch('/wallpapers/manifest.json', { cache: 'no-cache' })
      .then(async (res) => {
        if (!res.ok) return readManifestCache()
        const body = (await res.json()) as { wallpapers?: RawWallpaper[] } | RawWallpaper[]
        const rows = Array.isArray(body) ? body : (body.wallpapers ?? [])
        const entries = rows.map(toEntry).filter((item): item is WallpaperEntry => !!item)
        if (entries.length) writeManifestCache(entries)
        return entries.length ? entries : readManifestCache()
      })
      .catch(() => readManifestCache())
  }
  try {
    return await manifestFlight
  } finally {
    manifestFlight = null
  }
}

function toEntry(raw: RawWallpaper): WallpaperEntry | null {
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,64}$/.test(id)) return null
  const file = typeof raw.file === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(raw.file) ? raw.file : ''
  const src = safeWallpaperURL(raw.src) || (file ? `/wallpapers/${file}` : '')
  if (!src) return null
  return { id, name: raw.name?.trim() || id, file: file || src.slice(src.lastIndexOf('/') + 1), src }
}

export function peekBackgroundImage(background: ChatBackground): string | null {
  if (background.kind === 'wallpaper') {
    const cached = readManifestCache().find((item) => item.id === background.id)
    if (cached) return cached.src
    if (background.url && safeWallpaperURL(background.url)) return background.url
    if (background.id) return `/wallpapers/${background.id}.png`
  }
  if (background.kind === 'custom' && background.url && safeMediaURL(background.url)) return background.url
  return null
}

export async function resolveBackgroundImage(background: ChatBackground, conversationId?: string): Promise<string | null> {
  const override = !!(conversationId && readStore().chats[conversationId])
  if (background.kind === 'custom') {
    const local = await customImageURL(override ? conversationId : undefined)
    if (local) return local
  }
  return peekBackgroundImage(background)
}

function queuePrefs(patch: AppearancePatch) {
  const store = readStore()
  if (patch.appearance) store.prefs.appearance = patch.appearance
  if (patch.accent) store.prefs.accent = patch.accent
  if (patch.fontScale) store.prefs.fontScale = patch.fontScale
  if (patch.background) store.prefs.background = normalizeBackground(patch.background)
  store.pending = {
    ...(store.pending ?? {}),
    ...(patch.appearance ? { appearance: patch.appearance } : {}),
    ...(patch.accent ? { accent: patch.accent } : {}),
    ...(patch.fontScale ? { fontScale: patch.fontScale } : {}),
    ...(patch.background ? { background: store.prefs.background } : {}),
  }
  writeStore(store)
  applyPrefs(store.prefs)
  emit()
  schedulePrefsPush()
}

let prefsTimer = 0

function schedulePrefsPush() {
  window.clearTimeout(prefsTimer)
  prefsTimer = window.setTimeout(() => {
    void flushPrefs()
  }, 250)
}

function hasPatch(patch: AppearancePatch) {
  return !!(patch.appearance || patch.accent || patch.fontScale || patch.background)
}

async function flushPrefs() {
  const pending = readStore().pending
  if (!pending || !hasPatch(pending) || !canSync()) return
  const sent = JSON.stringify(pending)
  try {
    const saved = await putAppearancePrefs(pending)
    const store = readStore()
    const still = store.pending
    const same = still && JSON.stringify(still) === sent
    store.prefs = {
      ...saved,
      appearance: still?.appearance ?? saved.appearance,
      accent: still?.accent ?? saved.accent,
      fontScale: still?.fontScale ?? saved.fontScale,
      background: still?.background ? normalizeBackground(still.background) : saved.background,
    }
    store.pending = same ? null : still
    writeStore(store)
    applyPrefs(store.prefs)
    emit()
    if (!same && still && hasPatch(still)) schedulePrefsPush()
  } catch (error) {
    fail(error)
  }
}

export function updateAppearance(patch: AppearancePatch) {
  queuePrefs(patch)
}

export function setGlobalBackground(background: ChatBackground) {
  queuePrefs({ background: normalizeBackground(background) })
}

/** Pass null to inherit the account-wide background. */
export async function setConversationBackground(conversationId: string, background: ChatBackground | null) {
  const store = readStore()
  if (background == null) delete store.chats[conversationId]
  else store.chats[conversationId] = normalizeBackground(background)
  const saved = background == null ? null : store.chats[conversationId]
  store.pendingChats[conversationId] = { background: saved }
  writeStore(store)
  emit()
  if (!canSync()) return
  try {
    await putConversationBackground(conversationId, saved)
    const next = readStore()
    const current = next.pendingChats[conversationId]
    if (current && JSON.stringify(current.background) === JSON.stringify(saved)) {
      delete next.pendingChats[conversationId]
      writeStore(next)
    }
  } catch (error) {
    fail(error)
  }
}

let booted = false

export function bootAppearance() {
  applyPrefs(readStore().prefs)
  if (!booted) {
    booted = true
    const pending = readStore().pending
    if (pending && hasPatch(pending)) schedulePrefsPush()
    for (const [id, item] of Object.entries(readStore().pendingChats)) {
      void setConversationBackground(id, item.background)
    }
  }
  if (canSync() && !readStore().pending) {
    void fetchAppearancePrefs()
      .then((prefs) => {
        if (readStore().pending) return
        const store = readStore()
        store.prefs = prefs
        writeStore(store)
        applyPrefs(prefs)
        emit()
      })
      .catch(() => {})
  }
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const onChange = () => {
    if (readStore().prefs.appearance === 'system') applyPrefs(readStore().prefs)
  }
  mq.addEventListener?.('change', onChange)
  return () => mq.removeEventListener?.('change', onChange)
}

export function cssImage(url: string | null) {
  if (!url || /["\\()]/.test(url)) return 'none'
  return `url("${url}")`
}

export function useChatBackground(conversationId?: string) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onChange = () => setTick((n) => n + 1)
    window.addEventListener(APPEARANCE_EVENT, onChange)
    return () => window.removeEventListener(APPEARANCE_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (!conversationId || !canSync() || readStore().pendingChats[conversationId]) return
    let dead = false
    void fetchConversationBackground(conversationId)
      .then((remote) => {
        if (dead || readStore().pendingChats[conversationId]) return
        const store = readStore()
        if (remote == null) delete store.chats[conversationId]
        else store.chats[conversationId] = remote
        writeStore(store)
        emit()
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [conversationId])

  const background = useMemo(() => backgroundForChat(conversationId), [conversationId, tick])
  const [image, setImage] = useState<string | null>(() => peekBackgroundImage(background))

  useEffect(() => {
    let dead = false
    const current = backgroundForChat(conversationId)
    setImage(peekBackgroundImage(current))
    void resolveBackgroundImage(current, conversationId).then((url) => {
      if (!dead && url) setImage(url)
    })
    if (current.kind === 'wallpaper') {
      void loadWallpaperManifest().then(() => {
        if (!dead) setImage(peekBackgroundImage(backgroundForChat(conversationId)))
      })
    }
    return () => {
      dead = true
    }
  }, [background, conversationId, tick])

  const active = background.kind !== 'none' && !!image
  const layerStyle: CSSProperties | undefined = active
    ? {
        ['--chat-bg-image' as string]: cssImage(image),
        ['--chat-bg-blur' as string]: `${background.blur}px`,
        ['--chat-bg-dim' as string]: String(background.dim / 100),
      }
    : undefined
  return { background, image: active ? image : null, active, blur: background.blur, dim: background.dim, layerStyle }
}
