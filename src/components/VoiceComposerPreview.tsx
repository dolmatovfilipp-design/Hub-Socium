import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IconPlane, IconTrash } from './Icons'
import { trimSilence } from '../lib/audioTrim'
import {
  acquireAudio,
  buildMediaFile,
  disableStream,
  finishRecorder,
  formatClock,
  recordStream,
} from '../lib/captureSession'

const MAX_SEC = 120
const BARS = 32

export type VoiceDraft = {
  url: string
  file: File
  durationMs: number
}

function GlyphPlay() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.2v13.6l11.2-6.8z" fill="currentColor" />
    </svg>
  )
}

function GlyphPause() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
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

  const dur = () => {
    const a = audioRef.current
    if (a && Number.isFinite(a.duration) && a.duration > 0 && a.duration !== Infinity) return a.duration
    return Math.max(0.1, durationMs / 1000)
  }

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
    <div data-voice-preview="" className="flex items-center gap-2 px-3 py-2 text-white">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
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
      <button
        type="button"
        data-voice-play=""
        aria-label={playing ? 'Пауза' : 'Слушать'}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center"
        onClick={() => {
          const a = audioRef.current
          if (!a) return
          if (a.paused) void a.play().catch(() => {})
          else a.pause()
        }}
      >
        {playing ? <GlyphPause /> : <GlyphPlay />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
                className={`w-[3px] rounded-full ${played ? 'bg-white' : 'bg-white/35'}`}
                style={{ height: Math.max(4, Math.round(peak * 24)) }}
              />
            )
          })}
        </div>
        <span data-voice-time="" className="text-[12px] tabular-nums text-[#8e8e93]">
          {shown}
        </span>
      </div>
      <button type="button" aria-label="Удалить" data-voice-delete="" className="inline-flex h-11 w-11 shrink-0 items-center justify-center" onClick={onDelete}>
        <IconTrash size={22} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        aria-label="Отправить"
        data-voice-send=""
        disabled={sending}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40"
        onClick={onSend}
      >
        <IconPlane size={22} strokeWidth={1.6} />
      </button>
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
    started: number
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
    let durationMs = Math.min(MAX_SEC * 1000, Date.now() - ctx.started)
    try {
      const trimmed = await Promise.race([
        trimSilence(blob),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('trim')), 2000)
        }),
      ])
      blob = trimmed.blob
      durationMs = Math.min(MAX_SEC * 1000, trimmed.durationMs)
    } catch {
      /* iOS mp4/aac stays as recorded when the browser cannot decode it */
    }
    if (durationMs < 400 || blob.size < 32) {
      onErrorRef.current('Слишком коротко')
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
      const startedAt = Date.now()
      const { rec, mime, stopped } = recordStream(stream, 'audio')
      recRef.current = { rec, stream, stopped, started: startedAt, mime }
      setRecording(true)
      setSeconds(0)
      timerRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - startedAt) / 1000)
        setSeconds(sec)
        if (sec >= MAX_SEC) void stop()
      }, 250)
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : 'Не удалось записать')
    }
  }, [stop])

  return { recording, seconds, draft, start, stop, discard }
}
