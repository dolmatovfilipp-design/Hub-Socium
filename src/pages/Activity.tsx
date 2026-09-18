import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { formatCount, formatTimeAgo } from '../utils/validation'
import { IconHeart, IconReply, IconRepost, IconShare, IconMore } from '../components/Icons'
import type { ActivityType } from '../types'
import {
  apiListActivity,
  apiMarkActivityRead,
  isApiMode,
  type ApiActivityItem,
} from '../lib/api'

type Filter = 'all' | 'follows' | 'replies' | 'mentions'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'follows', label: 'Подписки' },
  { id: 'replies', label: 'Переписки' },
  { id: 'mentions', label: 'Упоминания' },
]

const contextLine: Record<ActivityType, string> = {
  like: 'На основе ваших подписок',
  follow: 'Новая подписка',
  mention: 'Упоминание',
  reply: 'Пропущенная переписка',
  repost: 'Рекомендуемая ветка',
}

const labels: Record<ActivityType, string> = {
  like: 'нравится ваша публикация',
  follow: 'подписался(ась) на вас',
  mention: 'упомянул(а) вас',
  reply: 'ответил(а) вам',
  repost: 'сделал(а) репост',
}

function normalizeType(t: string): ActivityType {
  if (t === 'comment') return 'reply'
  if (t === 'like' || t === 'follow' || t === 'mention' || t === 'reply' || t === 'repost') {
    return t
  }
  return 'like'
}

export function Activity() {
  const [filter, setFilter] = useState<Filter>('all')
  const allActivities = useStore((s) => s.activities)
  const users = useStore((s) => s.users)
  const posts = useStore((s) => s.posts)
  const markRead = useStore((s) => s.markActivitiesRead)
  const api = isApiMode()

  const [apiItems, setApiItems] = useState<ApiActivityItem[]>([])
  const [loading, setLoading] = useState(api)
  const [error, setError] = useState<string | null>(null)

  const loadApi = useCallback(async (f: Filter) => {
    if (!isApiMode()) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiListActivity(f, 30)
      setApiItems(res.items ?? [])
      try {
        await apiMarkActivityRead({ all: true })
      } catch {
        // ignore
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (api) void loadApi(filter)
  }, [api, filter, loadApi])

  const activities = useMemo(() => {
    const sorted = [...allActivities].sort(
      (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    )
    if (filter === 'follows') return sorted.filter((a) => a.type === 'follow')
    if (filter === 'replies') return sorted.filter((a) => a.type === 'reply')
    if (filter === 'mentions') return sorted.filter((a) => a.type === 'mention')
    return sorted
  }, [allActivities, filter])

  useEffect(() => {
    if (!api) markRead()
  }, [api, markRead])

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top shrink-0 bg-black px-4 pb-2">
        <h1 className="pt-2 text-[28px] font-bold tracking-tight text-white">Действия</h1>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`chip ${filter === f.id ? 'chip-active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="no-scrollbar scroll-pad-nav flex-1 overflow-y-auto">
        {api ? (
          <>
            {loading && <p className="px-4 py-12 text-center text-[#777]">Загрузка…</p>}
            {!loading && error && (
              <div className="px-4 py-12 text-center">
                <p className="text-[#777]">{error}</p>
                <button
                  type="button"
                  className="mt-3 text-sm text-white underline"
                  onClick={() => void loadApi(filter)}
                >
                  Повторить
                </button>
              </div>
            )}
            {!loading && !error && apiItems.length > 0 && (
              <p className="px-4 pb-2 pt-3 text-[13px] font-medium text-[#777]">
                Последние 7 дней
              </p>
            )}
            {!loading &&
              !error &&
              apiItems.map((a) => {
                const actor = a.actor
                const typ = normalizeType(a.type)
                const text =
                  typeof a.meta?.text === 'string' ? a.meta.text : undefined
                return (
                  <div key={a.id} className="animate-fade-in px-4 py-3">
                    <div className="flex gap-3">
                      <Link to={`/app/profile/${actor.id}`} className="shrink-0">
                        <Avatar
                          name={actor.display_name || actor.username}
                          id={actor.id}
                          src={actor.avatar_url || undefined}
                          size={36}
                        />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Link
                            to={`/app/profile/${actor.id}`}
                            className="truncate text-[15px] font-semibold text-white"
                          >
                            {actor.display_name || actor.username}
                          </Link>
                          <span className="shrink-0 text-[13px] text-[#777]">
                            {formatTimeAgo(a.created_at)}
                          </span>
                          <button
                            type="button"
                            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center text-[#777]"
                            aria-label="Ещё"
                          >
                            <IconMore size={18} />
                          </button>
                        </div>
                        <p className="text-[13px] text-[#777]">{contextLine[typ]}</p>
                        <p className="mt-1 text-[15px] leading-snug text-white">
                          <span className="font-medium">
                            {actor.display_name || actor.username}
                          </span>{' '}
                          <span className="text-[#a8a8a8]">{labels[typ]}</span>
                          {text ? (
                            <span className="text-[#a8a8a8]">: «{text}»</span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            {!loading && !error && !apiItems.length && (
              <p className="px-4 py-12 text-center text-[#777]">Пока тихо</p>
            )}
          </>
        ) : (
          <>
            {activities.length > 0 && (
              <p className="px-4 pb-2 pt-3 text-[13px] font-medium text-[#777]">
                Последние 7 дней
              </p>
            )}

            {activities.map((a) => {
              const actor = users.find((u) => u.id === a.actorId)
              if (!actor) return null
              const post = a.targetPostId
                ? posts.find((p) => p.id === a.targetPostId)
                : undefined

              return (
                <div key={a.id} className="animate-fade-in px-4 py-3">
                  <div className="flex gap-3">
                    <Link to={`/app/profile/${actor.id}`} className="shrink-0">
                      <Avatar name={actor.name} id={actor.id} src={actor.avatar} size={36} />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/app/profile/${actor.id}`}
                          className="truncate text-[15px] font-semibold text-white"
                        >
                          {actor.name}
                        </Link>
                        <span className="shrink-0 text-[13px] text-[#777]">
                          {formatTimeAgo(a.createdAt)}
                        </span>
                        <button
                          type="button"
                          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center text-[#777]"
                          aria-label="Ещё"
                        >
                          <IconMore size={18} />
                        </button>
                      </div>
                      <p className="text-[13px] text-[#777]">{contextLine[a.type]}</p>
                      <p className="mt-1 text-[15px] leading-snug text-white">
                        <span className="font-medium">{actor.name}</span>{' '}
                        <span className="text-[#a8a8a8]">{labels[a.type]}</span>
                        {a.text ? (
                          <span className="text-[#a8a8a8]">: «{a.text}»</span>
                        ) : null}
                      </p>
                      {post && (
                        <div className="mt-2 flex gap-2">
                          <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-snug text-[#a8a8a8]">
                            {post.text}
                          </p>
                          {post.image && (
                            <img
                              src={post.image}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-xl object-cover"
                              loading="lazy"
                            />
                          )}
                        </div>
                      )}
                      {post && (
                        <div className="mt-2.5 flex items-center gap-5 text-[#777]">
                          <span className="flex items-center gap-1.5">
                            <IconHeart size={16} />
                            <span className="text-[12px]">{formatCount(post.likes.length)}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <IconReply size={16} />
                            <span className="text-[12px]">{formatCount(post.replies.length)}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <IconRepost size={16} />
                            <span className="text-[12px]">{formatCount(post.reposts.length)}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <IconShare size={15} />
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {!activities.length && (
              <p className="px-4 py-12 text-center text-[#777]">Пока тихо</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
