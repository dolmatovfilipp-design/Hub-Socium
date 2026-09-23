import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  apiCreateChannelPost,
  apiGetChannel,
  apiJoinChannel,
  apiLeaveChannel,
  apiListChannelPosts,
  isApiMode,
  type ApiChannel,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { HubEmptyState } from '../components/HubEmptyState'

type Post = {
  id: string
  author_id: string
  body: string
  created_at: string
  author?: { username?: string; display_name?: string }
}

export function ChannelDetail() {
  const { id = '' } = useParams()
  const showToast = useStore((s) => s.showToast)
  const [ch, setCh] = useState<ApiChannel | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!isApiMode() || !id) return
    try {
      const [channel, list] = await Promise.all([apiGetChannel(id), apiListChannelPosts(id)])
      setCh(channel)
      setPosts(list.items ?? [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    }
  }, [id, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const toggleJoin = async () => {
    if (!ch) return
    setBusy(true)
    try {
      if (ch.joined) {
        await apiLeaveChannel(ch.id)
        showToast('Вы вышли')
      } else {
        await apiJoinChannel(ch.id)
        showToast('Вы вступили')
      }
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const onPost = async (e: FormEvent) => {
    e.preventDefault()
    if (!ch || !body.trim()) return
    setBusy(true)
    try {
      await apiCreateChannelPost(ch.id, body.trim())
      setBody('')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось опубликовать')
    } finally {
      setBusy(false)
    }
  }

  if (!ch) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-[#777]">
        {isApiMode() ? 'Загрузка…' : 'Нужен API-режим'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top border-b border-white/[0.06] px-4 py-3">
        <div className="mb-2 flex items-center gap-3">
          <Link to="/app/channels" className="text-[15px] text-[#8e8e93]">
            ← Клубы
          </Link>
          <h1 className="flex-1 text-center text-[17px] font-semibold text-white">{ch.title}</h1>
          <div className="w-14" />
        </div>
        <p className="text-[13px] text-[#8e8e93]">@{ch.slug} · {ch.members} участников</p>
        {ch.description ? <p className="mt-1 text-[14px] text-[#ccc]">{ch.description}</p> : null}
        {ch.rules ? (
          <p className="mt-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[12px] text-[#aaa]">
            Правила: {ch.rules}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleJoin()}
          className="pressable mt-3 w-full rounded-xl border border-white/20 py-2 text-[14px] font-semibold text-white"
        >
          {ch.joined ? 'Выйти' : 'Вступить'}
        </button>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
        {!posts.length && (
          <HubEmptyState title="Постов нет" subtitle="Напишите первое сообщение в клубе." />
        )}
        {posts.map((p) => (
          <article key={p.id} className="mb-3 rounded-2xl bg-white/[0.04] px-3 py-3">
            <p className="text-[12px] text-[#8e8e93]">@{p.author?.username ?? 'user'}</p>
            <p className="mt-1 whitespace-pre-wrap text-[15px] text-white">{p.body}</p>
          </article>
        ))}
      </div>

      {ch.joined ? (
        <form onSubmit={(e) => void onPost(e)} className="flex gap-2 border-t border-white/[0.06] px-3 py-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Написать в канал…"
            className="flex-1 rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none"
          />
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="rounded-xl bg-white px-4 py-2 text-[14px] font-semibold text-black disabled:opacity-40"
          >
            →
          </button>
        </form>
      ) : null}
    </div>
  )
}
