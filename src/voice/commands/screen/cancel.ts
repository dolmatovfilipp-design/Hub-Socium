import { cancelClipUpload } from './clips.ts'
import { dismissFileShelf } from './files.ts'
import { clearVoiceContinuation } from './pending.ts'

/**
 * Phase 1 «отмена» (G-05) must call this. It clears the file shelf, a clip
 * that was chosen but not published, and a continuation waiting on a file.
 * Returns true when something was actually waiting.
 */
export function cancelPhase4Pending(): boolean {
  const shelf = dismissFileShelf()
  const clip = cancelClipUpload()
  const continuation = clearVoiceContinuation()
  return shelf || clip || continuation
}
