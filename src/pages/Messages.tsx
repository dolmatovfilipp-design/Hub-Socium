import { ListSkeleton } from '../components/Skeleton'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { formatTimeAgo } from '../utils/validation'
import {
  IconCompose,
  IconFilter,
  IconSearch,
  IconVerified,
  IconClose,
  IconStar,
} from '../components/Icons'
import { HubEmptyState } from '../components/HubEmptyState'
import {
  apiGetSavedMessages,
  apiListConversations,
  apiListMessages,
  isApiMode,
  type ApiConversation,
} from '../lib/api'
import { cacheGet, cacheSet } from '../lib/listCache'
import { createPortal } from 'react-dom'

const prefetchConv = (id: string) => {
  if (!isApiMode()) return
  const key = 'msgs_' + id
  if (cacheGet(key, 30_000)) return
  void apiListMessages(id, 50)
    .then((r) => cacheSet(key, r))
    .catch(() => {})
}

type InboxFilter = 'all' | 'unread' | 'unanswered' | 'verified'

export function Messages() {
  const uid = useStore((s) => s.currentUserId)!
  const allConversations = useStore((s) => s.conversations)
  const users = useStore((s) => s.users)
  const messages = useStore((s) => s.messages)
  const showToast = useStore((s) => s.showToast)
  const navigate = useNavigate()
  const api = isApiMode()

  const [apiItems, setApiItems] = useState<ApiConversation[]>(() => {
    if (!isApiMode()) return []
    return cacheGet<ApiConversation[]>('conversations_inbox', 120_000) ?? []
  })
  const [loading, setLoading] = useState(() => {
    if (!api) return false
    const cached = cacheGet<ApiConversation[]>('conversations_inbox', 120_000)
    return !(cached && cached.length > 0)
  })
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterBtnRef = useRef<HTMLButtonElement>(null)
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null)

  const loadApi = useCallback(async () => {
    if (!isApiMode()) return
    const cacheKey = 'conversations_inbox'
    const cached = cacheGet<ApiConversation[]>(cacheKey, 120_000)
    if (cached?.length) {
      setApiItems(cached)
      setLoading(false)
    } else if (!cached) {
      setLoading(true)
    }
    setError(null)
    try {
      const res = await apiListConversations()
      const items = res.items ?? []
      setApiItems(items)
      cacheSet(cacheKey, items)
    } catch (e) {
      if (!cached?.length) setError(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadApi()
  }, [loadApi])

  useEffect(() => {
    if (!isApiMode()) return
    const POLL_MS = 5000
    const h = window.setInterval(() => {
      void apiListConversations()
        .then((res) => {
          const items = res.items ?? []
          setApiItems(items)
          cacheSet('conversations_inbox', items)
        })
        .catch(() => {})
    }, POLL_MS)
    return () => window.clearInterval(h)
  }, [])

  const openFilter = () => {
    const el = filterBtnRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      const shell = document.getElementById('hub-phone-shell')
      const shellRect = shell?.getBoundingClientRect()
      const top = shellRect ? r.bottom - shellRect.top + 6 : r.bottom + 6
      const left = shellRect ? r.left - shellRect.left : r.left
      setFilterPos({ top, left })
    }
    setFilterOpen(true)
  }

  const q = query.trim().toLowerCase()

  const filteredApi = useMemo(() => {
    let list = apiItems
    if (q) {
      list = list.filter((c) => {
        const title = (c.is_group ? c.title : c.peer?.username) || ''
        const body = c.last_message?.body || ''
        return (
          title.toLowerCase().includes(q) ||
          (c.peer?.display_name || '').toLowerCase().includes(q) ||
          body.toLowerCase().includes(q)
        )
      })
    }
    if (inboxFilter === 'unread') list = list.filter((c) => c.unread > 0)
    if (inboxFilter === 'verified') list = list.filter((c) => !c.is_group && !!c.peer?.is_verified)
    if (inboxFilter === 'unanswered') {
      list = list.filter((c) => {
        if (!c.last_message) return false
        return c.last_message.sender_id !== uid
      })
    }
    return list
  }, [apiItems, q, inboxFilter, uid])

  const localConversations = useMemo(() => {
    let list = [...allConversations]
      .filter((c) => c.participantIds.includes(uid))
      .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))
    if (q) {
      list = list.filter((c) => {
        const otherId = c.participantIds.find((id) => id !== uid)
        const other = users.find((u) => u.id === otherId)
        if (!other) return false
        return (
          other.username.toLowerCase().includes(q) ||
          other.name.toLowerCase().includes(q)
        )
      })
    }
    return list
  }, [allConversations, uid, users, q])

  const filterLabels: Record<InboxFilter, string> = {
    all: 'Все',
    unread: 'Непрочитанные',
    unanswered: 'Без ответа',
    verified: 'Подтверждено',
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="hub-screen-header shrink-0 px-3 pb-2">
        <div className="flex items-center justify-between gap-2 pt-1">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">
            Сообщения
          </h1>
          <button
            type="button"
            aria-label="Новое сообщение"
            className="hub-circle-btn"
            onClick={() => navigate('/app/messages/new')}
          >
            <IconCompose size={20} />
          </button>
        </div>

        <div className="hub-search-pill mt-3">
          <IconSearch size={18} className="shrink-0 text-[#8e8e93]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
          />
          {query ? (
            <button
              type="button"
              aria-label="Очистить"
              className="shrink-0 text-[#8e8e93]"
              onClick={() => setQuery('')}
            >
              <IconClose size={16} />
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            ref={filterBtnRef}
            type="button"
            aria-label="Фильтр"
            className={`hub-circle-btn h-9 w-9 ${inboxFilter !== 'all' ? 'bg-white text-black' : ''}`}
            onClick={() => (filterOpen ? setFilterOpen(false) : openFilter())}
          >
            <IconFilter size={16} />
          </button>
          <button
            type="button"
            className="chip chip-invert chip-active shrink-0"
          >
            Входящие
          </button>
          <button
            type="button"
            className="chip chip-invert shrink-0"
            onClick={() => navigate('/app/messages/requests')}
          >
            Запросы
          </button>
        </div>
      </header>

      <div className="no-scrollbar scroll-pad-nav flex-1 overflow-y-auto">
        {api ? (
          <>
            {loading && <ListSkeleton rows={8} />}
            {!loading && error && (
              <div className="px-4 py-12 text-center">
                <p className="text-[#8e8e93]">{error}</p>
                <button
                  type="button"
                  className="mt-3 text-sm text-white underline"
                  onClick={() => void loadApi()}
                >
                  Повторить
                </button>
              </div>
            )}

            {!loading && !error && (
              <button
                type="button"
                className="msg-row flex w-full items-center gap-3 px-4 py-3.5 text-left"
                onClick={() => {
                  void apiGetSavedMessages()
                    .then((c) => navigate(`/app/messages/${c.id}`))
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Избранное недоступно'))
                }}
              >
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.06] text-white">
                  <IconStar size={22} strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-white">Избранное</p>
                  <p className="mt-0.5 truncate text-[14px] text-[#8e8e93]">Переслать себе</p>
                </div>
              </button>
            )}

            {!loading &&
              !error &&
              filteredApi.map((c) => {
                const other = c.peer
                const last = c.last_message
                const unread = c.unread > 0
                const isGroup = !!c.is_group
                const title = isGroup
                  ? (c.title || other.display_name || 'Группа')
                  : other.username
                const avatarSrc = isGroup
                  ? (c.avatar_url || other.avatar_url || undefined)
                  : (other.avatar_url || undefined)
                const avatarId = isGroup ? c.id : other.id
                return (
                  <Link
                    key={c.id}
                    to={`/app/messages/${c.id}`}
                    className="msg-row flex items-center gap-3 px-4 py-3.5"
                    onMouseEnter={() => prefetchConv(c.id)}
                    onPointerDown={() => prefetchConv(c.id)}
                  >
                    <Avatar name={title} id={avatarId} src={avatarSrc} size={52} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-[15px] font-semibold text-white">{title}</p>
                        {!isGroup && other.is_verified ? (
                          <IconVerified size={14} className="shrink-0" />
                        ) : null}
                      </div>
                      <p
                        className={`mt-0.5 truncate text-[14px] leading-snug ${
                          unread ? 'text-[#c8c8c8]' : 'text-[#8e8e93]'
                        }`}
                      >
                        {last?.body ?? 'Нет сообщений'}
                        {last && (
                          <span className="text-[#8e8e93]">
                            {' '}
                            · {formatTimeAgo(last.created_at)}
                          </span>
                        )}
                      </p>
                    </div>
                    {unread ? (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-black">
                        {c.unread > 99 ? '99+' : c.unread}
                      </span>
                    ) : null}
                  </Link>
                )
              })}

            {!loading && !error && !filteredApi.length && (
              <HubEmptyState
                title="Пока нет диалогов"
                subtitle="Напишите первым через новое сообщение"
              />
            )}
          </>
        ) : (
          <>
            {localConversations.map((c) => {
              const otherId = c.participantIds.find((id) => id !== uid)!
              const other = users.find((u) => u.id === otherId)
              if (!other) return null
              const thread = messages.filter((m) => m.conversationId === c.id)
              const last = thread[thread.length - 1]
              const unread = thread.some((m) => !m.read && m.senderId !== uid)
              return (
                <Link
                  key={c.id}
                  to={`/app/messages/${c.id}`}
                  className="msg-row flex items-center gap-3 px-4 py-3.5"
                >
                  <Avatar name={other.name} id={other.id} src={other.avatar} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-white">{other.username}</p>
                    <p
                      className={`mt-0.5 truncate text-[14px] leading-snug ${
                        unread ? 'text-[#c8c8c8]' : 'text-[#8e8e93]'
                      }`}
                    >
                      {last?.text ?? 'Нет сообщений'}
                      {last && (
                        <span className="text-[#8e8e93]"> · {formatTimeAgo(last.createdAt)}</span>
                      )}
                    </p>
                  </div>
                  {unread ? <span className="unread-dot" aria-label="Непрочитано" /> : null}
                </Link>
              )
            })}
            {!localConversations.length && (
              <HubEmptyState
                title="Пока нет диалогов"
                subtitle="Напишите первым через новое сообщение"
              />
            )}
          </>
        )}
      </div>

      {filterOpen &&
        createPortal(
          <div className="pointer-events-auto absolute inset-0 z-[var(--hub-z-sheet)]">
            <button
              type="button"
              className="absolute inset-0 bg-transparent"
              aria-label="Закрыть фильтр"
              onClick={() => setFilterOpen(false)}
            />
            <div
              className="absolute min-w-[200px] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1c1c1e]/95 shadow-2xl backdrop-blur-xl"
              style={{
                top: filterPos?.top ?? 120,
                left: Math.max(12, filterPos?.left ?? 12),
              }}
              role="menu"
            >
              <p className="px-4 pb-1 pt-3 text-[12px] font-medium text-[#8e8e93]">Фильтр</p>
              {(Object.keys(filterLabels) as InboxFilter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-white active:bg-white/[0.06]"
                  onClick={() => {
                    setInboxFilter(key)
                    setFilterOpen(false)
                  }}
                >
                  <span className="w-4 shrink-0 text-white">
                    {inboxFilter === key ? '✓' : ''}
                  </span>
                  {filterLabels[key]}
                </button>
              ))}
              <div className="h-2" />
            </div>
          </div>,
          document.getElementById('hub-overlay-root') ?? document.body,
        )}
    </div>
  )
}
