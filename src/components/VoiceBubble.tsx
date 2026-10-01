import { useRef, useState } from 'react'

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
  return (
    <div className={`flex items-center gap-2 py-1 ${className}`}>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white"
        aria-label={playing ? 'Пауза' : 'Слушать'}
        onClick={() => {
          if (!audioRef.current) audioRef.current = new Audio(url)
          const a = audioRef.current
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
                className="w-[3px] rounded-full bg-white/45"
                style={{ height: h }}
              />
            )
          })}
        </div>
        <span className="text-[12px] text-white/80">Голосовое · {sec}с</span>
      </div>
    </div>
  )
}

/** Encode / decode voice reply payload in comment body (MVP, no schema change). */
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
