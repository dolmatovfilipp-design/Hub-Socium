import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from './Avatar'
import {
  IconDraft,
  IconMore,
  IconSliders,
} from './Icons'
import { apiMe, apiCreateDraftOrSchedule, isApiMode } from '../lib/api'
import type { User } from '../types'
import { useNavMotion } from './NavMotion'

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
  const [params] = useSearchParams()
  const replyTo = params.get('reply') ?? undefined

  // Only select stable store slices — never return fresh [] / .filter() from useStore
  // (Zustand getSnapshot must be referentially stable or React hits max update depth).
  const currentUserId = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  const posts = useStore((s) => s.posts)
  const upsertCurrentUser = useStore((s) => s.upsertCurrentUser)
  const createPost = useStore((s) => s.createPost)
  const showToast = useStore((s) => s.showToast)
  const loadComments = useStore((s) => s.loadComments)
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
  const [tagDraft, setTagDraft] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [hydrating, setHydrating] = useState(
    () => !user && !!currentUserId && isApiMode(),
  )
  const [hydrateError, setHydrateError] = useState<string | null>(null)

  const { motionClass, dismiss } = useNavMotion('sheet')
  const close = () => dismiss('/app')
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [audience, setAudience] = useState('Все')

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


  const retryHydrate = () => {
    if (!isApiMode()) return
    setHydrateError(null)
    setHydrating(true)
    void apiMe()
      .then((me) => upsertCurrentUser(me))
      .catch((e) => setHydrateError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setHydrating(false))
  }


  const displayUser = user ?? PLACEHOLDER_USER
  const canPublish = text.trim().length > 0 && !publishing && !!user

  const submit = async () => {
    if (!canPublish) return
    setPublishing(true)
    const tags = tagDraft.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 5)
    const ok = await createPost(text, replyTo, undefined, tags)
    setPublishing(false)
    if (ok) close()
  }

  const saveDraft = async (schedule: boolean) => {
    if (!text.trim() || !isApiMode()) {
      showToast(isApiMode() ? 'Введите текст' : 'Черновики на сервере — только в API-режиме')
      return
    }
    setPublishing(true)
    try {
      const tags = tagDraft.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 5)
      let scheduled_at: string | undefined
      if (schedule) {
        const raw = window.prompt('Когда опубликовать? (ISO или через N минут, напр. 30)', '30')
        if (raw == null) {
          setPublishing(false)
          return
        }
        const n = Number(raw)
        if (!Number.isNaN(n) && n > 0) {
          scheduled_at = new Date(Date.now() + n * 60_000).toISOString()
        } else {
          scheduled_at = new Date(raw).toISOString()
        }
      }
      await apiCreateDraftOrSchedule({
        body: text.trim(),
        tags,
        status: schedule ? 'scheduled' : 'draft',
        scheduled_at,
      })
      showToast(schedule ? 'Отложено' : 'Черновик сохранён')
      close()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className={`relative flex h-full min-h-0 flex-col bg-black ${motionClass}`}>
      <div className="safe-top flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 pb-2.5 pt-2">
        <button
          type="button"
          onClick={close}
          className="pressable min-h-[40px] text-[16px] font-medium text-white"
        >
          Отмена
        </button>
        <span className="text-[16px] font-bold text-white">
          {replyTo ? 'Ответ' : 'Новая запись'}
        </span>
        <div className="flex items-center gap-0.5">
          <Link
            to="/app/drafts"
            className="pressable flex h-10 w-10 items-center justify-center text-white"
            aria-label="Черновики"
          >
            <IconDraft size={20} />
          </Link>
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
        <div className="mx-4 mb-2 mt-2 shrink-0 rounded-2xl border border-white/[0.08] bg-[#111] px-3 py-3 text-center">
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
        <div className="mx-4 mb-1 mt-2 shrink-0 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[13px] text-[#777]">
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

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-3">
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
          <div className="min-w-0 flex-1 pb-2">
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
              className="mt-1.5 w-full resize-none bg-transparent text-[16px] leading-[1.45] text-white placeholder:text-[#777] disabled:opacity-60"
            />
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="Теги: путешествия хобби"
              className="mt-2 h-10 w-full rounded-xl bg-white/[0.04] px-3 text-[14px] text-white placeholder:text-[#636366]"
            />
          </div>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 pt-2.5"
        style={{ paddingBottom: 'max(12px, var(--hub-safe-bottom))' }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-[#777]"
          onClick={() => setAudienceOpen(true)}
        >
          <IconSliders size={16} />
          <span className="truncate">Кто может отвечать: {audience}</span>
        </button>
                <button
          type="button"
          disabled={!text.trim() || publishing}
          onClick={() => void saveDraft(false)}
          className="pressable mr-2 rounded-full border border-white/15 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          Черновик
        </button>
        <button
          type="button"
          disabled={!text.trim() || publishing}
          onClick={() => void saveDraft(true)}
          className="pressable mr-2 rounded-full border border-white/15 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          Отложить
        </button>
<button
          type="button"
          disabled={!canPublish}
          onClick={() => void submit()}
          className={`pressable shrink-0 rounded-full px-5 py-2 text-[15px] font-semibold transition ${
            canPublish ? 'bg-white text-black' : 'bg-[#2a2a2a] text-[#555]'
          }`}
        >
          {publishing ? '…' : 'Опубликовать'}
        </button>
      </div>

      {audienceOpen &&
        typeof document !== 'undefined' &&
        document.getElementById('hub-overlay-root') &&
        createPortal(
          <div
            className="post-more-root pointer-events-auto absolute inset-0 z-[90] flex flex-col justify-end post-more-open"
            role="dialog"
            aria-modal="true"
            aria-label="Кто может отвечать"
          >
            <button
              type="button"
              className="post-more-backdrop absolute inset-0"
              aria-label="Закрыть"
              onClick={() => setAudienceOpen(false)}
            />
            <div className="post-more-sheet relative z-[1] px-3 pb-[max(12px,var(--hub-safe-bottom))] pt-2">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
              <p className="mb-2 px-1 text-[15px] font-semibold text-white">
                Кто может отвечать
              </p>
              <div className="overflow-hidden rounded-[14px] bg-[#1c1c1e]">
                {(['Все', 'Подписки', 'Только вы'] as const).map((opt, i, arr) => (
                  <button
                    key={opt}
                    type="button"
                    className={`pressable flex w-full items-center justify-between px-4 py-[14px] text-left text-[16px] text-white ${
                      i < arr.length - 1 ? 'border-b border-white/[0.08]' : ''
                    }`}
                    onClick={() => {
                      setAudience(opt)
                      setAudienceOpen(false)
                    }}
                  >
                    <span>{opt}</span>
                    {audience === opt && <span className="text-white">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.getElementById('hub-overlay-root')!,
        )}
    </div>
  )
}
