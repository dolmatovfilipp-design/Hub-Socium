export type VoicePrefs = {
  voiceEnabled: boolean
  gestureEnabled: boolean
  rate: number
  indicator: 'full' | 'compact'
}

export const VOICE_PREFS_KEY = 'hub-voice-prefs-v1'
export const VOICE_PREFS_EVENT = 'hub-voice-prefs'

export const defaultVoicePrefs: VoicePrefs = {
  voiceEnabled: false,
  gestureEnabled: false,
  rate: 1,
  indicator: 'full',
}

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_KEY)
    if (!raw) return { ...defaultVoicePrefs }
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>
    const rate = typeof parsed.rate === 'number' ? Math.min(1.4, Math.max(0.7, parsed.rate)) : 1
    return {
      voiceEnabled: parsed.voiceEnabled === true,
      gestureEnabled: parsed.gestureEnabled === true,
      rate: Math.round(rate * 10) / 10,
      indicator: parsed.indicator === 'compact' ? 'compact' : 'full',
    }
  } catch {
    return { ...defaultVoicePrefs }
  }
}

export function saveVoicePrefs(next: VoicePrefs) {
  localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(VOICE_PREFS_EVENT, { detail: next }))
}
