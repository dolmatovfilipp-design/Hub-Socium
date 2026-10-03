import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { HubEmptyState } from '../components/HubEmptyState'
import { IconChevron, IconSearch, IconVerified } from '../components/Icons'
import { FeedSkeleton } from '../components/Skeleton'
import {
  apiSearchUsers,
  apiUnifiedSearch,
  isApiMode,
  type ApiFeedItem,
  type ApiSearchUser,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { formatCount } from '../utils/validation'
import { MentionText } from '../components/MentionText'

function followersLabel(n?: number): string {
  if (n == null || n <= 0) return '0 подписчиков'
  const base = formatCount(n) || String(n)
  const mod10 = n % 10
  const mod100 = n % 100
  let word = 'подписчиков'
  if (mod10 === 1 && mod100 !== 11) word = 'подписчик'
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = 'подписчика'
  return `${base} ${word}`
}

export function Explore() {
  const navigate = useNavigate()
  const currentId = useStore((s) => s.currentUserId)
  const followingIds = useStore((s) => s.followingIds)
  const followUser = useStore((s) => s.followUser)
  const unfollowUser = useStore((s) => s.unfollowUser)
  const showToast = useStore((s) => s.showToast)
  const storeUsers = useStore((s) => s.users)

  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [suggested, setSuggested] = useState<ApiSearchUser[]>([])
  const [people, setPeople] = useState<ApiSearchUser[]>([])
  const [posts, setPosts] = useState<ApiFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 280)
    return () => window.clearTimeout(t)
  }, [q])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        if (debounced) {
          if (isApiMode()) {
            const res = await apiUnifiedSearch(debounced)
            if (cancelled) return
            setPeople((res.people as ApiSearchUser[]) ?? [])
            setPosts((res.posts as ApiFeedItem[]) ?? [])
          } else {
            const qq = debounced.toLowerCase()
            const hits = storeUsers
              .filter(
                (u) =>
                  u.id !== currentId &&
                  (u.username.toLowerCase().includes(qq) || u.name.toLowerCase().includes(qq)),
              )
              .map((u) => ({
                id: u.id,
                username: u.username,
                display_name: u.name,
                avatar_url: u.avatar,
                followers: u.followers,
                is_verified: false,
                is_following: followingIds.includes(u.id),
              }))
            if (cancelled) return
            setPeople(hits)
            setPosts([])
          }
          return
        }

        // Recommended subscriptions
        if (isApiMode()) {
          const res = await apiSearchUsers({ q: '', limit: 30 })
          if (cancelled) return
          setSuggested(
            (res.items || [])
              .filter((u) => u.id !== currentId)
              .slice(0, 24),
          )
        } else {
          setSuggested(
            storeUsers
              .filter((u) => u.id !== currentId)
              .slice(0, 24)
              .map((u) => ({
                id: u.id,
                username: u.username,
                display_name: u.name,
                avatar_url: u.avatar,
                followers: u.followers,
                is_following: followingIds.includes(u.id),
              })),
          )
        }
        setPeople([])
        setPosts([])
      } catch {
        if (!cancelled) {
          setSuggested([])
          setPeople([])
          setPosts([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debounced, currentId, storeUsers, followingIds])

  const list = useMemo(
    () => (debounced ? people : suggested),
    [debounced, people, suggested],
  )

  const onFollow = async (u: ApiSearchUser) => {
    if (busyId) return
    setBusyId(u.id)
    try {
      const following = followingIds.includes(u.id) || !!u.is_following
      const res = following ? await unfollowUser(u.id) : await followUser(u.id)
      if (!res.ok) {
        showToast(res.error ?? 'Ошибка')
        return
      }
      const nextFollowing = !following
      const patch = (arr: ApiSearchUser[]) =>
        arr.map((x) => (x.id === u.id ? { ...x, is_following: nextFollowing } : x))
      setSuggested(patch)
      setPeople(patch)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="hub-screen-header shrink-0 px-3 pb-2">
        <div className="flex items-center gap-1 pt-1">
          <button
            type="button"
            className="hub-circle-btn"
            aria-label="Назад"
            onClick={() => navigate(-1)}
          >
            <IconChevron size={20} className="-scale-x-100" />
          </button>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">Поиск</h1>
        </div>
        <div className="hub-search-pill mt-3">
          <IconSearch size={18} className="shrink-0 text-[#8e8e93]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
          />
        </div>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto scroll-pad-nav">
        {loading ? (
          <FeedSkeleton count={4} />
        ) : (
          <>
            {!debounced ? (
              <p className="px-4 pb-2 pt-3 text-[13px] font-semibold text-[#8e8e93]">
                Рекомендуемые подписки
              </p>
            ) : people.length > 0 ? (
              <p className="px-4 pb-2 pt-3 text-[13px] font-semibold text-[#8e8e93]">Люди</p>
            ) : null}

            {list.map((u) => {
              const following = followingIds.includes(u.id) || !!u.is_following
              const mutuals = storeUsers.filter((x) => x.id !== u.id && x.id !== currentId).slice(0, 2)
              return (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <Link
                    to={`/app/u/${encodeURIComponent(u.username)}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <Avatar
                      name={u.display_name || u.username}
                      id={u.id}
                      src={u.avatar_url || undefined}
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-[15px] font-semibold text-white">{u.username}</p>
                        {u.is_verified ? <IconVerified size={14} className="shrink-0" /> : null}
                      </div>
                      <p className="truncate text-[13px] text-[#8e8e93]">{u.display_name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {mutuals.length > 0 ? (
                          <span className="flex items-center pl-0.5">
                            {mutuals.map((m, i) => (
                              <span
                                key={m.id}
                                className="relative inline-block"
                                style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 2 - i }}
                              >
                                <Avatar name={m.name} id={m.id} src={m.avatar} size={14} />
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <span className="truncate text-[12px] text-[#8e8e93]">
                          {followersLabel(u.followers)}
                        </span>
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    disabled={busyId === u.id}
                    onClick={() => void onFollow(u)}
                    className={`shrink-0 rounded-xl px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${
                      following
                        ? 'bg-[#1c1c1e] text-white'
                        : 'bg-white text-black'
                    }`}
                  >
                    {busyId === u.id ? '…' : following ? 'Вы подписаны' : 'Подписаться'}
                  </button>
                </div>
              )
            })}

            {debounced && posts.length > 0 ? (
              <section className="border-t border-white/[0.06] pt-2">
                <p className="px-4 pb-2 pt-2 text-[13px] font-semibold text-[#8e8e93]">Публикации</p>
                <ul>
                  {posts.map((p) => (
                    <li key={p.id} className="border-b border-white/[0.06] px-4 py-3">
                      <Link to={`/app/p/${p.id}`} className="block">
                        <MentionText
                          text={p.body}
                          className="break-words whitespace-pre-wrap text-[15px] text-white"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {!loading && !list.length && !posts.length ? (
              <HubEmptyState
                title={debounced ? 'Ничего не найдено' : 'Пока нет рекомендаций'}
                subtitle={debounced ? 'Попробуйте другой запрос' : 'Подпишитесь на людей в Get Hub'}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
