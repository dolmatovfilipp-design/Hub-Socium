import { useEffect, useRef, useState } from 'react'
import { releaseClip, sessionCamera, setSessionTorch } from '../lib/mediaSession'
import { extForMime, fileTypeForMime, videoNoteMime } from '../lib/recordMime'

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function seekFromPoint(video: HTMLVideoElement, clientX: number, clientY: number, el: HTMLElement) {
  if (!video.duration || !Number.isFinite(video.duration)) return
  const box = el.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  let angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2
  if (angle < 0) angle += Math.PI * 2
  video.currentTime = (angle / (Math.PI * 2)) * video.duration
}

export async function grabPoster(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return null
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const side = Math.min(width, height)
  ctx.drawImage(video, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 480, 480)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86))
}

/** Round video note: play, pause, ring scrub, time, tap to expand. */
export function VideoCirclePlayer({
  url,
  poster,
  durationMs,
}: {
  url: string
  poster?: string
  durationMs?: number
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const drag = useRef(false)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(0)
  const [dur, setDur] = useState((durationMs ?? 0) / 1000)

  const r = 74
  const c = 2 * Math.PI * r
  const size = expanded ? 'h-[min(86vw,420px)] w-[min(86vw,420px)]' : 'h-40 w-40'

  const sync = () => {
    const video = ref.current
    if (!video || !video.duration) return
    setProgress(video.currentTime / video.duration)
    setNow(video.currentTime)
    setDur(video.duration)
  }

  return (
    <div
      data-video-note=""
      className={expanded ? 'fixed inset-0 z-[80] flex items-center justify-center bg-black' : 'relative h-40 w-40'}
    >
      <div className={`relative ${size}`}>
        <video
          ref={ref}
          src={url}
          poster={poster}
          playsInline
          preload="metadata"
          className={`${size} rounded-full bg-[#1c1c1e] object-cover`}
          onTimeUpdate={sync}
          onLoadedMetadata={sync}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setProgress(1)
          }}
        />
        <svg className={`pointer-events-none absolute inset-0 ${size} -rotate-90`} viewBox="0 0 160 160" aria-hidden>
          <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="3" />
          <circle
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke="#e1e3e6"
            strokeWidth="3"
            strokeDasharray={`${c * progress} ${c}`}
            strokeLinecap="round"
          />
        </svg>
        <button
          type="button"
          data-video-note-play=""
          aria-label={playing ? 'Пауза' : 'Смотреть кружок'}
          className="absolute left-1/2 top-1/2 z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-[18px] text-white"
          onClick={(e) => {
            e.stopPropagation()
            const video = ref.current
            if (!video) return
            if (video.paused) void video.play()
            else video.pause()
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          aria-label={expanded ? 'Свернуть кружок' : 'Открыть кружок'}
          data-video-note-expand=""
          className="absolute inset-0 rounded-full"
          onPointerDown={(e) => {
            drag.current = false
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return
            drag.current = true
            const video = ref.current
            if (video) seekFromPoint(video, e.clientX, e.clientY, e.currentTarget)
          }}
          onPointerUp={() => {
            if (!drag.current) setExpanded((open) => !open)
          }}
        />
        <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] font-medium text-white drop-shadow">
          {formatClock(now)} / {formatClock(dur)}
        </p>
      </div>
    </div>
  )
}

type Shot = { file: File; durationMs: number; poster: Blob | null }

/** Live round camera. Tap or hold to record, then send. */
export function CircleStage({
  onClose,
  onSend,
}: {
  onClose: () => void
  onSend: (shot: Shot) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const started = useRef(0)
  const pressAt = useRef(0)
  const holding = useRef(false)
  const holdTimer = useRef<number | null>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [recording, setRecording] = useState(false)
  const [locked, setLocked] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [shot, setShot] = useState<Shot | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [torch, setTorch] = useState(false)

  const attach = async (nextFacing: 'user' | 'environment') => {
    releaseClip(streamRef.current)
    streamRef.current = null
    const stream = await sessionCamera(nextFacing, true)
    streamRef.current = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      await video.play().catch(() => {})
    }
  }

  useEffect(() => {
    let gone = false
    void attach(facing).catch((e) => {
      if (!gone) setError(e instanceof Error ? e.message : 'Камера недоступна')
    })
    return () => {
      gone = true
      const rec = recRef.current
      if (rec && rec.state === 'recording') rec.stop()
      releaseClip(streamRef.current)
      streamRef.current = null
    }
    // facing is applied by flip(), not by remounting the preview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finishRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => {
      const sec = Math.floor((Date.now() - started.current) / 1000)
      setSeconds(sec)
      if (sec >= 60) void finishRef.current()
    }, 250)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const begin = () => {
    if (recording || shot || !streamRef.current) return
    const mime = videoNoteMime()
    let rec: MediaRecorder
    try {
      rec = mime ? new MediaRecorder(streamRef.current, { mimeType: mime }) : new MediaRecorder(streamRef.current)
    } catch {
      setError('Запись кружка недоступна')
      return
    }
    chunks.current = []
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunks.current.push(ev.data)
    }
    rec.start(200)
    recRef.current = rec
    started.current = Date.now()
    setRecording(true)
    setSeconds(0)
    setError('')
  }

  const finish = async () => {
    const rec = recRef.current
    if (!rec || rec.state !== 'recording') return
    const poster = videoRef.current ? await grabPoster(videoRef.current) : null
    const mime = rec.mimeType || videoNoteMime() || 'video/mp4'
    const stopped = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks.current, { type: mime }))
    })
    try {
      rec.requestData()
    } catch {
      /* some engines flush only on stop */
    }
    rec.stop()
    const blob = await stopped
    recRef.current = null
    releaseClip(streamRef.current)
    streamRef.current = null
    setRecording(false)
    setLocked(false)
    const durationMs = Math.min(60000, Math.max(0, Date.now() - started.current))
    if (durationMs < 400 || blob.size < 800) {
      setError('Слишком коротко')
      return
    }
    const ext = extForMime(mime)
    const file = new File([blob], `circle.${ext === 'mp4' ? 'mp4' : ext}`, { type: fileTypeForMime(mime) })
    const url = URL.createObjectURL(blob)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    setShot({ file, durationMs, poster })
  }
  finishRef.current = finish

  const flip = () => {
    if (recording) return
    const next = facing === 'user' ? 'environment' : 'user'
    setFacing(next)
    setTorch(false)
    void attach(next).catch((e) => setError(e instanceof Error ? e.message : 'Камера недоступна'))
  }

  return (
    <div data-circle-stage="" className="absolute inset-0 z-40 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <button type="button" className="text-[15px] text-white" onClick={onClose} aria-label="Закрыть">
          Закрыть
        </button>
        <p className="text-[15px] font-medium tabular-nums text-white">{recording ? formatClock(seconds) : 'Кружок'}</p>
        <button type="button" data-circle-flip="" className="text-[15px] text-white" onClick={flip} disabled={recording} aria-label="Переключить камеру">
          Смена
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        {shot && previewUrl ? (
          <VideoCirclePlayer url={previewUrl} />
        ) : (
          <div className="relative h-[min(78vw,320px)] w-[min(78vw,320px)]">
            <video
              ref={videoRef}
              data-circle-preview=""
              playsInline
              muted
              autoPlay
              className="h-full w-full rounded-full bg-[#1c1c1e] object-cover"
              style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined}
            />
            <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 160 160" aria-hidden>
              <circle cx="80" cy="80" r="74" fill="none" stroke={recording ? '#ff453a' : 'rgba(255,255,255,0.35)'} strokeWidth="3" />
            </svg>
          </div>
        )}
        {error ? <p className="mt-4 px-6 text-center text-[13px] text-[#ff9b9b]">{error}</p> : null}
      </div>
      <div className="flex items-center justify-center gap-8 px-6 pb-8 pt-4">
        {shot ? (
          <>
            <button
              type="button"
              className="rounded-full bg-[#2c2c2e] px-5 py-2.5 text-[15px] text-white"
              onClick={() => {
                setShot(null)
                if (previewUrl) URL.revokeObjectURL(previewUrl)
                setPreviewUrl('')
                void attach(facing)
              }}
            >
              Заново
            </button>
            <button
              type="button"
              data-circle-send=""
              className="rounded-full bg-white px-5 py-2.5 text-[15px] font-semibold text-black"
              onClick={() => onSend(shot)}
            >
              Отправить
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-circle-cancel=""
              className="text-[15px] text-white"
              onClick={() => {
                if (recording) void finish()
                else onClose()
              }}
            >
              {recording ? 'Стоп' : 'Отмена'}
            </button>
            <button
              type="button"
              data-circle-record=""
              aria-label={recording ? 'Остановить кружок' : 'Запись кружка'}
              className={`h-16 w-16 rounded-full border-4 ${recording ? 'border-[#ff453a] bg-[#ff453a]' : 'border-white bg-white'}`}
              onPointerDown={() => {
                pressAt.current = Date.now()
                holding.current = false
                if (holdTimer.current) window.clearTimeout(holdTimer.current)
                if (recording) return
                holdTimer.current = window.setTimeout(() => {
                  holdTimer.current = null
                  if (recRef.current) return
                  holding.current = true
                  begin()
                }, 220)
              }}
              onPointerUp={() => {
                if (holdTimer.current) {
                  window.clearTimeout(holdTimer.current)
                  holdTimer.current = null
                }
                if (holding.current) {
                  holding.current = false
                  if (!locked) void finish()
                  return
                }
                if (Date.now() - pressAt.current < 280) {
                  if (recording) void finish()
                  else begin()
                }
              }}
            />
            <button
              type="button"
              data-circle-lock=""
              aria-label="Закрепить запись"
              className={`text-[15px] ${locked ? 'text-white' : 'text-[#8e8e93]'}`}
              onClick={() => {
                if (!recording) begin()
                setLocked(true)
              }}
            >
              {locked ? 'Закреплено' : 'Закрепить'}
            </button>
            <button
              type="button"
              className="sr-only"
              aria-label={torch ? 'Выключить вспышку' : 'Вспышка'}
              onClick={() => {
                void setSessionTorch(!torch).then((ok) => {
                  if (ok) setTorch((v) => !v)
                  else setError('Вспышка недоступна')
                })
              }}
            />
          </>
        )}
      </div>
    </div>
  )
}
