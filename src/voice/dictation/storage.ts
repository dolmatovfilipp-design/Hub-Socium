import { apiUploadMedia } from '../../lib/api'
import { buildMediaFile } from '../../lib/captureSession'

/**
 * Chat and comment voice messages go through the existing media upload
 * (`POST /v1/media/upload`). The backend stores the object in the project's
 * S3 bucket — Selectel when S3_ENDPOINT, S3_BUCKET and the keys are set —
 * under the `media/` prefix (`backend/internal/media/service.go`).
 *
 * This is not the Phase 1 command recording. Command audio uses `voice-stt/`
 * and a 24-hour lifetime. A voice message is uploaded only after the person
 * confirms send, and then it belongs to the conversation like any other attachment.
 */
export async function storeVoiceRecording(
  blob: Blob,
  filename = 'voice.webm',
): Promise<{ url: string }> {
  const file = await buildMediaFile(blob, 'audio', blob.type || filename)
  const media = await apiUploadMedia(file)
  return { url: media.url }
}
