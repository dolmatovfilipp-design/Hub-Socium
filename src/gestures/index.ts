/**
 * Phase 3 public surface. See INTEGRATION.md before editing Settings or the voice module.
 */
export { GestureRuntime } from './GestureRuntime'
export { GestureInstruction, GestureSettingsBlock, GestureSettingsEntry } from './GestureSettings'
export {
  bindBuiltinGestureCommands,
  claimGestureCommand,
  claimVoiceCommand,
  dispatchGestureCommand,
  registerGestureCommands,
  resetGestureArbiter,
} from './arbiter'
export { loadGesturePrefs, saveGesturePrefs, subscribeGesturePrefs, VOICE_PREFS_KEY, DEFAULT_GESTURE_PREFS } from './prefs'
export { registerGestureSpeaker, speakGesture } from './speech'
export type { GestureCommand, GestureId, GesturePrefs, GestureUiStatus } from './types'
