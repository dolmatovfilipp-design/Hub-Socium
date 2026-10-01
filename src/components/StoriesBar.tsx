import { useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { IconClose, IconImage, IconMusic, IconPlus } from './Icons'
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
  const [composerOpen, setComposerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [storyText, setStoryText] = useState('')
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const mediaPreviewRef = useRef<string | null>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const songInputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    if (!isApiMode()) return
    void apiListStoryRing()
      .then((r) => setItems(r.items ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    load()
    return () => {
      if (mediaPreviewRef.current) URL.revokeObjectURL(mediaPreviewRef.current)
    }
  }, [])

  const openComposer = () => {
    setStoryText('')
    setMediaFile(null)
    setMediaPreview(null)
    setComposerOpen(true)
  }

  const closeComposer = (force = false) => {
    if (!force && (creating || uploading)) return
    setComposerOpen(false)
    setStoryText('')
    setMediaFile(null)
    if (mediaPreviewRef.current) URL.revokeObjectURL(mediaPreviewRef.current)
    mediaPreviewRef.current = null
    setMediaPreview(null)
  }

  const chooseMedia = (file: File | undefined) => {
    if (mediaPreviewRef.current) URL.revokeObjectURL(mediaPreviewRef.current)
    if (!file) {
      mediaPreviewRef.current = null
      setMediaFile(null)
      setMediaPreview(null)
      return
    }
    const preview = file.type.startsWith('image/') || file.type.startsWith('video/')
      ? URL.createObjectURL(file)
      : null
    mediaPreviewRef.current = preview
    setMediaFile(file)
    setMediaPreview(preview)
  }

  const publish = async () => {
    if ((!storyText.trim() && !mediaFile) || creating || uploading) return
    setCreating(true)
    try {
      let mediaUrl: string | undefined
      if (mediaFile) {
        setUploading(true)
        mediaUrl = (await apiUploadMedia(mediaFile)).url
        setUploading(false)
      }
      await apiCreateStory(
        storyText.trim(),
        mediaUrl,
        window.confirm('Только близким друзьям?') ? 'close_friends' : 'all',
      )
      showToast('История опубликована')
      closeComposer(true)
      load()
    } catch (e) {
      setUploading(false)
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

  if (!isApiMode()) return null

  const cur = viewer ? viewer.stories[viewer.idx] : null
  const curMedia = cur?.media_url ? mediaKind(cur.media_url) : null
  const otherItems = items.filter((it) => !it.is_me)

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-4 py-3 scrollbar-none">
        {/* One story entry: text, photo, video and song are all added from its sheet. */}
        <button
          type="button"
          disabled={creating || uploading}
          onClick={openComposer}
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

      {composerOpen && (
        <div className="fixed inset-0 z-[var(--hub-z-sheet)] flex items-end bg-black/60" onClick={() => closeComposer()}>
          <div
            className="w-full rounded-t-[26px] border-t border-white/[0.1] bg-[#111] px-4 pb-[max(18px,var(--hub-safe-bottom))] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[17px] font-semibold text-white">Новая история</p>
                <p className="mt-0.5 text-[12px] text-[#8e8e93]">Добавьте текст, медиа и песню</p>
              </div>
              <button type="button" aria-label="Закрыть" className="pressable text-[#8e8e93]" onClick={() => closeComposer()}>
                <IconClose size={22} strokeWidth={1.35} />
              </button>
            </div>
            <textarea
              value={storyText}
              onChange={(e) => setStoryText(e.target.value.slice(0, 300))}
              placeholder="Текст истории…"
              rows={3}
              autoFocus
              className="w-full resize-none rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-3 text-[16px] leading-snug text-white placeholder:text-[#777]"
            />
            {mediaFile && (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5">
                {mediaPreview ? (
                  mediaFile.type.startsWith('video/') ? (
                    <video src={mediaPreview} className="h-14 w-14 rounded-xl object-cover" muted />
                  ) : (
                    <img src={mediaPreview} alt="" className="h-14 w-14 rounded-xl object-cover" />
                  )
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/[0.08] text-white">
                    <IconMusic size={23} strokeWidth={1.35} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-white">{mediaFile.name}</p>
                  <p className="mt-0.5 text-[12px] text-[#8e8e93]">
                    {mediaFile.type.startsWith('audio/') ? 'Песня' : mediaFile.type.startsWith('video/') ? 'Видео' : 'Фото'}
                  </p>
                </div>
                <button type="button" className="pressable px-2 text-[13px] text-[#8e8e93]" onClick={() => chooseMedia(undefined)}>
                  Убрать
                </button>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="pressable flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/[0.07] py-3 text-[13px] font-medium text-white"
                onClick={() => mediaInputRef.current?.click()}
              >
                <IconImage size={18} strokeWidth={1.35} /> Фото или видео
              </button>
              <button
                type="button"
                className="pressable flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/[0.07] py-3 text-[13px] font-medium text-white"
                onClick={() => songInputRef.current?.click()}
              >
                <IconMusic size={18} strokeWidth={1.35} /> Песня
              </button>
            </div>
            <input ref={mediaInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { chooseMedia(e.target.files?.[0]); e.target.value = '' }} />
            <input ref={songInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { chooseMedia(e.target.files?.[0]); e.target.value = '' }} />
            <button
              type="button"
              disabled={(!storyText.trim() && !mediaFile) || creating || uploading}
              onClick={() => void publish()}
              className={`pressable mt-4 w-full rounded-2xl py-3 text-[15px] font-semibold ${storyText.trim() || mediaFile ? 'bg-white text-black' : 'bg-white/[0.1] text-[#777]'}`}
            >
              {uploading ? 'Загрузка…' : creating ? 'Публикация…' : 'Опубликовать историю'}
            </button>
          </div>
        </div>
      )}

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
            {cur.media_url && curMedia === 'video' ? <video src={cur.media_url} controls autoPlay playsInline className="max-h-[70vh] max-w-full rounded-2xl" /> : null}
            {cur.media_url && curMedia === 'audio' ? <audio src={cur.media_url} controls className="w-full max-w-sm" /> : null}
            {cur.media_url && curMedia === 'image' ? <img src={cur.media_url} alt="История" className="max-h-[70vh] rounded-2xl object-contain" /> : null}
            {cur.body ? <p className="mt-4 text-center text-[20px] font-medium leading-snug text-white">{cur.body}</p> : null}
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
