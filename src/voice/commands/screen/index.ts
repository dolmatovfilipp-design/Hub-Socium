/**
 * Phase 4 voice commands: communities, clips, actions, file shelf.
 *
 * Import `phase4Commands` into the Phase 1 matcher. Prefer `matchPhase4`,
 * which already applies screen scope and shelf priority. See `types.ts`
 * for the confirmation rules and the merge notes with the other voice work.
 * Wire the app with `createAppVoiceContext` from `./appContext.ts`.
 *
 * No wake word. «Уведомления» is G-07 and opens «Действия».
 */
import { actionsCommands } from './actions.ts'
import { clipsCommands } from './clips.ts'
import { communitiesCommands } from './communities.ts'
import { fileShelfCommands } from './files.ts'
import { matchVoiceCommand } from './match.ts'
import type { VoiceMatchResult } from './types.ts'

export { actionsCommands } from './actions.ts'
export { clipsCommands, offerVoiceClipFile, cancelClipUpload } from './clips.ts'
export { communitiesCommands, setCommunityFocus } from './communities.ts'
export { fileShelfCommands, dismissFileShelf, ingestPickedFiles, isFileShelfOpen, registerVoiceSay, subscribeFileShelf, getFileShelfSnapshot } from './files.ts'
export { matchVoiceCommand } from './match.ts'
export { cancelPhase4Pending } from './cancel.ts'
export { takeVoiceContinuation, setVoiceContinuation } from './pending.ts'
export type { VoiceCommandContext, VoiceCommandDefinition, VoiceCommandResult, VoiceConfirmation, VoiceMatch } from './types.ts'

export const phase4Commands = [
  ...communitiesCommands,
  ...clipsCommands,
  ...actionsCommands,
  ...fileShelfCommands,
] as const

export function matchPhase4(utterance: string, pathname: string): VoiceMatchResult {
  return matchVoiceCommand(phase4Commands, utterance, pathname)
}
