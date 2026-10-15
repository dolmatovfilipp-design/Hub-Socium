import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose, IconLock } from './Icons'
import {
  acquireCamera,
  buildMediaFile,
  capturePoster,
  disableStream,
  finishRecorder,
  formatClock,
  noteCameraFacing,
  recordStream,
  type Facing,
} from '../lib/captureSession'

const MAX_SEC = 60
const HOLD_MS = 280
const LOCK_DY = -64
const CANCEL_DX = -72

export type CircleDraft = {
  url: string
  file: File
  durationMs: number
  posterUrl: string | null
  posterFile: File | null
}

type Session = {
  pointerId: number
  x: number
  y: number
  downAt: number
  intent: 'hold' | 'lock' | 'stop' | 'cancel'
  pointerDown: boolean
  ready: boolean
  rec: MediaRecorder | null
  stopped: Promise<Blob> | null
  stream: MediaStream
  facing: Facing
  mime: string
  startedAt: number
  token: number
}

function overlayRoot(): HTMLElement {
  return document.getElementById('hub-overlay-root') || document.body
}

function GlyphFlip() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 7.5h1.8l.9-1.5h2.6L14.2 7.5H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 17.5H8A1.5 1.5 0 0 1 6.5 16V9A1.5 1.5 0 0 1 8 7.5z" />
      <path d="M9.2 12.2 12 9.8l2.8 2.4" />
      <path d="M12 10.2v4.2" />
    </svg>
  )
}

function GlyphStop() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  )
}

function CircleStage({
  stream,
  seconds,
  locked,
  facing,
  videoRef,
  onFlip,
  onLock,
  onCancel,
  onStop,
}: {
  stream: MediaStream
  seconds: number
  locked: boolean
  facing: Facing
  videoRef: { current: HTMLVideoElement | null }
  onFlip: () => void
  onLock: () => void
  onCancel: () => void
  onStop: () => void
}) {
  const ratio = Math.min(1, seconds / MAX_SEC)
  const r = 46
  const c = 2 * Math.PI * r
  return createPortal(
    <div
      data-circle-recorder=""
      className="pointer-events-auto absolute inset-0 z-[var(--hub-z-sheet)] flex flex-col items-center justify-center bg-black/85"
    >
      <p data-circle-timer="" className="mb-4 text-[22px] font-medium tabular-nums text-white">
        <span className="mr-2 text-[#ff453a]">●</span>
        {formatClock(seconds)}
      </p>
      <div className="relative h-64 w-64">
        <div className="h-64 w-64 overflow-hidden rounded-full bg-[#1c1c1e]">
          <video
            ref={(el) => {
              videoRef.current = el
              if (!el) return
              el.setAttribute('webkit-playsinline', 'true')
              if (el.srcObject !== stream) el.srcObject = stream
              el.muted = true
              void el.play().catch(() => {})
            }}
            data-circle-live=""
            data-facing={facing}
            playsInline
            autoPlay
            muted
            className="h-full w-full object-cover"
            style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
          />
        </div>
        <svg className="pointer-events-none absolute inset-0 h-64 w-64 -rotate-90" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeDasharray={`${c * ratio} ${c}`}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-6 flex items-center gap-7 text-white">
        <button type="button" aria-label="Отмена" data-circle-cancel="" className="inline-flex h-11 w-11 items-center justify-center" onClick={onCancel}>
          <IconClose size={26} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          aria-label={locked ? 'Закреплено' : 'Закрепить'}
          aria-pressed={locked}
          data-circle-lock=""
          className="inline-flex h-11 w-11 items-center justify-center"
          style={{ color: locked ? '#ff453a' : '#fff' }}
          onClick={onLock}
        >
          <IconLock size={26} strokeWidth={1.6} />
        </button>
        <button type="button" aria-label="Переключить камеру" data-circle-flip="" className="inline-flex h-11 w-11 items-center justify-center" onClick={onFlip}>
          <GlyphFlip />
        </button>
        <button type="button" aria-label="Стоп" data-circle-stop="" className="inline-flex h-11 w-11 items-center justify-center" onClick={onStop}>
          <GlyphStop />
        </button>
      </div>
      <p className="mt-4 px-6 text-center text-[13px] text-[#8e8e93]">
        {locked ? 'Запись идёт' : 'Вверх — закрепить, влево — отмена'}
      </p>
    </div>,
    overlayRoot(),
  )
}

export function useCircleTake(onError: (message: string) => void) {
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const draftRef = useRef<CircleDraft | null>(null)
  const timerRef = useRef<number | null>(null)
  const tokenRef = useRef(0)
  const finishing = useRef(false)
  const [phase, setPhase] = useState<'idle' | 'recording'>('idle')
  const [locked, setLocked] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [facing, setFacing] = useState<Facing>('user')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [draft, setDraft] = useState<CircleDraft | null>(null)

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
    if (!cur) return
    URL.revokeObjectURL(cur.url)
    if (cur.posterUrl) URL.revokeObjectURL(cur.posterUrl)
  }, [])

  const endSession = useCallback((mode: 'stop' | 'cancel') => {
    const run = async () => {
      const s = sessionRef.current
      if (!s || finishing.current) return
      finishing.current = true
      clearTimer()
      sessionRef.current = null
      const token = s.token
      let blob: Blob | null = null
      let poster: Blob | null = null
      if (mode === 'stop') {
        poster = await capturePoster(videoRef.current)
      }
      if (s.rec && s.stopped) {
        try {
          blob = await finishRecorder(s.rec, s.stopped)
        } catch {
          blob = null
        }
      }
      disableStream(s.stream)
      if (tokenRef.current !== token) {
        finishing.current = false
        return
      }
      setPhase('idle')
      setLocked(false)
      setStream(null)
      setSeconds(0)
      finishing.current = false
      if (mode === 'cancel') return
      const durationMs = Math.min(MAX_SEC * 1000, Math.max(0, Date.now() - s.startedAt))
      if (!blob || blob.size < 32 || durationMs < 400) {
        onErrorRef.current('Слишком коротко')
        return
      }
      try {
        const file = await buildMediaFile(blob, 'video', s.mime || blob.type)
        const posterFile = poster ? new File([poster], 'circle-poster.jpg', { type: 'image/jpeg' }) : null
        const next: CircleDraft = {
          url: URL.createObjectURL(blob),
          file,
          durationMs,
          posterUrl: poster ? URL.createObjectURL(poster) : null,
          posterFile,
        }
        if (draftRef.current) {
          URL.revokeObjectURL(draftRef.current.url)
          if (draftRef.current.posterUrl) URL.revokeObjectURL(draftRef.current.posterUrl)
        }
        draftRef.current = next
        setDraft(next)
      } catch {
        onErrorRef.current('Не удалось записать кружок')
      }
    }
    void run()
  }, [])

  const armTimer = (startedAt: number) => {
    clearTimer()
    timerRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000)
      setSeconds(sec)
      if (sec >= MAX_SEC) endSession('stop')
    }, 200)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (sessionRef.current || finishing.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      onErrorRef.current('Камера недоступна')
      return
    }
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the button can unmount when the overlay opens */
    }
    const token = ++tokenRef.current
    const pending: Session = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      downAt: Date.now(),
      intent: 'hold',
      pointerDown: true,
      ready: false,
      rec: null,
      stopped: null,
      stream: new MediaStream(),
      facing: 'user',
      mime: '',
      startedAt: Date.now(),
      token,
    }
    sessionRef.current = pending
    const open = acquireCamera('user')
    void open
      .then((cam) => {
        const s = sessionRef.current
        if (!s || s.token !== token) {
          disableStream(cam)
          return
        }
        if (s.intent === 'cancel') {
          disableStream(cam)
          sessionRef.current = null
          return
        }
        let started: ReturnType<typeof recordStream>
        try {
          started = recordStream(cam, 'video')
        } catch {
          disableStream(cam)
          sessionRef.current = null
          onErrorRef.current('Запись недоступна')
          return
        }
        s.stream = cam
        s.rec = started.rec
        s.stopped = started.stopped
        s.mime = started.mime
        s.startedAt = Date.now()
        s.ready = true
        s.facing = 'user'
        setFacing('user')
        setStream(cam)
        setPhase('recording')
        setLocked(s.intent === 'lock')
        setSeconds(0)
        armTimer(s.startedAt)
        if (s.intent === 'stop') endSession('stop')
      })
      .catch((err: unknown) => {
        if (sessionRef.current?.token === token) sessionRef.current = null
        onErrorRef.current(err instanceof Error ? err.message : 'Камера недоступна')
      })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = sessionRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (dx <= CANCEL_DX) {
      s.intent = 'cancel'
      if (s.ready) endSession('cancel')
      return
    }
    if (dy <= LOCK_DY) {
      s.intent = 'lock'
      setLocked(true)
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = sessionRef.current
    if (!s || s.pointerId !== e.pointerId) return
    s.pointerDown = false
    if (s.intent === 'cancel') {
      if (s.ready) endSession('cancel')
      return
    }
    // A permission sheet steals the finger before the preview exists.
    // Treat that release as a locked take. Hold-to-stop only applies once
    // the round preview is already on screen.
    if (!s.ready) {
      s.intent = 'lock'
      return
    }
    const quick = Date.now() - s.downAt < HOLD_MS
    if (s.intent === 'lock' || quick) {
      s.intent = 'lock'
      setLocked(true)
      return
    }
    endSession('stop')
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerUp(e)
  }

  const lock = () => {
    const s = sessionRef.current
    if (!s) return
    s.intent = 'lock'
    setLocked(true)
  }

  const flip = () => {
    const s = sessionRef.current
    if (!s?.ready) return
    const video = s.stream.getVideoTracks()[0]
    if (!video) {
      onErrorRef.current('Не удалось переключить камеру')
      return
    }
    const next: Facing = s.facing === 'user' ? 'environment' : 'user'
    void video
      .applyConstraints({ facingMode: next, width: { ideal: 720 }, height: { ideal: 720 } })
      .then(() => {
        const cur = sessionRef.current
        if (!cur || cur.token !== s.token) return
        const after = video.getSettings().facingMode
        if (after !== 'user' && after !== 'environment') {
          onErrorRef.current('Только одна камера')
          return
        }
        if (after === cur.facing) {
          onErrorRef.current('Только одна камера')
          return
        }
        cur.facing = after
        noteCameraFacing(cur.stream, after)
        setFacing(after)
      })
      .catch(() => onErrorRef.current('Не удалось переключить камеру'))
  }

  const overlay: ReactNode =
    phase === 'recording' && stream ? (
      <CircleStage
        stream={stream}
        seconds={seconds}
        locked={locked}
        facing={facing}
        videoRef={videoRef}
        onFlip={flip}
        onLock={lock}
        onCancel={() => endSession('cancel')}
        onStop={() => endSession('stop')}
      />
    ) : null

  return {
    recording: phase === 'recording',
    locked,
    draft,
    discard,
    overlay,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
