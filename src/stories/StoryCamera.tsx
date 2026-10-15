import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  StoryCameraError,
  bindPreview,
  openStoryCamera,
  setStoryPreviewEnabled,
  setStoryTorch,
  storyCameraFacing,
  storyTorchAvailable,
  storyVideoExtension,
  storyVideoMime,
  type StoryFacing,
} from './cameraSession'
import { StoryIconClose, StoryIconFlash, StoryIconFlip, StoryIconImage } from './icons'

const HOLD_MS = 280
const MAX_MS = 15_000

export type StoryCapture = {
  kind: 'image' | 'video'
  file: File
  url: string
  mirrored: boolean
}

function fileKind(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  if (/\.(mp4|mov|m4v|webm)$/i.test(file.name)) return 'video'
  if (/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) return 'image'
  return null
}

export function StoryCamera({
  onClose,
  onCapture,
}: {
  onClose: () => void
  onCapture: (capture: StoryCapture) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const facingRef = useRef<StoryFacing>('user')
  const modeRef = useRef<'idle' | 'pending' | 'video'>('idle')
  const tokenRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const startedRef = useRef(0)
  const holdTimer = useRef(0)
  const hintTimer = useRef(0)
  const [facing, setFacing] = useState<StoryFacing>('user')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<StoryCameraError | null>(null)
  const [torch, setTorch] = useState<'hidden' | 'off' | 'on'>('hidden')
  const [recording, setRecording] = useState(false)
  const [progress, setProgress] = useState(0)
  const [hint, setHint] = useState('')

  const showHint = (text: string) => {
    setHint(text)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(''), 2200)
  }

  const attach = (nextFacing: StoryFacing) => {
    const video = videoRef.current
    if (!video) return
    void openStoryCamera(nextFacing).then(
      (opened) => {
        facingRef.current = opened.facing
        setFacing(opened.facing)
        setError(null)
        bindPreview(video, opened.stream)
        setStoryPreviewEnabled(true)
        setTorch(storyTorchAvailable(opened.stream) ? 'off' : 'hidden')
        setReady(true)
      },
      (err: unknown) => {
        setReady(false)
        setError(err instanceof StoryCameraError ? err : new StoryCameraError('Не удалось открыть камеру', 'failed'))
      },
    )
  }

  useEffect(() => {
    attach(storyCameraFacing())
    return () => {
      window.clearTimeout(holdTimer.current)
      window.clearTimeout(hintTimer.current)
      cancelAnimationFrame(rafRef.current)
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') rec.stop()
    }
    // The session is reused for the lifetime of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finishVideo = async () => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    const raw = rec.mimeType || storyVideoMime() || 'video/mp4'
    const ext = storyVideoExtension(raw)
    const type = ext === 'webm' ? 'video/webm' : 'video/mp4'
    try {
      const file = await new Promise<File>((resolve, reject) => {
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type })
          resolve(new File([blob], `story-${Date.now()}.${ext}`, { type }))
        }
        rec.onerror = () => reject(new Error('Не удалось записать видео'))
        try {
          rec.stop()
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Не удалось записать видео'))
        }
      })
      recorderRef.current = null
      setRecording(false)
      setProgress(0)
      modeRef.current = 'idle'
      if (!file.size) {
        showHint('Пустое видео')
        return
      }
      onCapture({
        kind: 'video',
        file,
        url: URL.createObjectURL(file),
        mirrored: facingRef.current === 'user',
      })
    } catch {
      recorderRef.current = null
      setRecording(false)
      setProgress(0)
      modeRef.current = 'idle'
      showHint('Не удалось записать видео')
    }
  }

  const tick = () => {
    const elapsed = performance.now() - startedRef.current
    const next = Math.min(1, elapsed / MAX_MS)
    setProgress(next)
    if (next >= 1) {
      void finishVideo()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const startVideo = (token: number) => {
    if (token !== tokenRef.current || modeRef.current !== 'pending') return
    const video = videoRef.current
    const live = video?.srcObject instanceof MediaStream ? video.srcObject : null
    if (!live || typeof MediaRecorder === 'undefined') {
      modeRef.current = 'idle'
      showHint('Видео недоступно в этом браузере')
      return
    }
    chunksRef.current = []
    const mime = storyVideoMime()
    let rec: MediaRecorder
    try {
      rec = mime ? new MediaRecorder(live, { mimeType: mime }) : new MediaRecorder(live)
    } catch {
      modeRef.current = 'idle'
      showHint('Не удалось начать запись')
      return
    }
    rec.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data)
    }
    try {
      rec.start()
    } catch {
      modeRef.current = 'idle'
      showHint('Не удалось начать запись')
      return
    }
    if (token !== tokenRef.current) {
      rec.stop()
      return
    }
    recorderRef.current = rec
    modeRef.current = 'video'
    startedRef.current = performance.now()
    setRecording(true)
    setProgress(0)
    rafRef.current = requestAnimationFrame(tick)
  }

  const takePhoto = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      showHint('Камера ещё не готова')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (facingRef.current === 'user') {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) {
      showHint('Не удалось сделать снимок')
      return
    }
    const file = new File([blob], `story-${Date.now()}.jpg`, { type: 'image/jpeg' })
    onCapture({ kind: 'image', file, url: URL.createObjectURL(file), mirrored: false })
  }

  const onShutterDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (error || recording) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const token = tokenRef.current + 1
    tokenRef.current = token
    modeRef.current = 'pending'
    holdTimer.current = window.setTimeout(() => startVideo(token), HOLD_MS)
  }

  const onShutterUp = () => {
    window.clearTimeout(holdTimer.current)
    if (modeRef.current === 'video') {
      cancelAnimationFrame(rafRef.current)
      void finishVideo()
      return
    }
    tokenRef.current += 1
    if (modeRef.current === 'pending') {
      modeRef.current = 'idle'
      void takePhoto()
    }
  }

  const flip = async () => {
    if (recording) return
    const next: StoryFacing = facingRef.current === 'user' ? 'environment' : 'user'
    const video = videoRef.current
    try {
      const opened = await openStoryCamera(next, true)
      facingRef.current = opened.facing
      setFacing(opened.facing)
      if (video) bindPreview(video, opened.stream)
      setTorch(storyTorchAvailable(opened.stream) ? 'off' : 'hidden')
      if (!opened.switched) showHint('Не удалось переключить камеру')
    } catch (err) {
      showHint(err instanceof Error ? err.message : 'Не удалось переключить камеру')
    }
  }

  const toggleTorch = async () => {
    const next = torch !== 'on'
    const ok = await setStoryTorch(next)
    if (!ok) {
      showHint('Вспышка недоступна')
      setTorch('hidden')
      return
    }
    setTorch(next ? 'on' : 'off')
  }

  const onGallery = (file: File | undefined) => {
    if (!file) return
    const kind = fileKind(file)
    if (!kind) {
      showHint('Нужно фото или видео')
      return
    }
    onCapture({ kind, file, url: URL.createObjectURL(file), mirrored: false })
  }

  return (
    <div
      data-testid="story-camera"
      data-facing={facing}
      data-torch={torch}
      className="fixed inset-0 z-[var(--hub-z-modal)] h-[100dvh] w-full touch-none select-none bg-black text-white"
    >
      <video
        ref={videoRef}
        data-testid="story-preview"
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
      />
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center" data-testid="story-camera-error">
          <p className="text-[20px] font-semibold">{error.message}</p>
          <p className="text-[14px] leading-snug text-[#a1a1a6]">
            {error.reason === 'denied'
              ? 'Доступ запрошен один раз. Откройте настройки браузера, если хотите включить камеру. Галерея по-прежнему доступна.'
              : 'Можно выбрать готовое фото или видео из галереи.'}
          </p>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
        <button
          type="button"
          aria-label="Закрыть"
          className="pointer-events-auto text-white"
          onClick={onClose}
        >
          <StoryIconClose />
        </button>
        {torch !== 'hidden' ? (
          <button
            type="button"
            aria-label={torch === 'on' ? 'Выключить вспышку' : 'Вспышка'}
            aria-pressed={torch === 'on'}
            className={`pointer-events-auto ${torch === 'on' ? 'text-white' : 'text-white/70'}`}
            onClick={() => void toggleTorch()}
          >
            <StoryIconFlash />
          </button>
        ) : (
          <span />
        )}
      </div>
      {hint ? (
        <p className="absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[13px] text-white backdrop-blur-xl">
          {hint}
        </p>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between px-8 pb-[max(28px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          aria-label="Галерея"
          data-testid="story-gallery"
          className="mb-3 text-white"
          onClick={() => galleryRef.current?.click()}
        >
          <StoryIconImage />
        </button>
        <div className="flex flex-col items-center gap-3">
          {!recording && !error ? (
            <p className="text-[12px] text-white/80">Удерживайте для видео</p>
          ) : null}
          {recording ? (
            <p className="text-[12px] tabular-nums text-white">{Math.round(progress * 15)} с</p>
          ) : null}
          <button
            type="button"
            data-testid="story-shutter"
            data-recording={recording ? 'true' : 'false'}
            data-progress={progress.toFixed(3)}
            aria-label="Снять"
            disabled={!!error || !ready}
            className="relative h-[76px] w-[76px] disabled:opacity-40"
            onPointerDown={onShutterDown}
            onPointerUp={onShutterUp}
            onPointerCancel={onShutterUp}
            onContextMenu={(event) => event.preventDefault()}
          >
            <svg viewBox="0 0 76 76" className="absolute inset-0 h-full w-full">
              <circle cx="38" cy="38" r="34" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" />
              <circle
                cx="38"
                cy="38"
                r="34"
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={(2 * Math.PI * 34) * (1 - progress)}
                transform="rotate(-90 38 38)"
              />
            </svg>
            <span
              className={`absolute left-1/2 top-1/2 bg-white ${recording ? 'h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-[5px]' : 'h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full'}`}
            />
          </button>
        </div>
        <button
          type="button"
          aria-label="Переключить камеру"
          className="mb-3 text-white disabled:opacity-40"
          disabled={!!error || recording}
          onClick={() => void flip()}
        >
          <StoryIconFlip />
        </button>
      </div>
      <input
        ref={galleryRef}
        data-testid="story-gallery-input"
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => {
          onGallery(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
