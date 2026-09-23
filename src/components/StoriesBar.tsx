import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import {
  apiCreateStory,
  apiListStoryRing,
  apiListUserStories,
  apiUploadMedia,
  isApiMode,
  type ApiStory,
  type ApiStoryRingItem,
} from '../lib/api'
import { useStore } from '../store/useStore'

export function StoriesBar() {
  const showToast = useStore((s) => s.showToast)
  const me = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  const meUser = users.find((u) => u.id === me)
  const [items, setItems] = useState<ApiStoryRingItem[]>([])
  const [viewer, setViewer] = useState<{ authorId: string; stories: ApiStory[]; idx: number } | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () => {
    if (!isApiMode()) return
    void apiListStoryRing()
      .then((r) => setItems(r.items ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    load()
  }, [])

  const open = async (authorId: string) => {
    try {
      const r = await apiListUserStories(authorId)
      if (!r.items?.length) {
        showToast('Нет активных историй')
        return
      }
      setViewer({ authorId, stories: r.items, idx: 0 })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const createText = async () => {
    const body = window.prompt('Текст истории (до 300 символов)')
    if (body == null) return
    const t = body.trim()
    if (!t) return
    setCreating(true)
    try {
      await apiCreateStory(t)
      showToast('История опубликована')
      load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setCreating(false)
    }
  }

  const createPhoto = async (file: File | null) => {
    if (!file) return
    setCreating(true)
    try {
      const media = await apiUploadMedia(file)
      await apiCreateStory('', media.url)
      showToast('История опубликована')
      load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setCreating(false)
    }
  }

  if (!isApiMode()) return null

  const cur = viewer ? viewer.stories[viewer.idx] : null

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-4 py-3 scrollbar-none">
        <button
          type="button"
          disabled={creating}
          onClick={() => void createText()}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-white/30 bg-[#1c1c1e] text-xl text-white">
            +
          </span>
          <span className="truncate text-[11px] text-[#8e8e93]">Ваша</span>
        </button>
        <label className="flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-[#1c1c1e] text-[11px] text-white">
            Фото
          </span>
          <span className="truncate text-[11px] text-[#8e8e93]">Медиа</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void createPhoto(e.target.files?.[0] ?? null)}
          />
        </label>
        {items.map((it) => (
          <button
            key={it.author.id}
            type="button"
            onClick={() => void open(it.author.id)}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <span
              className={`rounded-full p-[2px] ${it.seen ? 'bg-white/20' : 'bg-gradient-to-tr from-[#ff7a18] to-[#af002d]'}`}
            >
              <Avatar
                name={it.author.display_name || it.author.username}
                id={it.author.id}
                src={it.author.avatar_url}
                size={52}
              />
            </span>
            <span className="w-full truncate text-center text-[11px] text-[#c7c7cc]">
              {it.is_me ? 'Вы' : it.author.username}
            </span>
          </button>
        ))}
      </div>

      {viewer && cur && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black">
          <div className="flex gap-1 px-3 pt-3">
            {viewer.stories.map((_, i) => (
              <div
                key={i}
                className={`h-0.5 flex-1 rounded-full ${i <= viewer.idx ? 'bg-white' : 'bg-white/25'}`}
              />
            ))}
          </div>
          <button
            type="button"
            className="absolute right-3 top-8 z-10 text-white"
            onClick={() => setViewer(null)}
          >
            ✕
          </button>
          <button
            type="button"
            className="absolute inset-y-0 left-0 w-1/3"
            aria-label="Назад"
            onClick={() =>
              setViewer((v) => (v && v.idx > 0 ? { ...v, idx: v.idx - 1 } : v))
            }
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 w-1/3"
            aria-label="Далее"
            onClick={() =>
              setViewer((v) => {
                if (!v) return v
                if (v.idx < v.stories.length - 1) return { ...v, idx: v.idx + 1 }
                return null
              })
            }
          />
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            {cur.media_url ? (
              <img src={cur.media_url} alt="" className="max-h-[70vh] rounded-2xl object-contain" />
            ) : null}
            {cur.body ? (
              <p className="mt-4 text-center text-[20px] font-medium leading-snug text-white">{cur.body}</p>
            ) : null}
            <p className="mt-6 text-[13px] text-[#8e8e93]">
              {meUser && viewer.authorId === me ? 'Вы' : 'История'} · 24ч
            </p>
          </div>
        </div>
      )}
    </>
  )
}
