import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HubEmptyState } from '../components/HubEmptyState'
import { apiExplore, apiSearchUsers, isApiMode, type ApiFeedItem, type ApiSearchUser } from '../lib/api'
import { MentionText } from '../components/MentionText'

export function Explore() {
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [posts, setPosts] = useState<ApiFeedItem[]>([])
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [people, setPeople] = useState<ApiSearchUser[]>([])
  const [loading, setLoading] = useState(true)

  const load = (query?: string, t?: string) => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    setLoading(true)
    void Promise.all([
      apiExplore({ q: query || undefined, tag: t || undefined, limit: 30 }),
      query ? apiSearchUsers({ q: query, limit: 10 }) : Promise.resolve({ items: [] as ApiSearchUser[] }),
    ])
      .then(([ex, pe]) => {
        setPosts(ex.items ?? [])
        setTags(ex.tags ?? [])
        setPeople(pe.items ?? [])
      })
      .catch(() => {
        setPosts([])
        setTags([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="shrink-0 border-b border-white/[0.08] px-4 py-3">
        <h1 className="text-[20px] font-bold">Интересное</h1>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            load(q.trim(), tag)
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск постов и людей"
            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[15px] text-white placeholder:text-[#636366]"
          />
          <button type="submit" className="h-10 rounded-xl bg-white px-4 text-[14px] font-semibold text-black">
            Найти
          </button>
        </form>
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => {
                  setTag(t.tag)
                  load(q.trim(), t.tag)
                }}
                className={`rounded-full px-3 py-1 text-[12px] ${
                  tag === t.tag ? 'bg-white text-black' : 'bg-[#1c1c1e] text-[#c7c7cc]'
                }`}
              >
                #{t.tag} · {t.count}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-sm text-[#777]">Загрузка…</p>
        ) : (
          <>
            {people.length > 0 && (
              <section className="border-b border-white/[0.06] px-4 py-3">
                <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#8e8e93]">Люди</h2>
                <ul className="space-y-2">
                  {people.map((u) => (
                    <li key={u.id}>
                      <Link to={`/app/u/${encodeURIComponent(u.username)}`} className="flex items-center gap-3">
                        <span className="text-[15px] font-semibold text-white">{u.display_name || u.username}</span>
                        <span className="text-[13px] text-[#8e8e93]">@{u.username}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {posts.length === 0 ? (
              <HubEmptyState
                title="Пока пусто"
                subtitle="Попробуйте другой запрос или откройте ленту подписок"
              />
            ) : (
              <ul>
                {posts.map((p) => (
                  <li key={p.id} className="border-b border-white/[0.06] px-4 py-3">
                    <Link to={`/app/p/${p.id}`} className="block">
                      <MentionText text={p.body} className="whitespace-pre-wrap text-[15px] text-white" />
                      <div className="mt-2 text-[12px] text-[#8e8e93]">
                        ♥ {p.likes} · 💬 {p.comments}
                        {p.tags?.length ? ` · ${p.tags.map((t) => `#${t}`).join(' ')}` : ''}
                      </div>
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
