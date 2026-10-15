const KEY = 'hub-profile-pin-v1'

type PinMap = Record<string, string>

function readMap(): PinMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PinMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Explicit wall pin. A new post never writes this. */
export function readProfilePin(userId: string): string | null {
  if (!userId) return null
  const id = readMap()[userId]
  return typeof id === 'string' && id ? id : null
}

export function writeProfilePin(userId: string, postId: string | null) {
  if (!userId) return
  const map = readMap()
  if (postId) map[userId] = postId
  else delete map[userId]
  localStorage.setItem(KEY, JSON.stringify(map))
  window.dispatchEvent(new CustomEvent('hub:profile-pin', { detail: { userId, postId } }))
}
