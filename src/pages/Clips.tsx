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
  const [likeBusy, setLikeBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
      showToast(e instanceof Error ? e.message : 'Не удалось загрузить клипы')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

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
      showToast('Клип опубликован')
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
      showToast(e instanceof Error ? e.message : 'Не удалось')
    } finally {
      setLikeBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Link to="/app" className="text-[15px] text-[#8e8e93]">
          ← Назад
        </Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white">Клипы</h1>
        <div className="w-14" />
      </header>

      <div className="border-b border-white/[0.06] px-4 py-3">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Подпись (необязательно)"
          className="mb-2 w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none"
        />
        <button
          type="button"
          disabled={uploading || !isApiMode()}
          className="pressable w-full rounded-xl bg-white py-2.5 text-[15px] font-semibold text-black disabled:opacity-40"
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Загрузка…' : 'Загрузить MP4'}
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
        <p className="mt-2 text-center text-[11px] text-[#555]">Вертикальное видео до 40 МБ · не заменяет ленту</p>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto scroll-pad-nav">
        {loading && <p className="py-8 text-center text-[#777]">Загрузка…</p>}
        {!loading && !items.length && (
          <HubEmptyState title="Пока нет клипов" subtitle="Загрузите короткое вертикальное видео — оно появится на этой полке." />
        )}
        {items.map((c) => (
          <article key={c.id} className="border-b border-white/[0.06] px-4 py-4">
            <p className="mb-2 text-[13px] text-[#8e8e93]">
              @{c.author?.username ?? 'user'}
              {c.caption ? ` · ${c.caption}` : ''}
            </p>
            <div className="mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-[320px] overflow-hidden rounded-2xl bg-[#111]">
              <video src={c.media_url} controls playsInline className="h-full w-full object-contain" />
            </div>
            <div className="mx-auto mt-3 flex max-w-[320px] items-center gap-3">
              <button
                type="button"
                disabled={likeBusy === c.id}
                onClick={() => void toggleLike(c)}
                className="pressable rounded-full bg-white/10 px-4 py-1.5 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                {c.liked_by_me ? '♥' : '♡'} {c.likes ?? 0}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
