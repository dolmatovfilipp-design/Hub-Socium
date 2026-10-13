import { useRef, useState } from 'react'
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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sec = Math.max(1, Math.round(durationMs / 1000))
  const src = playbackMediaUrl(url)
  return (
    <div className={`flex items-center gap-2 py-1 ${className}`}>
      <audio ref={audioRef} src={src} preload="none" />
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_15%,transparent)] text-hub-text"
        aria-label={playing ? 'Пауза' : 'Слушать'}
        onClick={() => {
          const a = audioRef.current
          if (!a) return
          if (playing) {
            a.pause()
            setPlaying(false)
          } else {
            void a.play()
            setPlaying(true)
            a.onended = () => setPlaying(false)
          }
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 items-end gap-[2px]" aria-hidden>
          {Array.from({ length: 18 }, (_, i) => {
            const h = 4 + ((i * 7 + sec) % 12)
            return (
              <span
                key={i}
                className="w-[3px] rounded-full bg-[color-mix(in_srgb,var(--hub-app-text,#fff)_45%,transparent)]"
                style={{ height: h }}
              />
            )
          })}
        </div>
        <span className="text-[12px] text-hub-muted">Голосовое · {sec}с</span>
      </div>
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
