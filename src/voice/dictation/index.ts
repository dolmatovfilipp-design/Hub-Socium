/**
 * Phase 2 public API. Read INTEGRATION.md before wiring Phase 1.
 *
 * Phase 1 calls `submitPhrase` with each final transcript and skips its own
 * command when `consumed` is true. Set `window.__HUB_VOICE_PHASE1__.ownsRecognition`
 * so this module does not open a second microphone for commands.
 * Voice messages are stored with `storeVoiceRecording` (existing Selectel media bucket).
 * There is no wake word.
 */

export { PHASE2_CATALOG, matchCatalog, normalizePhrase } from './commands.ts'
export type { Phase2CatalogItem, VoicePresetName, ConfirmKind } from './commands.ts'
export {
  VOICE_PREFS_KEY,
  VOICE_PREFS_EVENT,
  readVoicePrefs,
  isVoiceModeOn,
  silenceSecondsOf,
  isPhase2CommandEnabled,
  notifyVoicePrefsChanged,
} from './prefs.ts'
export type { VoicePrefs } from './prefs.ts'
export { SPEECH, previewSpeech, silenceCaption } from './speech.ts'
export { createSilenceTracker, rmsOf } from './silence.ts'
export {
  step,
  initialSession,
  indicatorOf,
  MIN_VOICE_MS,
  CONFIRM_MS,
  CHAT_MAX_MS,
  POST_MAX_MS,
} from './session.ts'
export type {
  DictMessage,
  SessionState,
  SessionEvent,
  SessionContext,
  StepResult,
  Effect,
  Pending,
} from './session.ts'
export { storeVoiceRecording } from './storage.ts'
export {
  submitPhrase,
  requestVoiceCapture,
  getDictationSnapshot,
  setDictationFocus,
  planFeedComment,
  commentNavigation,
  peekPendingDictation,
  clearPendingDictation,
  consumePendingDictation,
  phase1OwnsRecognition,
  PENDING_DICTATION_KEY,
  PHASE1_EVENT,
} from './bridge.ts'
export type { PhraseResult, DictationSnapshot, Phase1VoiceBridge, DictationBridge } from './bridge.ts'
export { DictationDock } from './DictationDock.tsx'
export type { DictationDockProps } from './DictationDock.tsx'
