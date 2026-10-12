import type { VoiceCommandContext, VoiceCommandResult } from './types.ts'
import { emitVoice, VOICE_CONTINUATION } from './events.ts'

export type VoiceContinuation = (ctx: VoiceCommandContext) => Promise<VoiceCommandResult>

let continuation: VoiceContinuation | null = null

/** Arm a follow-up that runs after the user picks a file outside the recognizer. */
export function setVoiceContinuation(next: VoiceContinuation | null): void {
  continuation = next
  if (next) emitVoice(VOICE_CONTINUATION)
}

export function takeVoiceContinuation(): VoiceContinuation | null {
  const current = continuation
  continuation = null
  return current
}

export function clearVoiceContinuation(): boolean {
  const had = continuation !== null
  continuation = null
  return had
}
