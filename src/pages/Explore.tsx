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
    <div className="flex h-full flex-col bg-[var(--hub-app-bg,#000)] text-hub-text">
      <header className="hub-screen-header shrink-0 px-3">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-hub-text">Поиск</h1>
        <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); load(q.trim(), tag) }}>
          <div className="hub-search-pill flex-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Люди, посты, теги…"
              className="placeholder:text-hub-muted" />
          </div>
          <button type="submit" className="hub-circle-btn bg-white text-black text-[13px] font-semibold w-auto px-4">Найти</button>
        </form>
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((t) => (
              <button key={t.tag} type="button" onClick={() => { setTag(t.tag); setQ(t.tag); load(t.tag) }}
                className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${tag === t.tag ? 'bg-white text-black' : 'bg-[#2c2c2e] text-[#c7c7cc]'}`}>
                #{t.tag} · {t.count}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto scroll-pad-nav">
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
                    <li key={a.id} className="rounded-2xl bg-[#1c1c1e] px-3 py-2.5">
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
                      <MentionText text={p.body} className="break-words whitespace-pre-wrap text-[15px] text-white" />
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
