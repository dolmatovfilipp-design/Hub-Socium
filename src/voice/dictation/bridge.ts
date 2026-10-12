/**
 * Integration point for the Phase 1 voice framework.
 *
 * Phase 1 should:
 * 1. Set `window.__HUB_VOICE_PHASE1__ = { ownsRecognition: true, speak, setIndicator }`
 *    and dispatch `hub-voice-phase1` so this module does not open a second recognizer.
 * 2. Forward each final transcript to `window.__HUB_DICTATION__.submitPhrase(text)`.
 *    If the result is `consumed`, do not also run navigation on that phrase.
 * 3. While `getSnapshot().kind === 'recording'`, pause command recognition:
 *    the microphone belongs to the voice-message recorder. «Стоп» is the on-screen
 *    button and, if a transcript still arrives, the session.
 * 4. Write prefs to `hub-voice-prefs-v1` and dispatch `hub-voice-prefs`.
 * 5. On the feed, call `planFeedComment` and navigate to `navigateTo`.
 *    Do not also submitPhrase('комментарий') — the compose screen consumes the pending flag.
 *
 * There is no wake word.
 */

import { normalizePhrase } from './commands.ts'
import { isPhase2CommandEnabled, type VoicePrefs } from './prefs.ts'
import { SPEECH } from './speech.ts'

export const PENDING_DICTATION_KEY = 'hub-dictation-pending'
export const PHASE1_EVENT = 'hub-voice-phase1'

export type Phase1VoiceBridge = {
  /** When true, Phase 2 does not start Web Speech itself. */
  ownsRecognition?: boolean
  speak?: (text: string) => void
  setIndicator?: (label: string | null) => void
}

export type PhraseResult = {
  consumed: boolean
  speech?: string
  indicator: string | null
  navigateTo?: string
}

export type DictationSnapshot = {
  kind: string
  indicator: string | null
  surface: 'chat' | 'compose' | null
}

export type DictationBridge = {
  submitPhrase: (phrase: string) => PhraseResult
  getSnapshot: () => DictationSnapshot
  requestVoiceCapture: (surface: 'chat' | 'compose') => void
  setFocus: (messageId: string | null) => void
  planFeedComment: (phrase: string, postId: string | null, prefs: VoicePrefs) => PhraseResult
}

type SurfaceApi = {
  surface: 'chat' | 'compose'
  submit: (phrase: string) => PhraseResult
  snapshot: () => DictationSnapshot
  openCapture: () => void
}

let surfaceApi: SurfaceApi | null = null
const captureHandlers = new Map<string, () => void>()
let externalFocus: string | null = null

export function phase1OwnsRecognition(): boolean {
  return window.__HUB_VOICE_PHASE1__?.ownsRecognition === true
}

export function readDictationFocus(): string | null {
  return externalFocus
}

export function setDictationFocus(messageId: string | null): void {
  externalFocus = messageId
  window.dispatchEvent(new Event('hub-dictation-focus'))
}

export function registerSurface(api: SurfaceApi): () => void {
  surfaceApi = api
  publishBridge()
  return () => {
    if (surfaceApi === api) surfaceApi = null
  }
}

export function registerVoiceCapture(surface: 'chat' | 'compose', fn: () => void): () => void {
  captureHandlers.set(surface, fn)
  return () => {
    if (captureHandlers.get(surface) === fn) captureHandlers.delete(surface)
  }
}

export function requestVoiceCapture(surface: 'chat' | 'compose'): void {
  const fromSurface = surfaceApi?.surface === surface ? surfaceApi.openCapture : undefined
  ;(fromSurface ?? captureHandlers.get(surface))?.()
}

export function submitPhrase(phrase: string): PhraseResult {
  if (!surfaceApi) return { consumed: false, indicator: null }
  return surfaceApi.submit(phrase)
}

export function getDictationSnapshot(): DictationSnapshot {
  return surfaceApi?.snapshot() ?? { kind: 'idle', indicator: null, surface: null }
}

export function commentNavigation(postId: string): string {
  try {
    sessionStorage.setItem(PENDING_DICTATION_KEY, 'comment')
  } catch {
    /* sessionStorage can be blocked */
  }
  return `/app/compose?reply=${encodeURIComponent(postId)}`
}

export function peekPendingDictation(): 'comment' | 'voice-reply' | null {
  try {
    const value = sessionStorage.getItem(PENDING_DICTATION_KEY)
    if (value === 'comment' || value === 'voice-reply') return value
  } catch {
    /* ignore */
  }
  return null
}

export function clearPendingDictation(): void {
  try {
    sessionStorage.removeItem(PENDING_DICTATION_KEY)
  } catch {
    /* ignore */
  }
}

export function consumePendingDictation(): 'comment' | 'voice-reply' | null {
  const value = peekPendingDictation()
  clearPendingDictation()
  return value
}

/** Feed has no dictation dock. Phase 1 navigates to `navigateTo` and stops. */
export function planFeedComment(phrase: string, postId: string | null, prefs: VoicePrefs): PhraseResult {
  const norm = normalizePhrase(phrase)
  if (norm !== 'комментарий' && norm !== 'ответь на пост') {
    return { consumed: false, indicator: null }
  }
  if (!isPhase2CommandEnabled('F-05', prefs)) {
    return { consumed: true, speech: SPEECH.disabled, indicator: SPEECH.disabled }
  }
  if (!postId) {
    return { consumed: true, speech: SPEECH.wrongScreen, indicator: SPEECH.wrongScreen }
  }
  return {
    consumed: true,
    speech: SPEECH.dictateComment,
    indicator: SPEECH.dictateHint,
    navigateTo: commentNavigation(postId),
  }
}

function publishBridge(): void {
  const bridge: DictationBridge = {
    submitPhrase,
    getSnapshot: getDictationSnapshot,
    requestVoiceCapture,
    setFocus: setDictationFocus,
    planFeedComment,
  }
  window.__HUB_DICTATION__ = bridge
}

declare global {
  interface Window {
    __HUB_VOICE_PHASE1__?: Phase1VoiceBridge
    __HUB_DICTATION__?: DictationBridge
  }
}
