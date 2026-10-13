/**
 * Phase 1 owns writes to this key (the «Управление интерфейсом» screen).
 * Phase 2 only reads it. After a same-tab write, dispatch `hub-voice-prefs`
 * on window — the storage event does not fire in the tab that wrote.
 */

import { PHASE2_CATALOG, type VoicePresetName } from './commands.ts'

export const VOICE_PREFS_KEY = 'hub-voice-prefs-v1'
export const VOICE_PREFS_EVENT = 'hub-voice-prefs'

export type VoicePrefs = {
  /** Master switch «Управление голосом». */
  voiceEnabled?: boolean
  /** «Чтение и навигация» | «Переписка» | «Публикации». Default reading. */
  preset?: VoicePresetName
  /** «Пауза тишины», seconds 1..8. Default 3. */
  silenceSeconds?: number
  /** Speech rate 0.7..1.4. Default 1. */
  speechRate?: number
  /** Spoken feedback. Default on. */
  voiceReplies?: boolean
  /** Per-command overrides keyed by catalog id (C-06, …). */
  commands?: Record<string, boolean>
}

export function readVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as VoicePrefs
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

export function isVoiceModeOn(prefs: VoicePrefs = readVoicePrefs()): boolean {
  return prefs.voiceEnabled === true
}

export function silenceSecondsOf(prefs: VoicePrefs): number {
  const n = prefs.silenceSeconds
  if (typeof n !== 'number' || !Number.isFinite(n)) return 3
  return Math.min(8, Math.max(1, Math.round(n)))
}

export function speechRateOf(prefs: VoicePrefs): number {
  const n = prefs.speechRate
  if (typeof n !== 'number' || !Number.isFinite(n)) return 1
  return Math.min(1.4, Math.max(0.7, Math.round(n * 10) / 10))
}

export function isPhase2CommandEnabled(id: string, prefs: VoicePrefs): boolean {
  if (prefs.voiceEnabled !== true) return false
  const override = prefs.commands?.[id]
  if (typeof override === 'boolean') return override
  const item = PHASE2_CATALOG.find((c) => c.id === id)
  if (!item) return false
  const preset = prefs.preset ?? 'reading'
  if (item.presets.includes('reading')) return true
  if ((preset === 'chat' || preset === 'publish') && item.presets.includes('chat')) return true
  if (preset === 'publish' && item.presets.includes('publish')) return true
  return false
}

export function notifyVoicePrefsChanged(): void {
  window.dispatchEvent(new Event(VOICE_PREFS_EVENT))
}
