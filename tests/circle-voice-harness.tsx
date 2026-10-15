import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { IconMic, IconPlayCircle } from '../src/components/Icons'
import { useCircleTake } from '../src/components/CircleRecorder'
import { CircleDraftPreview, VideoCirclePlayer } from '../src/components/VideoCircle'
import { useVoiceTake, VoiceComposerPreview } from '../src/components/VoiceComposerPreview'
import { captureStats, pickRecorderMime } from '../src/lib/captureSession'

type Sent = { url: string; poster?: string; durationMs: number }

function Stage() {
  const [toast, setToast] = useState('')
  const [sent, setSent] = useState<Sent | null>(null)
  const voice = useVoiceTake(setToast)
  const circle = useCircleTake(setToast)
  const stats = captureStats()
  return (
    <div className="flex h-full flex-col bg-black text-white">
      <div className="flex flex-1 flex-col items-start gap-3 overflow-hidden px-4 pt-8">
        <p className="text-[13px] text-[#8e8e93]">Чат</p>
        {sent ? (
          <div data-sent-circle="">
            <VideoCirclePlayer url={sent.url} poster={sent.poster} durationMs={sent.durationMs} />
          </div>
        ) : (
          <p className="text-[15px] text-[#8e8e93]">Нажмите кружок — камера откроется сразу.</p>
        )}
        {toast ? (
          <p data-toast="" className="text-[13px] text-[#ff9b9b]">
            {toast}
          </p>
        ) : null}
        <p data-mime-ios="" className="hidden">
          {pickRecorderMime('video', (m) => m.startsWith('video/mp4'))}
        </p>
        <p data-mime-audio-ios="" className="hidden">
          {pickRecorderMime('audio', (m) => m.startsWith('audio/mp4') || m.includes('aac'))}
        </p>
        <p data-gum="" className="hidden">
          {stats.gumCalls}
        </p>
        <p data-draft-video="" className="hidden">
          {circle.draft ? `${circle.draft.file.name}|${circle.draft.file.type}|${circle.draft.file.size}` : ''}
        </p>
        <p data-draft-audio="" className="hidden">
          {voice.draft ? `${voice.draft.file.name}|${voice.draft.file.type}|${voice.draft.file.size}` : ''}
        </p>
      </div>
      {voice.recording ? (
        <div data-voice-recording="" className="flex items-center justify-between px-4 py-2 text-[14px]">
          <span className="text-[#ff453a]">● Запись {voice.seconds}с</span>
          <button type="button" className="font-semibold" onClick={() => void voice.stop()}>
            Стоп
          </button>
        </div>
      ) : null}
      {voice.draft ? (
        <VoiceComposerPreview
          url={voice.draft.url}
          durationMs={voice.draft.durationMs}
          onDelete={voice.discard}
          onSend={() => voice.discard()}
        />
      ) : null}
      {circle.draft ? (
        <CircleDraftPreview
          url={circle.draft.url}
          poster={circle.draft.posterUrl}
          durationMs={circle.draft.durationMs}
          onDelete={circle.discard}
          onSend={() => {
            const shot = circle.draft
            if (!shot) return
            setSent({
              url: URL.createObjectURL(shot.file),
              poster: shot.posterFile ? URL.createObjectURL(shot.posterFile) : undefined,
              durationMs: shot.durationMs,
            })
            circle.discard()
          }}
        />
      ) : null}
      {circle.overlay}
      <div className="hub-composer-row px-2 pb-4">
        <button
          type="button"
          className="hub-circle-btn"
          style={{ touchAction: 'none' }}
          aria-label="Кружок"
          data-alert={circle.recording ? 'true' : undefined}
          onPointerDown={(e) => {
            if (voice.recording) return
            circle.onPointerDown(e)
          }}
          onPointerMove={circle.onPointerMove}
          onPointerUp={circle.onPointerUp}
          onPointerCancel={circle.onPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <IconPlayCircle size={22} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="hub-circle-btn"
          aria-label="Голосовое"
          data-alert={voice.recording ? 'true' : undefined}
          onClick={() => {
            if (circle.recording) return
            void voice.start()
          }}
        >
          <IconMic size={22} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Stage />)
