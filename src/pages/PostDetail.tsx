import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGetPost, isApiMode, type ApiFeedItem } from '../lib/api'
import { MentionText } from '../components/MentionText'
import { ShareSheet } from '../components/ShareSheet'
import { HubEmptyState } from '../components/HubEmptyState'

export function PostDetail() {
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<ApiFeedItem | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [share, setShare] = useState(false)

  useEffect(() => {
    if (!id || !isApiMode()) return
    void apiGetPost(id)
      .then(setPost)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Не найдено'))
  }, [id])

  if (!isApiMode()) {
    return <HubEmptyState title="Пост" subtitle="Доступно в API-режиме" />
  }
  if (err) return <HubEmptyState title="Пост не найден" subtitle={err} />
  if (!post) return <p className="p-6 text-center text-sm text-[#777]">Загрузка…</p>

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
        <Link to="/app" className="text-[#8e8e93]">
          ←
        </Link>
        <h1 className="text-[17px] font-semibold">Публикация</h1>
        <button type="button" className="ml-auto text-[14px] text-[#7aa2ff]" onClick={() => setShare(true)}>
          Поделиться
        </button>
      </header>
      <div className="px-4 py-4">
        <MentionText text={post.body} className="whitespace-pre-wrap text-[16px] leading-relaxed" />
        {post.image_url && (
          <img src={post.image_url} alt="" className="mt-3 max-h-[420px] w-full rounded-xl object-cover" />
        )}
        {post.original && (
          <div className="mt-3 rounded-xl border border-white/10 p-3">
            <p className="text-[12px] text-[#8e8e93]">Оригинал</p>
            <MentionText text={post.original.body} className="mt-1 block text-[14px] text-[#c7c7cc]" />
          </div>
        )}
        <p className="mt-3 text-[13px] text-[#8e8e93]">
          ♥ {post.likes} · 💬 {post.comments} · ↻ {post.reposts ?? 0}
        </p>
      </div>
      <ShareSheet open={share} onClose={() => setShare(false)} title="Поделиться постом" path={`/app/p/${post.id}`} />
    </div>
  )
}
