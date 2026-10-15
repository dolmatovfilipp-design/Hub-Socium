import { useEffect, useRef, useState } from 'react'
import { IconImage, IconMusic } from './Icons'
import { releaseClip, sessionCamera, setSessionTorch } from '../lib/mediaSession'
import { extForMime, fileTypeForMime, videoNoteMime } from '../lib/recordMime'

const FILTERS = [
  ['', 'Нет'],
  ['warm', 'Тёплый'],
  ['cool', 'Холодный'],
  ['mono', 'Ч/б'],
  ['fade', 'Выцветший'],
] as const

export const storyFilterCss: Record<string, string> = {
  warm: 'sepia(0.35) saturate(1.25)',
  cool: 'saturate(0.85) hue-rotate(18deg)',
  mono: 'grayscale(1)',
  fade: 'contrast(0.92) saturate(0.75) brightness(1.05)',
}

export type StoryShot = {
  file: File
  kind: 'image' | 'video'
  text: string
  filterId: string
  place: string
  song: File | null
  closeFriends: boolean
}

function photoFile(video: HTMLVideoElement, mirror: boolean): Promise<File | null> {
  const width = video.videoWidth || 720
  const height = video.videoHeight || 1280
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  if (mirror) {
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
  }
  try {
    ctx.drawImage(video, 0, 0, width, height)
  } catch {
    ctx.fillStyle = '#1c1c1e'
    ctx.fillRect(0, 0, width, height)
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) resolve(null)
      else resolve(new File([blob], 'story.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  })
}

/** Full-screen story camera, then an editor on the captured frame. */
export function StoryCamera({
  onClose,
  onPublish,
  publishing,
}: {
  onClose: () => void
  onPublish: (shot: StoryShot) => void
  publishing?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const holdTimer = useRef<number | null>(null)
  const holding = useRef(false)
  const galleryRef = useRef<HTMLInputElement>(null)
  const songRef = useRef<HTMLInputElement>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [torch, setTorch] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<'image' | 'video'>('image')
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('')
  const [filterId, setFilterId] = useState('')
  const [place, setPlace] = useState('')
  const [song, setSong] = useState<File | null>(null)
  const [closeFriends, setCloseFriends] = useState(false)

  const attach = async (next: 'user' | 'environment', withAudio: boolean) => {
    releaseClip(streamRef.current)
    const stream = await sessionCamera(next, withAudio)
    streamRef.current = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      await video.play().catch(() => {})
    }
  }

  useEffect(() => {
    let gone = false
    void attach('user', true).catch((e) => {
      if (!gone) setError(e instanceof Error ? e.message : 'Камера недоступна')
    })
    return () => {
      gone = true
      if (holdTimer.current) window.clearTimeout(holdTimer.current)
      const rec = recRef.current
      if (rec && rec.state === 'recording') rec.stop()
      releaseClip(streamRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const openEditor = (next: File, nextKind: 'image' | 'video') => {
    setFile(next)
    setKind(nextKind)
    setPreview(URL.createObjectURL(next))
    releaseClip(streamRef.current)
    streamRef.current = null
  }

  const takePhoto = async () => {
    const video = videoRef.current
    if (!video) return
    const shot = await photoFile(video, facing === 'user')
    if (!shot) {
      setError('Не удалось снять кадр')
      return
    }
    openEditor(shot, 'image')
  }

  const startVideo = async () => {
    if (recRef.current || !videoRef.current) return
    try {
      await attach(facing, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Камера недоступна')
      return
    }
    const mime = videoNoteMime()
    let rec: MediaRecorder
    try {
      rec = mime && streamRef.current
        ? new MediaRecorder(streamRef.current, { mimeType: mime })
        : new MediaRecorder(streamRef.current!)
    } catch {
      setError('Видео недоступно')
      return
    }
    chunks.current = []
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunks.current.push(ev.data)
    }
    rec.start(200)
    recRef.current = rec
    setRecording(true)
  }

  const stopVideo = async () => {
    const rec = recRef.current
    if (!rec || rec.state !== 'recording') return
    const mime = rec.mimeType || videoNoteMime() || 'video/mp4'
    const stopped = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks.current, { type: mime }))
    })
    try {
      rec.requestData()
    } catch {
      /* flush on stop */
    }
    rec.stop()
    const blob = await stopped
    recRef.current = null
    setRecording(false)
    if (blob.size < 800) {
      setError('Слишком коротко')
      return
    }
    const ext = extForMime(mime)
    openEditor(new File([blob], `story.${ext === 'mp4' ? 'mp4' : ext}`, { type: fileTypeForMime(mime) }), 'video')
  }

  const filter = storyFilterCss[filterId] || undefined

  if (file && preview) {
    return (
      <div data-story-editor="" className="fixed inset-0 z-[var(--hub-z-modal)] flex flex-col bg-black">
        {kind === 'video' ? (
          <video src={preview} className="absolute inset-0 h-full w-full object-cover" style={{ filter }} autoPlay muted loop playsInline />
        ) : (
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter }} />
        )}
        <div className="relative z-10 flex flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pt-3">
            <button type="button" className="text-[15px] text-white" onClick={() => { setFile(null); setPreview(''); void attach(facing, true) }}>
              Заново
            </button>
            <button
              type="button"
              data-story-audience=""
              className={`rounded-full px-3 py-1 text-[13px] ${closeFriends ? 'bg-white text-black' : 'bg-black/40 text-white'}`}
              onClick={() => setCloseFriends((v) => !v)}
            >
              {closeFriends ? 'Близким' : 'Всем'}
            </button>
          </div>
          <textarea
            data-story-text=""
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 300))}
            placeholder="Текст"
            rows={3}
            className="mx-8 mt-[18vh] resize-none bg-transparent text-center text-[28px] font-semibold leading-snug text-white outline-none placeholder:text-white/70"
          />
          <div className="mt-auto bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(16px,var(--hub-safe-bottom))] pt-10">
            <div className="mb-3 flex gap-2 overflow-x-auto">
              {FILTERS.map(([id, label]) => (
                <button
                  key={label}
                  type="button"
                  data-story-filter={id || 'none'}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] ${filterId === id ? 'bg-white text-black' : 'bg-white/15 text-white'}`}
                  onClick={() => setFilterId(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value.slice(0, 80))}
              placeholder="Место"
              data-story-place=""
              className="mb-3 w-full rounded-2xl bg-black/40 px-3.5 py-2.5 text-[15px] text-white outline-none placeholder:text-white/60"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-story-song=""
                className="flex items-center gap-2 rounded-2xl bg-black/40 px-3 py-2.5 text-[14px] text-white"
                onClick={() => songRef.current?.click()}
              >
                <IconMusic size={18} strokeWidth={1.6} />
                {song ? song.name : 'Песня'}
              </button>
              <button
                type="button"
                data-story-publish=""
                disabled={publishing}
                className="ml-auto rounded-full bg-white px-5 py-2.5 text-[15px] font-semibold text-black disabled:opacity-60"
                onClick={() => file && onPublish({ file, kind, text: text.trim(), filterId, place: place.trim(), song, closeFriends })}
              >
                {publishing ? 'Публикация…' : 'Опубликовать'}
              </button>
            </div>
            <input
              ref={songRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                setSong(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-story-camera="" className="fixed inset-0 z-[var(--hub-z-modal)] flex flex-col bg-black">
      <video
        ref={videoRef}
        data-story-preview=""
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
        style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined}
      />
      <div className="relative z-10 flex items-center justify-between px-4 pt-3">
        <button type="button" className="text-[15px] text-white" onClick={onClose} aria-label="Закрыть">
          Закрыть
        </button>
        <button
          type="button"
          data-story-flash=""
          className="text-[15px] text-white"
          aria-label={torch ? 'Выключить вспышку' : 'Вспышка'}
          onClick={() => {
            void setSessionTorch(!torch).then((ok) => {
              if (ok) setTorch((v) => !v)
              else setError('Вспышка недоступна')
            })
          }}
        >
          {torch ? 'Свет вкл' : 'Свет'}
        </button>
        <button
          type="button"
          data-story-flip=""
          className="text-[15px] text-white"
          aria-label="Переключить камеру"
          onClick={() => {
            const next = facing === 'user' ? 'environment' : 'user'
            setFacing(next)
            setTorch(false)
            void attach(next, true).catch((e) => setError(e instanceof Error ? e.message : 'Камера недоступна'))
          }}
        >
          Смена
        </button>
      </div>
      <div className="relative z-10 mt-auto flex items-center justify-between px-8 pb-[max(24px,var(--hub-safe-bottom))]">
        <button type="button" data-story-gallery="" aria-label="Галерея" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/40 text-white" onClick={() => galleryRef.current?.click()}>
          <IconImage size={22} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          data-story-shutter=""
          aria-label={recording ? 'Остановить видео' : 'Снять'}
          className={`h-[72px] w-[72px] rounded-full border-4 ${recording ? 'border-[#ff453a] bg-[#ff453a]' : 'border-white bg-white/90'}`}
          onPointerDown={() => {
            holding.current = false
            if (holdTimer.current) window.clearTimeout(holdTimer.current)
            holdTimer.current = window.setTimeout(() => {
              holding.current = true
              void startVideo()
            }, 220)
          }}
          onPointerUp={() => {
            if (holdTimer.current) {
              window.clearTimeout(holdTimer.current)
              holdTimer.current = null
            }
            if (holding.current) {
              holding.current = false
              void stopVideo()
              return
            }
            void takePhoto()
          }}
        />
        <span className="w-12" />
      </div>
      {error ? <p className="relative z-10 px-6 pb-4 text-center text-[13px] text-[#ff9b9b]">{error}</p> : null}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (!picked) return
          openEditor(picked, picked.type.startsWith('video/') ? 'video' : 'image')
        }}
      />
    </div>
  )
}
