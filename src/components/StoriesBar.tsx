import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { IconPlus } from './Icons'
import { StoryCamera, storyFilterCss, type StoryShot } from './StoryCamera'
import {
  apiCreateConversation,
  apiCreateStory,
  apiSendMessageFull,
  apiListStoryRing,
  apiListUserStories,
  apiUploadMedia,
  isApiMode,
  type ApiStory,
  type ApiStoryRingItem,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { useTabVisible } from '../lib/tabVisible'

type StoryMediaKind = 'image' | 'video' | 'audio'

function mediaKind(url: string): StoryMediaKind {
  if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(url)) return 'video'
  if (/\.(mp3|m4a|wav|ogg|aac|flac)(?:[?#]|$)/i.test(url)) return 'audio'
  return 'image'
}

export function StoriesBar() {
  const showToast = useStore((s) => s.showToast)
  const me = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  const meUser = users.find((u) => u.id === me)
  const [items, setItems] = useState<ApiStoryRingItem[]>([])
  const [viewer, setViewer] = useState<{ authorId: string; stories: ApiStory[]; idx: number } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const tabVisible = useTabVisible()
  const load = () => {
    if (!isApiMode()) return
    void apiListStoryRing()
      .then((r) => setItems(r.items ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    if (!tabVisible) return
    load()
  }, [tabVisible])

  const publish = async (shot: StoryShot) => {
    if (!isApiMode()) {
      showToast('Истории — при подключении к серверу')
      return
    }
    if (creating) return
    setCreating(true)
    try {
      const mediaUrl = (await apiUploadMedia(shot.file)).url
      let songUrl = ''
      if (shot.song) songUrl = (await apiUploadMedia(shot.song)).url
      await apiCreateStory(
        shot.text,
        mediaUrl,
        shot.closeFriends ? 'close_friends' : 'all',
        { filter_id: shot.filterId, place_name: shot.place, media_kind: shot.kind, song_url: songUrl },
      )
      showToast('История опубликована')
      setCameraOpen(false)
      load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось опубликовать историю')
    } finally {
      setCreating(false)
    }
  }

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

  if (!isApiMode()) {
    return (
      <>
      <div className="stories-scroller flex gap-3 overflow-x-auto px-4 py-3 scrollbar-none">
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
          aria-label="Добавить историю"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-white/30 bg-[#1c1c1e] text-white">
            <IconPlus size={25} strokeWidth={1.35} />
          </span>
          <span className="truncate text-[11px] text-[#8e8e93]">Ваша история</span>
        </button>
      </div>
      {cameraOpen ? (
        <StoryCamera onClose={() => setCameraOpen(false)} onPublish={(shot) => void publish(shot)} publishing={creating} />
      ) : null}
      </>
    )
  }

  const cur = viewer ? viewer.stories[viewer.idx] : null
  const curMedia = cur?.media_kind === 'video' || cur?.media_kind === 'audio' || cur?.media_kind === 'image'
    ? cur.media_kind
    : cur?.media_url ? mediaKind(cur.media_url) : null
  const otherItems = items.filter((it) => !it.is_me)

  return (
    <>
      <div className="stories-scroller flex gap-3 overflow-x-auto px-4 py-3 scrollbar-none">
        {/* One story entry: text, photo, video and song are all added from its sheet. */}
        <button
          type="button"
          disabled={creating}
          onClick={() => setCameraOpen(true)}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
          aria-label="Добавить историю"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-white/30 bg-[#1c1c1e] text-white">
            <IconPlus size={25} strokeWidth={1.35} />
          </span>
          <span className="truncate text-[11px] text-[#8e8e93]">Ваша история</span>
        </button>
        {otherItems.map((it) => (
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
              {it.author.username}
            </span>
          </button>
        ))}
      </div>

      {cameraOpen ? (
        <StoryCamera onClose={() => { if (!creating) setCameraOpen(false) }} onPublish={(shot) => void publish(shot)} publishing={creating} />
      ) : null}

      {viewer && cur && (
        <div className="fixed inset-0 z-[var(--hub-z-modal)] flex flex-col bg-black">
          <div className="flex gap-1 px-3 pt-3">
            {viewer.stories.map((_, i) => (
              <div key={i} className={`h-0.5 flex-1 rounded-full ${i <= viewer.idx ? 'bg-white' : 'bg-white/25'}`} />
            ))}
          </div>
          <button type="button" aria-label="Закрыть" className="absolute right-3 top-8 z-10 text-white" onClick={() => setViewer(null)}>
            ✕
          </button>
          <button type="button" className="absolute inset-y-0 left-0 w-1/3" aria-label="Назад" onClick={() => setViewer((v) => (v && v.idx > 0 ? { ...v, idx: v.idx - 1 } : v))} />
          <button type="button" className="absolute inset-y-0 right-0 w-1/3" aria-label="Далее" onClick={() => setViewer((v) => { if (!v) return v; if (v.idx < v.stories.length - 1) return { ...v, idx: v.idx + 1 }; return null })} />
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            {cur.media_url && curMedia === 'video' ? <video src={cur.media_url} controls autoPlay playsInline className="max-h-[70vh] max-w-full rounded-2xl" style={{ filter: storyFilterCss[cur.filter_id || ''] }} /> : null}
            {cur.media_url && curMedia === 'audio' ? <audio src={cur.media_url} controls className="w-full max-w-sm" /> : null}
            {cur.media_url && curMedia === 'image' ? <img src={cur.media_url} alt="История" className="max-h-[70vh] rounded-2xl object-contain" style={{ filter: storyFilterCss[cur.filter_id || ''] }} /> : null}
            {cur.song_url ? <audio src={cur.song_url} autoPlay className="mt-3 w-full max-w-sm" /> : null}
            {cur.body ? <p className="mt-4 text-center text-[20px] font-medium leading-snug text-white">{cur.body}</p> : null}
            {cur.place_name ? <p className="mt-2 text-[13px] text-[#c7c7cc]">{cur.place_name}</p> : null}
            <p className="mt-6 text-[13px] text-[#8e8e93]">{meUser && viewer.authorId === me ? 'Вы' : 'История'} · 24ч</p>
            {me && viewer.authorId !== me ? (
              <button
                type="button"
                className="pressable mt-4 rounded-full border border-white/[0.15] px-4 py-2 text-[13px] font-medium text-white"
                onClick={() => {
                  const text = window.prompt('Ответ на историю') || ''
                  if (!text.trim() || !cur) return
                  void apiCreateConversation({ user_id: viewer.authorId })
                    .then((c) => apiSendMessageFull(c.id, { body: text.trim(), story_id: cur.id }))
                    .then(() => { showToast('Отправлено в сообщения'); setViewer(null) })
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
                }}
              >
                Ответить
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
