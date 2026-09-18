import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from './Avatar'
import {
  IconDraft,
  IconMore,
  IconImage,
  IconSticker,
  IconGif,
  IconMusic,
  IconSettings,
} from './Icons'
import { apiMe, apiUploadMedia, isApiMode } from '../lib/api'
import type { User } from '../types'

const PLACEHOLDER_USER: User = {
  id: 'pending',
  name: '…',
  username: '…',
  email: '',
  password: '',
  bio: '',
  followers: 0,
  following: 0,
}

export function ComposeSheet() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const replyTo = params.get('reply') ?? undefined

  // Only select stable store slices — never return fresh [] / .filter() from useStore
  // (Zustand getSnapshot must be referentially stable or React hits max update depth).
  const currentUserId = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  const posts = useStore((s) => s.posts)
  const upsertCurrentUser = useStore((s) => s.upsertCurrentUser)
  const createPost = useStore((s) => s.createPost)
  const loadComments = useStore((s) => s.loadComments)
  const showToast = useStore((s) => s.showToast)

  const user = useMemo(
    () => (currentUserId ? users.find((u) => u.id === currentUserId) : undefined),
    [users, currentUserId],
  )
  const replyPost = useMemo(
    () => (replyTo ? posts.find((p) => p.id === replyTo) : undefined),
    [posts, replyTo],
  )
  const replyAuthor = useMemo(
    () => (replyPost ? users.find((u) => u.id === replyPost.authorId) : undefined),
    [users, replyPost],
  )
  const commentPosts = useMemo(
    () =>
      replyTo
        ? posts.filter((p) => p.replyToId === replyTo && !p.id.startsWith('cmeta_'))
        : [],
    [posts, replyTo],
  )

  const [text, setText] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | undefined>()
  const [previewUrl, setPreviewUrl] = useState<string | undefined>()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [hydrating, setHydrating] = useState(
    () => !user && !!currentUserId && isApiMode(),
  )
  const [hydrateError, setHydrateError] = useState<string | null>(null)

  const close = () => {
    navigate('/app', { replace: true })
  }

  useEffect(() => {
    if (replyTo && isApiMode()) void loadComments(replyTo)
  }, [replyTo, loadComments])

  useEffect(() => {
    if (user || !currentUserId) {
      setHydrating(false)
      return
    }
    if (!isApiMode()) {
      setHydrateError('Профиль не найден')
      setHydrating(false)
      return
    }
    let cancelled = false
    setHydrating(true)
    setHydrateError(null)
    void (async () => {
      try {
        const me = await apiMe()
        if (cancelled) return
        upsertCurrentUser(me)
      } catch (e) {
        if (cancelled) return
        setHydrateError(e instanceof Error ? e.message : 'Не удалось загрузить профиль')
      } finally {
        if (!cancelled) setHydrating(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, currentUserId, upsertCurrentUser])

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const retryHydrate = () => {
    if (!isApiMode()) return
    setHydrateError(null)
    setHydrating(true)
    void apiMe()
      .then((me) => upsertCurrentUser(me))
      .catch((e) => setHydrateError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setHydrating(false))
  }

  const clearImage = () => {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(undefined)
    setImageUrl(undefined)
  }

  const onPickImage = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Только jpeg/png/webp/gif')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Максимум 2 МБ')
      return
    }
    if (replyTo) {
      showToast('К ответу пока нельзя прикрепить фото')
      return
    }

    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    const localPreview = URL.createObjectURL(file)
    setPreviewUrl(localPreview)

    if (!isApiMode()) {
      // Local demo: keep object URL as post image
      setImageUrl(localPreview)
      return
    }

    setUploading(true)
    void apiUploadMedia(file)
      .then((media) => {
        setImageUrl(media.url)
        showToast('Фото готово')
      })
      .catch((e) => {
        clearImage()
        showToast(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
      .finally(() => setUploading(false))
  }

  const displayUser = user ?? PLACEHOLDER_USER
  const canPublish =
    text.trim().length > 0 && !publishing && !uploading && !!user

  const submit = async () => {
    if (!canPublish) return
    setPublishing(true)
    const ok = await createPost(text, replyTo, imageUrl)
    setPublishing(false)
    if (ok) close()
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black">
      <div className="safe-top flex shrink-0 items-center justify-between px-4 pb-2 pt-2">
        <button
          type="button"
          onClick={close}
          className="pressable min-h-[40px] text-[16px] text-white"
        >
          Отмена
        </button>
        <span className="text-[16px] font-bold text-white">
          {replyTo ? 'Ответ' : 'Новая ветка'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="pressable flex h-10 w-10 items-center justify-center text-white"
            aria-label="Черновики"
          >
            <IconDraft size={20} />
          </button>
          <button
            type="button"
            className="pressable flex h-10 w-10 items-center justify-center text-white"
            aria-label="Ещё"
          >
            <IconMore size={20} />
          </button>
        </div>
      </div>

      {!user && (
        <div className="mx-4 mb-2 shrink-0 rounded-2xl border border-white/[0.08] bg-[#111] px-3 py-3 text-center">
          <p className="text-[14px] text-[#a8a8a8]">
            {hydrating
              ? 'Загрузка профиля…'
              : hydrateError ??
                (currentUserId ? 'Профиль не найден' : 'Нужен вход')}
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            {hydrateError && isApiMode() && (
              <button
                type="button"
                className="pressable rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black"
                onClick={retryHydrate}
              >
                Повторить
              </button>
            )}
            <button
              type="button"
              className="pressable rounded-full border border-white/20 px-4 py-2 text-[14px] font-semibold text-white"
              onClick={close}
            >
              Назад
            </button>
          </div>
        </div>
      )}

      {replyPost && replyAuthor && (
        <div className="mx-4 mb-1 shrink-0 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[13px] text-[#777]">
          В ответ @{replyAuthor.username}: {replyPost.text.slice(0, 80)}
          {replyPost.text.length > 80 ? '…' : ''}
        </div>
      )}

      {replyTo && commentPosts.length > 0 && (
        <div className="mx-4 mb-2 max-h-36 shrink-0 space-y-2 overflow-y-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
          {commentPosts.map((c) => {
            const a = users.find((u) => u.id === c.authorId)
            return (
              <div key={c.id} className="text-[13px] leading-snug text-[#a8a8a8]">
                <span className="font-semibold text-white">@{a?.username ?? 'user'}</span>{' '}
                {c.text}
              </div>
            )
          })}
        </div>
      )}

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-2">
        <div className="flex gap-3">
          <div className="flex w-9 shrink-0 flex-col items-center">
            <Avatar
              name={displayUser.name}
              id={displayUser.id}
              src={displayUser.avatar}
              size={36}
            />
            <div className="thread-line" />
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[15px] font-semibold text-white">
                {displayUser.username}
              </span>
              <span className="text-[#777]">›</span>
              <span className="text-[14px] text-[#777]">Сообщество или тема</span>
            </div>
            <textarea
              autoFocus={!!user}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Что нового?"
              rows={4}
              disabled={!user}
              className="mt-1 w-full resize-none bg-transparent text-[16px] leading-relaxed text-white placeholder:text-[#777] disabled:opacity-60"
            />
            {(previewUrl || imageUrl) && (
              <div className="relative mt-2 overflow-hidden rounded-2xl border border-white/[0.08]">
                <img
                  src={previewUrl || imageUrl}
                  alt=""
                  className="block max-h-64 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[12px] text-white"
                >
                  Убрать
                </button>
                {uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[13px] text-white">
                    Загрузка…
                  </div>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center gap-4 text-[#777]">
              <button
                type="button"
                className="pressable"
                aria-label="Медиа"
                disabled={!user || !!replyTo || uploading}
                onClick={() => fileRef.current?.click()}
              >
                <IconImage size={22} />
              </button>
              <button type="button" className="pressable" aria-label="Стикер">
                <IconSticker size={22} />
              </button>
              <button type="button" className="pressable" aria-label="GIF">
                <IconGif size={22} />
              </button>
              <button type="button" className="pressable opacity-40" aria-label="Аудио" disabled>
                <IconMusic size={22} />
              </button>
              <button type="button" className="pressable" aria-label="Ещё">
                <IconMore size={20} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  onPickImage(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        </div>

        <div className="mt-1 flex items-center gap-3 opacity-50">
          <div className="flex w-9 shrink-0 justify-center">
            <Avatar
              name={displayUser.name}
              id={displayUser.id}
              src={displayUser.avatar}
              size={22}
            />
          </div>
          <span className="text-[14px] text-[#777]">Дополните ветку</span>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 pt-2"
        style={{ paddingBottom: 'max(10px, var(--hub-safe-bottom))' }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-[#777]"
        >
          <IconSettings size={16} />
          <span className="truncate">Параметры публикации</span>
        </button>
        <div className="flex h-8 w-12 items-center rounded-full bg-[#2a2a2a] px-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3a3a3a] text-[11px]">
            🙂
          </span>
        </div>
        <button
          type="button"
          disabled={!canPublish}
          onClick={() => void submit()}
          className={`pressable rounded-full px-4 py-2 text-[14px] font-semibold transition ${
            canPublish ? 'bg-white text-black' : 'bg-[#1a1a1a] text-[#777]'
          }`}
        >
          {publishing ? '…' : 'Опубликовать'}
        </button>
      </div>
    </div>
  )
}
