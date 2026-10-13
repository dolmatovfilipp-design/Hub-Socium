export type VoicePresetName = 'reading' | 'chat' | 'publish'

export type VoicePrefs = {
  voiceEnabled: boolean
  rate: number
  /** Same scale as `rate`. Phase 2 reads this name. */
  speechRate: number
  indicator: 'full' | 'compact'
  /** «Чтение и навигация» | «Переписка» | «Публикации». */
  preset: VoicePresetName
  silenceSeconds: number
  voiceReplies: boolean
  commands: Record<string, boolean>
}

export const VOICE_PREFS_KEY = 'hub-voice-prefs-v1'
export const VOICE_PREFS_EVENT = 'hub-voice-prefs'

export const defaultVoicePrefs: VoicePrefs = {
  voiceEnabled: false,
  rate: 1,
  speechRate: 1,
  indicator: 'full',
  preset: 'reading',
  silenceSeconds: 3,
  voiceReplies: true,
  commands: {},
}

function clampRate(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.round(Math.min(1.4, Math.max(0.7, n)) * 10) / 10
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
    /* ignore broken JSON */
  }
  return {}
}

export function loadVoicePrefs(): VoicePrefs {
  const parsed = readBag()
  const rate = clampRate(parsed.rate, 1)
  const preset = parsed.preset === 'chat' || parsed.preset === 'publish' ? parsed.preset : 'reading'
  const silence = parsed.silenceSeconds
  const commands =
    parsed.commands && typeof parsed.commands === 'object' && !Array.isArray(parsed.commands)
      ? (parsed.commands as Record<string, boolean>)
      : {}
  return {
    voiceEnabled: parsed.voiceEnabled === true,
    rate,
    speechRate: clampRate(parsed.speechRate, rate),
    indicator: parsed.indicator === 'compact' ? 'compact' : 'full',
    preset,
    silenceSeconds:
      typeof silence === 'number' && Number.isFinite(silence) ? Math.min(8, Math.max(1, Math.round(silence))) : 3,
    voiceReplies: parsed.voiceReplies !== false,
    commands,
  }
}

/** Merge into the existing JSON and drop leftover camera-gesture keys. */
export function saveVoicePrefs(next: VoicePrefs) {
  const bag = readBag()
  delete bag.gestures
  delete bag.gestureEnabled
  const speechRate = clampRate(next.speechRate ?? next.rate, next.rate)
  const stored = {
    ...bag,
    voiceEnabled: next.voiceEnabled === true,
    rate: clampRate(next.rate, 1),
    speechRate,
    indicator: next.indicator === 'compact' ? 'compact' : 'full',
    preset: next.preset === 'chat' || next.preset === 'publish' ? next.preset : 'reading',
    silenceSeconds: Math.min(8, Math.max(1, Math.round(next.silenceSeconds || 3))),
    voiceReplies: next.voiceReplies !== false,
    commands: next.commands ?? {},
  }
  localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(stored))
  window.dispatchEvent(new CustomEvent(VOICE_PREFS_EVENT, { detail: loadVoicePrefs() }))
}
