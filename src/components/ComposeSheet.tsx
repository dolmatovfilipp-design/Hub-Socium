import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from './Avatar'
import {
  IconImage,
  IconMic,
} from './Icons'
import { apiMe, apiUploadMedia, apiComposeAssist, isApiMode } from '../lib/api'
import { enqueueOffline, isBrowserOffline } from '../lib/offlineQueue'
import type { User } from '../types'
import { useNavMotion } from './NavMotion'
import {
  VoiceBubble,
  encodeVoiceReply,
  parseVoiceReply,
} from './VoiceBubble'

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
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [assistBusy, setAssistBusy] = useState(false)
  const [assistHint, setAssistHint] = useState('')
  const [uploading, setUploading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recRef = useRef<{
    rec: MediaRecorder
    stream: MediaStream
    chunks: BlobPart[]
    started: number
    stopped: Promise<Blob>
  } | null>(null)
  const recTimerRef = useRef<number | null>(null)
  const [hydrating, setHydrating] = useState(
    () => !user && !!currentUserId && isApiMode(),
  )
  const [hydrateError, setHydrateError] = useState<string | null>(null)

  const { motionClass, dismiss } = useNavMotion('sheet')
  const close = () => dismiss('/app')

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



  const stopVoiceReply = useCallback(async () => {
    const ctx = recRef.current
    if (!ctx) return
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (ctx.rec.state === 'recording') ctx.rec.stop()
    ctx.stream.getTracks().forEach((tr) => tr.stop())
    setRecording(false)
    const blob = await ctx.stopped
    const durationMs = Math.min(60_000, Date.now() - ctx.started)
    recRef.current = null
    setRecSeconds(0)
    if (!replyTo) return
    if (durationMs < 400) {
      showToast('Слишком коротко')
      return
    }
    if (!isApiMode()) {
      // Local demo: inject reply into store
      const url = URL.createObjectURL(blob)
      const body = encodeVoiceReply(url, durationMs)
      setPublishing(true)
      const ok = await createPost(body, replyTo)
      setPublishing(false)
      if (ok) showToast('Голосовой ответ отправлен')
      return
    }
    try {
      setPublishing(true)
      const file = new File([blob], 'voice-reply.webm', { type: blob.type || 'audio/webm' })
      const media = await apiUploadMedia(file)
      const body = encodeVoiceReply(media.url, durationMs)
      const ok = await createPost(body, replyTo)
      if (ok) showToast('Голосовой ответ отправлен')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось записать')
    } finally {
      setPublishing(false)
    }
  }, [replyTo, showToast, createPost])

  const startVoiceReply = useCallback(async () => {
    if (!replyTo) return
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast('Микрофон недоступен')
      return
    }
    if (recording) {
      await stopVoiceReply()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      const started = Date.now()
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data)
      }
      const stopped = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
      })
      rec.start()
      recRef.current = { rec, stream, chunks, started, stopped }
      setRecording(true)
      setRecSeconds(0)
      recTimerRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - started) / 1000)
        setRecSeconds(sec)
        if (sec >= 60) void stopVoiceReply()
      }, 250)
      showToast('Запись ответа… до 60 с')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось записать')
    }
  }, [replyTo, recording, showToast, stopVoiceReply])

  const displayUser = user ?? PLACEHOLDER_USER
  const canPublish = (text.trim().length > 0 || imageUrls.length > 0) && !publishing && !!user && !uploading

  const submit = async () => {
    if (!canPublish) return
    setPublishing(true)
    const tags = tagDraft.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 5)
    if (isApiMode() && isBrowserOffline()) {
      enqueueOffline('post', { body: text.trim(), tags }, text.trim().slice(0, 40) || 'Пост')
      showToast('Сохранено · ждёт сеть')
      setPublishing(false)
      close()
      return
    }
    const ok = await createPost(text, replyTo, imageUrls[0], tags, {
      image_urls: imageUrls.length ? imageUrls : undefined,
    })
    setPublishing(false)
    if (ok) close()
  }


  return (
    <div className={`relative flex h-full min-h-0 flex-col bg-black ${motionClass}`}>
      <div className="safe-top flex shrink-0 items-center justify-between bg-black px-3 pb-2.5 pt-2">
        <button
          type="button"
          onClick={close}
          className="hub-circle-btn"
          aria-label="Отмена"
        >
          ✕
        </button>
        <span className="text-[16px] font-bold text-white">
          {replyTo ? 'Ответ' : 'Новая запись'}
        </span>
        <span className="h-10 w-10" aria-hidden />
      </div>

      {!user && (
        <div className="mx-3 mb-2 mt-2 shrink-0 rounded-[22px] bg-[#1c1c1e] px-3 py-3 text-center">
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

      {recording ? (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
          Запись голосового ответа · {recSeconds}с / 60с
          <button
            type="button"
            className="ml-auto font-semibold text-white"
            onClick={() => void stopVoiceReply()}
          >
            Стоп
          </button>
        </div>
      ) : null}

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
            const voice = parseVoiceReply(c.text)
            return (
              <div key={c.id} className="text-[13px] leading-snug text-[#a8a8a8]">
                <span className="font-semibold text-white">@{a?.username ?? 'user'}</span>{' '}
                {voice ? (
                  <div className="mt-1 rounded-xl bg-white/[0.06] px-2.5 py-1.5">
                    <VoiceBubble url={voice.url} durationMs={voice.durationMs} />
                  </div>
                ) : (
                  c.text
                )}
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
            </div>
            <textarea
              autoFocus={!!user}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Что нового?"
              rows={5}
              disabled={!user}
              className="mt-2 w-full resize-none bg-transparent text-[17px] leading-[1.45] text-white placeholder:text-[#636366] disabled:opacity-60"
            />
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="#теги"
              className="mt-3 h-9 w-auto max-w-[220px] rounded-full border border-white/[0.08] bg-transparent px-3.5 text-[13px] text-[#a8a8a8] placeholder:text-[#8e8e93]"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={assistBusy || !text.trim()}
                className="rounded-full border border-white/[0.12] px-3 py-1.5 text-[12px] font-medium text-[#c7c7cc] disabled:opacity-40"
                onClick={() => {
                  if (!isApiMode()) {
                    showToast('Помощь с текстом — в API-режиме')
                    return
                  }
                  setAssistBusy(true)
                  setAssistHint('')
                  void apiComposeAssist(text)
                    .then((r) => {
                      if (r.suggestion) {
                        setText(r.suggestion)
                        setAssistHint('Черновик от ИИ — проверьте перед публикацией')
                      } else if (r.disabled) {
                        showToast(r.message || 'Подключите ключ LLM на сервере')
                      } else {
                        showToast(r.message || 'Нет предложения')
                      }
                    })
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка ИИ'))
                    .finally(() => setAssistBusy(false))
                }}
              >
                {assistBusy ? '…' : 'Помочь с текстом'}
              </button>
              {assistHint ? <span className="text-[11px] text-[#8e8e93]">{assistHint}</span> : null}
            </div>
            {imageUrls.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {imageUrls.map((u) => (
                  <div key={u} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl">
                    <img src={u} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="Удалить изображение"
                      className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-[11px] text-white"
                      onClick={() => setImageUrls((prev) => prev.filter((x) => x !== u))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 pt-2.5"
        style={{ paddingBottom: 'max(12px, var(--hub-safe-bottom))' }}
      >
        {replyTo ? (
          <button
            type="button"
            className={`hub-circle-btn hub-circle-btn-lg shrink-0 ${
              recording ? 'bg-red-600 text-white' : 'text-white'
            }`}
            aria-label={recording ? 'Стоп записи' : 'Голосовой ответ'}
            disabled={publishing || !user}
            onClick={() => void startVoiceReply()}
          >
            {recording ? (
              <span className="text-[11px] font-semibold tabular-nums">{recSeconds}с</span>
            ) : (
              <IconMic size={22} strokeWidth={1.35} />
            )}
          </button>
        ) : null}
        <label className="hub-circle-btn hub-circle-btn-lg cursor-pointer">
          {uploading ? (
            <span className="text-[13px] text-[#8e8e93]">…</span>
          ) : (
            <IconImage size={22} strokeWidth={1.35} />
          )}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []).slice(0, 10 - imageUrls.length)
              e.target.value = ''
              if (!files.length || !isApiMode()) return
              setUploading(true)
              void Promise.all(files.map((f) => apiUploadMedia(f)))
                .then((medias) => setImageUrls((prev) => [...prev, ...medias.map((m) => m.url)].slice(0, 10)))
                .catch((err) => showToast(err instanceof Error ? err.message : 'Ошибка фото'))
                .finally(() => setUploading(false))
            }}
          />
        </label>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          disabled={!canPublish}
          onClick={() => void submit()}
          className={`pressable shrink-0 rounded-full px-5 py-2.5 text-[15px] font-semibold transition ${
            canPublish ? 'bg-white text-black' : 'bg-[#2a2a2a] text-[#8e8e93]'
          }`}
        >
          {publishing ? '…' : 'Опубликовать'}
        </button>
      </div>


    </div>
  )
}
