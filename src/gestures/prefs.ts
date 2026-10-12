import type { GestureFps, GesturePrefs, GesturePreview, GestureSensitivity } from './types'

/**
 * Shared with the voice phase. Only the `gestures` object is owned here.
 * Reads and writes merge into the existing JSON so voice keys are kept.
 */
export const VOICE_PREFS_KEY = 'hub-voice-prefs-v1'

export const GESTURE_PREFS_EVENT = 'hub-gesture-prefs'

export const DEFAULT_GESTURE_PREFS: GesturePrefs = {
  enabled: false,
  sensitivity: 'medium',
  preview: 'thumbnail',
  requireActivation: true,
  fps: 15,
  pauseInBackground: true,
  items: {
    palm: true,
    thumbUp: true,
    thumbDown: false,
    palmUp: true,
    palmDown: true,
    palmLeft: true,
    palmRight: true,
    pinch: true,
    fist: true,
  },
}

function isSensitivity(value: unknown): value is GestureSensitivity {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isPreview(value: unknown): value is GesturePreview {
  return value === 'off' || value === 'thumbnail'
}

function isFps(value: unknown): value is GestureFps {
  return value === 10 || value === 15 || value === 24
}

export function sanitizeGesturePrefs(raw: unknown): GesturePrefs {
  const source = raw && typeof raw === 'object' ? (raw as Partial<GesturePrefs>) : {}
  const items = source.items && typeof source.items === 'object' ? source.items : undefined
  const base = DEFAULT_GESTURE_PREFS.items
  return {
    enabled: source.enabled === true,
    sensitivity: isSensitivity(source.sensitivity) ? source.sensitivity : 'medium',
    preview: isPreview(source.preview) ? source.preview : 'thumbnail',
    requireActivation: source.requireActivation !== false,
    fps: isFps(source.fps) ? source.fps : 15,
    pauseInBackground: source.pauseInBackground !== false,
    items: {
      palm: typeof items?.palm === 'boolean' ? items.palm : base.palm,
      thumbUp: typeof items?.thumbUp === 'boolean' ? items.thumbUp : base.thumbUp,
      thumbDown: typeof items?.thumbDown === 'boolean' ? items.thumbDown : base.thumbDown,
      palmUp: typeof items?.palmUp === 'boolean' ? items.palmUp : base.palmUp,
      palmDown: typeof items?.palmDown === 'boolean' ? items.palmDown : base.palmDown,
      palmLeft: typeof items?.palmLeft === 'boolean' ? items.palmLeft : base.palmLeft,
      palmRight: typeof items?.palmRight === 'boolean' ? items.palmRight : base.palmRight,
      pinch: typeof items?.pinch === 'boolean' ? items.pinch : base.pinch,
      fist: typeof items?.fist === 'boolean' ? items.fist : base.fist,
    },
  }
}

function readBag(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* ignore broken JSON and keep defaults */
  }
  return {}
}

let cached: GesturePrefs | null = null

export function loadGesturePrefs(): GesturePrefs {
  if (!cached) cached = sanitizeGesturePrefs(readBag().gestures)
  return cached
}

export function saveGesturePrefs(prefs: GesturePrefs): void {
  const next = sanitizeGesturePrefs(prefs)
  cached = next
  const bag = readBag()
  bag.gestures = next
  localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(bag))
  window.dispatchEvent(new CustomEvent(GESTURE_PREFS_EVENT, { detail: next }))
}

export function subscribeGesturePrefs(listener: () => void): () => void {
  const refresh = () => {
    cached = sanitizeGesturePrefs(readBag().gestures)
    listener()
  }
  window.addEventListener(GESTURE_PREFS_EVENT, refresh)
  window.addEventListener('storage', refresh)
  return () => {
    window.removeEventListener(GESTURE_PREFS_EVENT, refresh)
    window.removeEventListener('storage', refresh)
  }
}
