import { useEffect, useRef, useState } from 'react'
import { apiBaseUrl } from '../lib/api'

/** Resolve relative /v1/media/... against API origin (same-origin proxy → ''). */
export function resolveMediaUrl(url: string): string {
  if (!url) return url
  if (url.startsWith('blob:') || url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) return `${apiBaseUrl()}${url}`
  return url
}

const MEDIA_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Play voice through the API. Older messages store a Selectel URL; fetching that
 * from script is blocked by bucket CORS. Rewrite off-origin URLs that contain the
 * media id to /v1/media/{id}, which streams the object (Range via ServeContent).
 *
 * If a client still hits the bucket directly, the bucket needs:
 * AllowedOrigins = the site origin, AllowedMethods = GET, HEAD,
 * AllowedHeaders = Range, ExposeHeaders = Content-Range, Accept-Ranges, Content-Length.
 */
export function playbackMediaUrl(url: string): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url
  const onApi = url.match(/\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  if (onApi) return resolveMediaUrl(`/v1/media/${onApi[1]}`)
  if (/^https?:\/\//i.test(url)) {
    const id = url.match(MEDIA_UUID)
    let sameOrigin = false
    try {
      const base = apiBaseUrl()
      const apiOrigin = base
        ? new URL(base, typeof window !== 'undefined' ? window.location.href : base).origin
        : (typeof window !== 'undefined' ? window.location.origin : '')
      sameOrigin = !!apiOrigin && new URL(url).origin === apiOrigin
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin && id) return resolveMediaUrl(`/v1/media/${id[0]}`)
  }
  return resolveMediaUrl(url)
}

const RATES = [1, 1.25, 1.5, 2] as const
const RATE_KEY = 'hub-voice-rate'
const BARS = 28

function loadRate(): number {
  try {
    const n = Number(localStorage.getItem(RATE_KEY))
    if ((RATES as readonly number[]).includes(n)) return n
  } catch {
    /* ignore */
  }
  return 1
}

function rateLabel(rate: number): string {
  if (rate === 1) return 'x1'
  if (rate === 1.25) return 'x1.25'
  if (rate === 1.5) return 'x1.5'
  return 'x2'
}

function knownDuration(audio: HTMLAudioElement | null, fallbackMs: number): number {
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration !== Infinity) {
    return audio.duration
  }
  return Math.max(0.1, (fallbackMs || 1000) / 1000)
}

/** Compact voice player (shared by Chat-style replies and post thread). */
export function VoiceBubble({
  url,
  durationMs,
  className = '',
}: {
  url: string
  durationMs: number
  className?: string
}) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [rate, setRate] = useState(loadRate)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const sec = Math.max(1, Math.round(durationMs / 1000))
  const src = playbackMediaUrl(url)

  useEffect(() => {
    const a = audioRef.current
    if (a) a.playbackRate = rate
  }, [rate, src])

  useEffect(() => {
    const sync = () => setRate(loadRate())
    window.addEventListener('storage', sync)
    window.addEventListener('hub-voice-rate', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('hub-voice-rate', sync)
    }
  }, [])

  const seekTo = (clientX: number) => {
    const box = waveRef.current?.getBoundingClientRect()
    const a = audioRef.current
    if (!box || box.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    if (a) {
      const dur = knownDuration(a, durationMs)
      try {
        a.currentTime = ratio * dur
      } catch {
        /* metadata not ready yet */
      }
    }
    setProgress(ratio)
  }

  const cycleRate = () => {
    const idx = RATES.indexOf(rate as (typeof RATES)[number])
    const next = RATES[(idx + 1) % RATES.length] ?? 1
    setRate(next)
    try {
      localStorage.setItem(RATE_KEY, String(next))
    } catch {
      /* ignore */
    }
    const a = audioRef.current
    if (a) a.playbackRate = next
    window.dispatchEvent(new Event('hub-voice-rate'))
  }

  const shown = playing || progress > 0
    ? `${Math.max(0, Math.round(progress * knownDuration(audioRef.current, durationMs)))}с`
    : `${sec}с`

  return (
    <div className={`flex items-center gap-2 py-1 ${className}`} data-voice-player="">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => {
          if (dragging.current) return
          const a = audioRef.current
          if (!a) return
          const dur = knownDuration(a, durationMs)
          setProgress(dur > 0 ? a.currentTime / dur : 0)
        }}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
        }}
      />
      <button
        type="button"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_15%,transparent)] text-hub-text"
        aria-label={playing ? 'Пауза' : 'Слушать'}
        onClick={(e) => {
          e.stopPropagation()
          const a = audioRef.current
          if (!a) return
          a.playbackRate = rate
          if (playing) {
            a.pause()
            setPlaying(false)
          } else {
            void a.play()
            setPlaying(true)
          }
        }}
      >
        {playing ? '❚❚' : '▶'}
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
          tabIndex={0}
          className="flex h-6 cursor-pointer touch-none items-end gap-[2px]"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            dragging.current = true
            seekTo(e.clientX)
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return
            seekTo(e.clientX)
          }}
          onPointerUp={(e) => {
            if (!dragging.current) return
            dragging.current = false
            seekTo(e.clientX)
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
        >
          {Array.from({ length: BARS }, (_, i) => {
            const h = 4 + ((i * 7 + sec) % 14)
            const played = (i + 0.5) / BARS <= progress
            return (
              <span
                key={i}
                className={`w-[3px] rounded-full ${played ? 'bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_90%,transparent)]' : 'bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_35%,transparent)]'}`}
                style={{ height: h }}
              />
            )
          })}
        </div>
        <span className="text-[12px] text-hub-muted">Голосовое · {shown}</span>
      </div>
      <button
        type="button"
        data-voice-rate=""
        aria-label={`Скорость ${rateLabel(rate)}`}
        className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_12%,transparent)] px-2 py-1 text-[11px] font-semibold tabular-nums text-hub-text"
        onClick={(e) => {
          e.stopPropagation()
          cycleRate()
        }}
      >
        {rateLabel(rate)}
      </button>
    </div>
  )
}

/** Encode / decode voice reply payload in comment body (MVP, durable /v1/media/{id}). */
export const VOICE_REPLY_PREFIX = '__hub_voice__:'

export function encodeVoiceReply(url: string, durationMs: number): string {
  return `${VOICE_REPLY_PREFIX}${url}|${Math.round(durationMs)}`
}

export function parseVoiceReply(
  text: string,
): { url: string; durationMs: number } | null {
  if (!text.startsWith(VOICE_REPLY_PREFIX)) return null
  const rest = text.slice(VOICE_REPLY_PREFIX.length)
  const pipe = rest.lastIndexOf('|')
  if (pipe <= 0) return null
  const url = rest.slice(0, pipe)
  const durationMs = Number(rest.slice(pipe + 1))
  if (!url || !Number.isFinite(durationMs) || durationMs <= 0) return null
  return { url, durationMs }
}
