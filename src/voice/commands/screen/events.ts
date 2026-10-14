export const VOICE_REFRESH = 'hub:voice-refresh'
export const VOICE_ACTIVITY = 'hub:voice-activity'
export const VOICE_CLIP_CAPTION = 'hub:voice-clip-caption'
export const VOICE_CLEAR_PENDING = 'hub:voice-clear-pending'
export const VOICE_CONTINUATION = 'hub:voice-continuation'

export function emitVoice(name: string, detail?: unknown): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function refreshVoiceScreen(screen: 'channels' | 'channel' | 'clips' | 'activity'): void {
  emitVoice(VOICE_REFRESH, screen)
}
