import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HubEmptyState } from '../components/HubEmptyState'
import { apiExplore, apiUnifiedSearch, isApiMode, type ApiFeedItem } from '../lib/api'
import { FeedSkeleton } from '../components/Skeleton'
import { MentionText } from '../components/MentionText'

export function Explore() {
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [posts, setPosts] = useState<ApiFeedItem[]>([])
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [people, setPeople] = useState<any[]>([])
  const [ads, setAds] = useState<any[]>([])
  const [emptyReason, setEmptyReason] = useState('')
  const [loading, setLoading] = useState(true)

  const load = (query?: string, t?: string) => {
    if (!isApiMode()) { setLoading(false); return }
    setLoading(true)
    const qq = (query ?? '').trim()
    if (qq) {
      void apiUnifiedSearch(qq)
        .then((res) => {
          setPeople(res.people ?? [])
          setPosts((res.posts as ApiFeedItem[]) ?? [])
          setTags(res.tags ?? [])
          setAds(res.ads ?? [])
          setEmptyReason(res.empty_reason ?? '')
        })
        .catch(() => { setEmptyReason('Поиск временно недоступен') })
        .finally(() => setLoading(false))
      return
    }
    void apiExplore({ tag: t || undefined, limit: 30 })
      .then((ex) => {
        setPosts(ex.items ?? [])
        setTags(ex.tags ?? [])
        setPeople([])
        setAds([])
        setEmptyReason('')
      })
      .catch(() => { setPosts([]); setEmptyReason('Не удалось загрузить') })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const nothing = !people.length && !posts.length && !ads.length

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="shrink-0 border-b border-white/[0.08] px-4 py-3">
        <h1 className="text-[20px] font-bold">Поиск</h1>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); load(q.trim(), tag) }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Люди, посты, теги, объявления"
            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[15px] text-white placeholder:text-[#636366]" />
          <button type="submit" className="h-10 rounded-xl bg-white px-4 text-[14px] font-semibold text-black">Найти</button>
        </form>
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((t) => (
              <button key={t.tag} type="button" onClick={() => { setTag(t.tag); setQ(t.tag); load(t.tag) }}
                className={`rounded-full px-3 py-1 text-[12px] ${tag === t.tag ? 'bg-white text-black' : 'bg-[#1c1c1e] text-[#c7c7cc]'}`}>
                #{t.tag} · {t.count}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <FeedSkeleton count={4} />
        ) : (
          <>
            {people.length > 0 && (
              <section className="border-b border-white/[0.06] px-4 py-3">
                <h2 className="mb-2 text-[13px] font-semibold uppercase text-[#8e8e93]">Люди</h2>
                <ul className="space-y-2">
                  {people.map((u) => (
                    <li key={u.id}>
                      <Link to={`/app/u/${encodeURIComponent(u.username)}`} className="flex items-center gap-3">
                        <span className="font-semibold">{u.display_name || u.username}</span>
                        <span className="text-[13px] text-[#8e8e93]">@{u.username}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {ads.length > 0 && (
              <section className="border-b border-white/[0.06] px-4 py-3">
                <h2 className="mb-2 text-[13px] font-semibold uppercase text-[#8e8e93]">Объявления</h2>
                <ul className="space-y-2">
                  {ads.map((a) => (
                    <li key={a.id} className="rounded-xl bg-white/[0.04] px-3 py-2">
                      <p className="font-semibold">{a.title}</p>
                      <p className="text-[13px] text-[#8e8e93]">{a.city} · {a.price} ₽</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {nothing ? (
              <HubEmptyState title="Пока пусто" subtitle={emptyReason || 'Попробуйте другой запрос или откройте ленту'} />
            ) : (
              <ul>
                {posts.map((p) => (
                  <li key={p.id} className="border-b border-white/[0.06] px-4 py-3">
                    <Link to={`/app/p/${p.id}`} className="block">
                      <MentionText text={p.body} className="whitespace-pre-wrap text-[15px] text-white" />
                      <div className="mt-2 text-[12px] text-[#8e8e93]">♥ {p.likes ?? 0}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
