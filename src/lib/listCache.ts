/** Lightweight in-memory + sessionStorage cache for snappy list returns (G7). */

const mem = new Map<string, { at: number; data: unknown }>()

export function cacheGet<T>(key: string, maxAgeMs = 60_000): T | null {
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data as T
  try {
    const raw = sessionStorage.getItem('hub_cache_' + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; data: T }
    if (Date.now() - parsed.at > maxAgeMs) return null
    mem.set(key, parsed)
    return parsed.data
  } catch {
    return null
  }
}

export function cacheSet(key: string, data: unknown): void {
  const entry = { at: Date.now(), data }
  mem.set(key, entry)
  try {
    sessionStorage.setItem('hub_cache_' + key, JSON.stringify(entry))
  } catch {
    /* quota / private mode */
  }
}
