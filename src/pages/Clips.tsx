import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  apiCreateClip,
  apiLikeClip,
  apiListClips,
  apiUnlikeClip,
  apiUploadMedia,
  isApiMode,
  type ApiClip,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { HubEmptyState } from '../components/HubEmptyState'

export function Clips() {
  const showToast = useStore((s) => s.showToast)
  const [items, setItems] = useState<ApiClip[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [caption, setCaption] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [likeBusy, setLikeBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())

  const load = useCallback(async () => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiListClips()
      setItems(res.items ?? [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось загрузить видео')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

  // Autoplay active snap card; pause others
  useEffect(() => {
    const root = scrollerRef.current
    if (!root || !items.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.clipId
          if (!id) continue
          const video = videoRefs.current.get(id)
          if (!video) continue
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            void video.play().catch(() => {})
          } else {
            video.pause()
          }
        }
      },
      { root, threshold: [0.6, 0.85] },
    )
    root.querySelectorAll('[data-clip-id]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [items])

  const onUpload = async (file: File) => {
    if (!file.type.includes('mp4') && !file.type.includes('quicktime') && !file.name.endsWith('.mp4')) {
      showToast('Нужен файл MP4')
      return
    }
    if (file.size > 40 * 1024 * 1024) {
      showToast('Максимум 40 МБ')
      return
    }
    setUploading(true)
    try {
      const media = await apiUploadMedia(file)
      const clip = await apiCreateClip(media.url, caption.trim(), 0)
      setItems((prev) => [{ ...clip, likes: 0, liked_by_me: false }, ...prev])
      setCaption('')
      setShowUpload(false)
      showToast('Видео опубликовано')
      requestAnimationFrame(() => {
        scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setUploading(false)
    }
  }

  const toggleLike = async (c: ApiClip) => {
    if (likeBusy) return
    setLikeBusy(c.id)
    const prevLiked = !!c.liked_by_me
    const prevLikes = c.likes ?? 0
    setItems((list) =>
      list.map((x) =>
        x.id === c.id
          ? { ...x, liked_by_me: !prevLiked, likes: Math.max(0, prevLikes + (prevLiked ? -1 : 1)) }
          : x,
      ),
    )
    try {
      const res = prevLiked ? await apiUnlikeClip(c.id) : await apiLikeClip(c.id)
      setItems((list) =>
        list.map((x) =>
          x.id === c.id ? { ...x, liked_by_me: res.liked, likes: res.likes } : x,
        ),
      )
    } catch (e) {
      setItems((list) =>
        list.map((x) =>
          x.id === c.id ? { ...x, liked_by_me: prevLiked, likes: prevLikes } : x,
        ),
      )
      showToast(e instanceof Error ? e.message : 'Не удалось поставить лайк')
    } finally {
      setLikeBusy(null)
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-black">
      <header className="safe-top absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-6 pt-3">
        <Link to="/app" className="text-[15px] text-white/80">
          ← Назад
        </Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white">Видео</h1>
        <button
          type="button"
          disabled={!isApiMode()}
          onClick={() => setShowUpload((v) => !v)}
          className="rounded-full bg-white/15 px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          Загрузить
        </button>
      </header>

      {showUpload ? (
        <div className="absolute inset-x-0 top-[52px] z-30 mx-3 rounded-2xl border border-white/10 bg-[#111]/95 backdrop-blur-xl px-4 py-3 safe-top">
          <p className="mb-2 text-[13px] text-[#aaa]">Короткое вертикальное видео · MP4 до 40 МБ</p>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Подпись"
            maxLength={500}
            className="mb-2 w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none"
          />
          <button
            type="button"
            disabled={uploading}
            className="pressable w-full rounded-xl bg-white py-2.5 text-[15px] font-semibold text-black disabled:opacity-40"
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Загрузка…' : 'Выбрать MP4'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void onUpload(f)
            }}
          />
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        className="clips-snap no-scrollbar flex-1 overflow-y-auto"
      >
        {loading && <p className="flex h-full items-center justify-center text-[#777]">Загрузка…</p>}
        {!loading && !items.length && (
          <div className="flex h-full flex-col items-center justify-center px-6">
            <HubEmptyState
              title="Пока нет видео"
              subtitle="Загрузите короткий вертикальный ролик — он появится в ленте «Видео»."
            />
            <button
              type="button"
              className="mt-4 rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black"
              onClick={() => setShowUpload(true)}
            >
              Загрузить первое
            </button>
          </div>
        )}
        {items.map((c) => (
          <section
            key={c.id}
            data-clip-id={c.id}
            className="clips-snap-item relative flex h-full w-full shrink-0 items-center justify-center bg-black"
          >
            <video
              ref={(el) => {
                if (el) videoRefs.current.set(c.id, el)
                else videoRefs.current.delete(c.id)
              }}
              src={c.media_url}
              playsInline
              loop
              muted
              className="absolute inset-0 h-full w-full object-contain bg-black"
              onClick={(e) => {
                const v = e.currentTarget
                if (v.paused) void v.play().catch(() => {})
                else v.pause()
              }}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-32 pt-16">
              <p className="text-[14px] font-semibold text-white">
                @{c.author?.username ?? 'user'}
              </p>
              {c.caption ? (
                <p className="mt-1 line-clamp-3 text-[15px] text-white/90">{c.caption}</p>
              ) : null}
            </div>
            <div className="absolute bottom-36 right-3 z-20 flex flex-col items-center gap-3">
              <button
                type="button"
                disabled={likeBusy === c.id}
                onClick={() => void toggleLike(c)}
                className="pressable flex flex-col items-center rounded-full bg-black/35 px-3 py-2 backdrop-blur-md disabled:opacity-40"
              >
                <span className="text-[22px] leading-none">{c.liked_by_me ? '♥' : '♡'}</span>
                <span className="mt-1 text-[12px] font-semibold text-white">{c.likes ?? 0}</span>
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
