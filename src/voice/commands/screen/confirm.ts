import type { VoiceCommandContext, VoiceConfirmation } from './types.ts'

const spent = new WeakSet<VoiceCommandContext>()

/**
 * Ask unless this utterance's context already carries a matching grant.
 * The grant is spent by the first matching question, so a later question
 * in the same handler (for example «Открыть чат?» after «Пойду») is asked
 * again. Create a new context per utterance. `dangerous` covers one `yes`.
 * A prior `yes` does not cover `dangerous`.
 */
export async function requireConfirm(
  ctx: VoiceCommandContext,
  prompt: string,
  kind: Exclude<VoiceConfirmation, 'none'>,
): Promise<boolean> {
  if (!spent.has(ctx)) {
    const granted = ctx.confirmationGranted
    const covers = granted === 'dangerous' || (granted === 'yes' && kind === 'yes')
    if (covers) {
      spent.add(ctx)
      return true
    }
  }
  return ctx.confirm(prompt, kind)
}
