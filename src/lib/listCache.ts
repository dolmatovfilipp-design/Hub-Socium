/** In-memory, session, and local cache so chat lists paint before the network. */

const mem = new Map<string, { at: number; data: unknown }>()
const PREFIX = 'hub_cache_'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function readRaw(key: string): string | null {
  const name = PREFIX + key
  try {
    const session = sessionStorage.getItem(name)
    if (session) return session
  } catch {
    /* private mode */
  }
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

function parseEntry<T>(raw: string): { at: number; data: T } | null {
  try {
    const parsed = JSON.parse(raw) as { at?: number; data?: T }
    if (!parsed || typeof parsed.at !== 'number' || !('data' in parsed)) return null
    if (Date.now() - parsed.at > MAX_AGE_MS) return null
    return { at: parsed.at, data: parsed.data as T }
  } catch {
    return null
  }
}

/** Fresh cache only. Prefetch uses this so a recent list is not fetched twice. */
export function cacheGet<T>(key: string, maxAgeMs = 60_000): T | null {
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data as T
  const raw = readRaw(key)
  if (!raw) return null
  const parsed = parseEntry<T>(raw)
  if (!parsed || Date.now() - parsed.at > maxAgeMs) return null
  mem.set(key, parsed)
  return parsed.data
}

/** Last saved copy, including one that is older than the fresh window. */
export function cachePeek<T>(key: string): T | null {
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.data as T
  const raw = readRaw(key)
  if (!raw) return null
  const parsed = parseEntry<T>(raw)
  if (!parsed) return null
  mem.set(key, parsed)
  return parsed.data
}

export function cacheSet(key: string, data: unknown): void {
  const entry = { at: Date.now(), data }
  mem.set(key, entry)
  const raw = JSON.stringify(entry)
  const name = PREFIX + key
  try {
    sessionStorage.setItem(name, raw)
  } catch {
    /* quota */
  }
  try {
    localStorage.setItem(name, raw)
  } catch {
    /* quota */
  }
}
