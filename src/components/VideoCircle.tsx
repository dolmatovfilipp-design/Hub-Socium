import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconPlane, IconTrash } from './Icons'
import { playbackMediaUrl } from './VoiceBubble'
import { formatClock } from '../lib/captureSession'

function overlayRoot(): HTMLElement {
  if (typeof document === 'undefined') return null as unknown as HTMLElement
  return document.getElementById('hub-overlay-root') || document.body
}

function knownDuration(video: HTMLVideoElement | null, fallbackMs: number): number {
  if (video && Number.isFinite(video.duration) && video.duration > 0 && video.duration !== Infinity) {
    return video.duration
  }
  return Math.max(0.1, (fallbackMs || 1000) / 1000)
}

function GlyphPlay() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.2v13.6l11.2-6.8z" fill="currentColor" />
    </svg>
  )
}

function GlyphPause() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  )
}

/** Round video note: play/pause, scrub ring, time, tap to expand. */
export function VideoCirclePlayer({
  url,
  poster,
  durationMs = 0,
  size = 160,
}: {
  url: string
  poster?: string
  durationMs?: number
  size?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const dragging = useRef(false)
  const scrubbed = useRef(false)
  const src = playbackMediaUrl(url)
  const posterSrc = poster ? playbackMediaUrl(poster) : ''
  const box = expanded ? 300 : size
  const r = 46
  const c = 2 * Math.PI * r

  useEffect(() => {
    setProgress(0)
    setPlaying(false)
    setFrameReady(false)
  }, [src])

  const ringHit = (clientX: number, clientY: number, el: Element) => {
    const rect = el.getBoundingClientRect()
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    const dist = Math.hypot(dx, dy)
    const outer = rect.width / 2
    return dist >= outer * 0.72 && dist <= outer + 8
  }

  const seek = (clientX: number, clientY: number, el: Element) => {
    const video = videoRef.current
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2
    if (angle < 0) angle += Math.PI * 2
    const ratio = Math.min(1, Math.max(0, angle / (Math.PI * 2)))
    if (video) {
      const dur = knownDuration(video, durationMs)
      try {
        video.currentTime = ratio * dur
      } catch {
        /* metadata not ready */
      }
    }
    setProgress(ratio)
  }

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }

  const shown = formatClock((playing || progress > 0 ? progress * knownDuration(videoRef.current, durationMs) : knownDuration(videoRef.current, durationMs)))

  const face = (
    <div
      data-circle-player=""
      data-circle-expanded={expanded ? 'true' : 'false'}
      className="relative shrink-0"
      style={{ width: box, height: box }}
      onClick={(e) => {
        if (scrubbed.current) {
          scrubbed.current = false
          return
        }
        const t = e.target as Element
        if (t.closest('[data-circle-play]')) return
        setExpanded((v) => !v)
      }}
    >
      <video
        ref={(el) => {
          videoRef.current = el
          if (el) el.setAttribute('webkit-playsinline', 'true')
        }}
        src={src}
        poster={posterSrc || undefined}
        playsInline
        preload="auto"
        className="h-full w-full rounded-full object-cover"
        style={{ opacity: frameReady || !posterSrc ? 1 : 0 }}
        onLoadedData={() => setFrameReady(true)}
        onPlaying={() => {
          setPlaying(true)
          setFrameReady(true)
        }}
        onTimeUpdate={() => {
          if (dragging.current) return
          const video = videoRef.current
          if (!video) return
          const dur = knownDuration(video, durationMs)
          setProgress(dur > 0 ? video.currentTime / dur : 0)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
        }}
      />
      {posterSrc && !frameReady ? (
        <img src={posterSrc} alt="" className="pointer-events-none absolute inset-0 h-full w-full rounded-full object-cover" />
      ) : null}
      <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeDasharray={`${c * progress} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <svg
        data-circle-control=""
        data-circle-scrub=""
        className="absolute inset-0 h-full w-full -rotate-90 touch-none"
        viewBox="0 0 100 100"
        role="slider"
        aria-label="Перемотка"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onPointerDown={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (!ringHit(e.clientX, e.clientY, e.currentTarget)) return
          e.stopPropagation()
          scrubbed.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          seek(e.clientX, e.clientY, e.currentTarget)
        }}
        onPointerMove={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (!dragging.current) return
          seek(e.clientX, e.clientY, e.currentTarget)
        }}
        onPointerUp={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (!dragging.current) return
          dragging.current = false
          seek(e.clientX, e.clientY, e.currentTarget)
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      >
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.01)" strokeWidth="16" style={{ pointerEvents: 'stroke' }} />
      </svg>
      <button
        type="button"
        data-circle-control=""
        data-circle-play=""
        aria-label={playing ? 'Пауза' : 'Смотреть кружок'}
        className="absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 text-white"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.7))' }}
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
      >
        {playing ? <GlyphPause /> : <GlyphPlay />}
      </button>
      <span
        data-circle-time=""
        className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[length:var(--hub-text-xs)] font-medium tabular-nums text-white"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,.85)' }}
      >
        {shown}
      </span>
    </div>
  )

  if (!expanded) return face
  return createPortal(
    <div
      data-circle-expanded=""
      className="pointer-events-auto absolute inset-0 z-[var(--hub-z-sheet)] flex items-center justify-center bg-hub-bg/90"
      onClick={() => setExpanded(false)}
    >
      <div onClick={(e) => e.stopPropagation()}>{face}</div>
    </div>,
    overlayRoot(),
  )
}

export function CircleDraftPreview({
  url,
  poster,
  durationMs,
  onSend,
  onDelete,
  sending,
}: {
  url: string
  poster?: string | null
  durationMs: number
  onSend: () => void
  onDelete: () => void
  sending?: boolean
}) {
  return (
    <div data-circle-preview="" className="flex items-center gap-2 px-3 py-2">
      <VideoCirclePlayer url={url} poster={poster || undefined} durationMs={durationMs} size={112} />
      <div className="ml-auto flex items-center">
        <button
          type="button"
          aria-label="Удалить"
          data-circle-delete=""
          className="hub-circle-btn"
          onClick={onDelete}
        >
          <IconTrash size={22} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          aria-label="Отправить"
          data-circle-send=""
          disabled={sending}
          className="hub-circle-btn disabled:opacity-40"
          onClick={onSend}
        >
          <IconPlane size={22} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  )
}
