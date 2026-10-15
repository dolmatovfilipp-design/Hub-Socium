import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IconPause, IconPlane, IconPlay, IconStop, IconTrash } from './Icons'
import { acceptTrimmedVoice, trimSilence } from '../lib/audioTrim'
import {
  acquireAudio,
  buildMediaFile,
  createTakeClock,
  disableStream,
  finishRecorder,
  finiteTakeMs,
  formatClock,
  MIN_TAKE_MS,
  primeMediaDuration,
  recordStream,
  takeDurationSec,
  type TakeClock,
} from '../lib/captureSession'

const MAX_SEC = 120
const BARS = 32

export type VoiceDraft = {
  url: string
  file: File
  durationMs: number
}

export function VoiceRecordingBar({ seconds, onStop }: { seconds: number; onStop: () => void }) {
  return (
    <div data-voice-recording="" className="hub-record-bar">
      <span className="flex items-center gap-2 text-hub-like">
        <span className="motion-safe:animate-pulse inline-block h-2 w-2 rounded-full bg-hub-like" aria-hidden />
        <span data-voice-rec-time="">Запись {formatClock(seconds)}</span>
      </span>
      <button type="button" className="hub-record-btn" data-voice-stop="" aria-label="Стоп" onClick={onStop}>
        <IconStop size={24} strokeWidth={1.75} />
      </button>
    </div>
  )
}

export function VoiceComposerPreview({
  url,
  durationMs,
  onDelete,
  onSend,
  sending,
}: {
  url: string
  durationMs: number
  onDelete: () => void
  onSend: () => void
  sending?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [peaks, setPeaks] = useState<number[]>(() => Array.from({ length: BARS }, (_, i) => 0.35 + ((i * 5) % 8) / 16))

  useEffect(() => {
    let cancel = false
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => {
        if (cancel) return
        const data = audio.getChannelData(0)
        const step = Math.max(1, Math.floor(data.length / BARS))
        const next: number[] = []
        for (let i = 0; i < BARS; i++) {
          let max = 0
          for (let j = 0; j < step; j += 8) max = Math.max(max, Math.abs(data[i * step + j] || 0))
          next.push(max)
        }
        const top = Math.max(0.05, ...next)
        setPeaks(next.map((n) => Math.max(0.15, n / top)))
      })
      .catch(() => {})
      .finally(() => {
        void ctx.close()
      })
    return () => {
      cancel = true
    }
  }, [url])

  const dur = () => takeDurationSec(durationMs, audioRef.current)

  const seekTo = (clientX: number) => {
    const box = waveRef.current?.getBoundingClientRect()
    const a = audioRef.current
    if (!box || box.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    if (a) {
      try {
        a.currentTime = ratio * dur()
      } catch {
        /* metadata not ready */
      }
    }
    setProgress(ratio)
  }

  const shown = formatClock(playing || progress > 0 ? progress * dur() : durationMs / 1000)

  return (
    <div data-voice-preview="" data-duration-ms={Math.round(durationMs)} className="hub-take-preview">
      <audio
        ref={(el) => {
          audioRef.current = el
          if (el) primeMediaDuration(el)
        }}
        src={url}
        preload="auto"
        onTimeUpdate={() => {
          if (dragging.current) return
          const a = audioRef.current
          if (!a) return
          const d = dur()
          setProgress(d > 0 ? a.currentTime / d : 0)
        }}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="hub-take-controls">
      <button
        type="button"
        data-voice-play=""
        aria-label={playing ? 'Пауза' : 'Слушать'}
        className="hub-record-btn"
        onClick={() => {
          const a = audioRef.current
          if (!a) return
          if (a.paused) void a.play().catch(() => {})
          else a.pause()
        }}
      >
        {playing ? <IconPause size={24} strokeWidth={1.75} /> : <IconPlay size={24} strokeWidth={1.75} />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <input
          data-voice-seek=""
          className="hub-seek"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(progress * 1000)}
          aria-label="Перемотка голосового"
          onChange={(e) => {
            const ratio = Number(e.target.value) / 1000
            const a = audioRef.current
            if (a) {
              try {
                a.currentTime = ratio * dur()
              } catch {
                /* metadata not ready */
              }
            }
            setProgress(ratio)
          }}
        />
        <div
          ref={waveRef}
          data-voice-wave=""
          role="slider"
          aria-label="Перемотка"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="flex h-7 cursor-pointer touch-none items-end gap-[2px]"
          onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            dragging.current = true
            seekTo(e.clientX)
          }}
          onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
            if (!dragging.current) return
            seekTo(e.clientX)
          }}
          onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => {
            if (!dragging.current) return
            dragging.current = false
            seekTo(e.clientX)
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
        >
          {peaks.map((peak, i) => {
            const played = (i + 0.5) / BARS <= progress
            return (
              <span
                key={i}
                className={`w-[3px] rounded-full ${played ? 'bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_90%,transparent)]' : 'bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_35%,transparent)]'}`}
                style={{ height: Math.max(4, Math.round(peak * 24)) }}
              />
            )
          })}
        </div>
        <span data-voice-time="" className="text-[length:var(--hub-text-xs)] tabular-nums text-hub-muted">
          {shown}
        </span>
      </div>
      <button type="button" aria-label="Удалить" data-voice-delete="" className="hub-record-btn" onClick={onDelete}>
        <IconTrash size={24} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="Отправить"
        data-voice-send=""
        disabled={sending}
        className="hub-record-btn"
        onClick={onSend}
      >
        <IconPlane size={24} strokeWidth={1.75} />
      </button>
      </div>
    </div>
  )
}

export function useVoiceTake(onError: (message: string) => void) {
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const recRef = useRef<{
    rec: MediaRecorder
    stream: MediaStream
    stopped: Promise<Blob>
    clock: TakeClock
    mime: string
  } | null>(null)
  const draftRef = useRef<VoiceDraft | null>(null)
  const timerRef = useRef<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [draft, setDraft] = useState<VoiceDraft | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const discard = useCallback(() => {
    const cur = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (cur) URL.revokeObjectURL(cur.url)
  }, [])

  const stop = useCallback(async () => {
    const ctx = recRef.current
    if (!ctx) return
    recRef.current = null
    clearTimer()
    const durationMs = finiteTakeMs(ctx.clock.stop(), MAX_SEC * 1000)
    setRecording(false)
    setSeconds(0)
    let blob: Blob
    try {
      blob = await finishRecorder(ctx.rec, ctx.stopped)
    } catch {
      disableStream(ctx.stream)
      onErrorRef.current('Не удалось записать')
      return
    }
    disableStream(ctx.stream)
    try {
      const trimmed = await Promise.race([
        trimSilence(blob),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('trim')), 2000)
        }),
      ])
      blob = acceptTrimmedVoice(blob, trimmed, durationMs)
    } catch {
      /* iOS mp4/aac stays as recorded when the browser cannot decode it */
    }
    if (durationMs < MIN_TAKE_MS) {
      onErrorRef.current('Слишком коротко')
      return
    }
    if (blob.size < 32) {
      onErrorRef.current('Не удалось записать')
      return
    }
    try {
      const file = await buildMediaFile(blob, 'audio', ctx.mime || blob.type)
      const next = { url: URL.createObjectURL(blob), file, durationMs }
      if (draftRef.current) URL.revokeObjectURL(draftRef.current.url)
      draftRef.current = next
      setDraft(next)
    } catch {
      onErrorRef.current('Не удалось записать')
    }
  }, [])

  const start = useCallback(async () => {
    if (recRef.current) {
      await stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onErrorRef.current('Микрофон недоступен')
      return
    }
    try {
      const stream = await acquireAudio()
      const clock = createTakeClock(MAX_SEC * 1000)
      const { rec, mime, stopped } = recordStream(stream, 'audio')
      recRef.current = { rec, stream, stopped, clock, mime }
      setRecording(true)
      setSeconds(0)
      timerRef.current = window.setInterval(() => {
        const ms = clock.read()
        setSeconds(Math.floor(ms / 1000))
        if (ms >= MAX_SEC * 1000) void stop()
      }, 100)
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : 'Не удалось записать')
    }
  }, [stop])

  return { recording, seconds, draft, start, stop, discard }
}
