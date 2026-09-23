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
} from '../components/Icons'
import {
  PeopleFilterSheet,
  DEFAULT_PEOPLE_FILTERS,
  peopleFiltersActive,
  type PeopleFilters,
} from '../components/PeopleFilterSheet'
import {
  apiCreateConversation,
  apiListConversations,
  apiSearchUsers,
  isApiMode,
  type ApiConversation,
  type ApiSearchUser,
} from '../lib/api'

type Tab = 'inbox' | 'requests'
type PeopleScope = 'all' | 'following'

function isVerified(username: string) {
  return ['threads', 'anna_k', 'lena.studio'].includes(username.toLowerCase())
}

export function Messages() {
  const uid = useStore((s) => s.currentUserId)!
  const allConversations = useStore((s) => s.conversations)
  const users = useStore((s) => s.users)
  const messages = useStore((s) => s.messages)
  const showToast = useStore((s) => s.showToast)
  const [tab, setTab] = useState<Tab>('inbox')
  const navigate = useNavigate()
  const api = isApiMode()

  const [apiItems, setApiItems] = useState<ApiConversation[]>([])
  const [loading, setLoading] = useState(api)
  const [error, setError] = useState<string | null>(null)

  // People search (header)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [peopleScope, setPeopleScope] = useState<PeopleScope>('all')
  const [filters, setFilters] = useState<PeopleFilters>(DEFAULT_PEOPLE_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [people, setPeople] = useState<ApiSearchUser[]>([])
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [dmBusy, setDmBusy] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const loadApi = useCallback(async () => {
    if (!isApiMode()) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiListConversations()
      setApiItems(res.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadApi()
  }, [loadApi])

  // Light inbox refresh while Messages is open (API)
  useEffect(() => {
    if (!isApiMode()) return
    const INBOX_POLL_MS = 5000
    const h = window.setInterval(() => {
      void (async () => {
        try {
          const res = await apiListConversations()
          setApiItems(res.items ?? [])
        } catch {
          /* ignore */
        }
      })()
    }, INBOX_POLL_MS)
    return () => window.clearInterval(h)
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    const t = window.setTimeout(() => setDebouncedQ(searchQuery.trim()), 300)
    return () => window.clearTimeout(t)
  }, [searchQuery, searchOpen])

  useEffect(() => {
    if (searchOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 80)
    }
  }, [searchOpen])

  const filtersOn = peopleFiltersActive(filters)

  const runPeopleSearch = useCallback(async () => {
    if (!isApiMode()) {
      // Local fallback: filter store users
      const q = debouncedQ.toLowerCase()
      const name = filters.name.trim().toLowerCase()
      let list = users.filter((u) => u.id !== uid)
      if (q) {
        list = list.filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            u.name.toLowerCase().includes(q),
        )
      }
      if (name) {
        list = list.filter((u) => u.name.toLowerCase().includes(name))
      }
      if (!q && !name && !filtersOn && peopleScope !== 'following') {
        setPeople([])
        return
      }
      setPeople(
        list.map((u) => ({
          id: u.id,
          username: u.username,
          display_name: u.name,
          avatar_url: u.avatar,
        })),
      )
      return
    }

    if (!debouncedQ && !filtersOn && peopleScope !== 'following') {
      setPeople([])
      setPeopleError(null)
      return
    }

    setPeopleLoading(true)
    setPeopleError(null)
    try {
      const ageMin = filters.ageMin ? Number(filters.ageMin) : undefined
      const ageMax = filters.ageMax ? Number(filters.ageMax) : undefined
      const res = await apiSearchUsers({
        q: debouncedQ || undefined,
        name: filters.name.trim() || undefined,
        age_min: Number.isFinite(ageMin) ? ageMin : undefined,
        age_max: Number.isFinite(ageMax) ? ageMax : undefined,
        gender: filters.gender,
        city: filters.city || undefined,
        following: peopleScope === 'following',
        limit: 40,
      })
      setPeople(res.items ?? [])
    } catch (e) {
      setPeopleError(e instanceof Error ? e.message : 'Ошибка поиска')
      setPeople([])
    } finally {
      setPeopleLoading(false)
    }
  }, [debouncedQ, filters, filtersOn, peopleScope, uid, users])

  useEffect(() => {
    if (!searchOpen) return
    void runPeopleSearch()
  }, [searchOpen, runPeopleSearch])

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setDebouncedQ('')
    setPeople([])
    setPeopleError(null)
    setFilterOpen(false)
  }

  const startDm = async (user: ApiSearchUser) => {
    if (dmBusy) return
    setDmBusy(user.id)
    try {
      if (isApiMode()) {
        const conv = await apiCreateConversation({
          user_id: user.id,
          username: user.username,
        })
        navigate(`/app/messages/${conv.id}`)
        return
      }
      showToast('Чат только в API-режиме')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось открыть чат')
    } finally {
      setDmBusy(null)
    }
  }

  const conversations = useMemo(() => {
    return [...allConversations]
      .filter((c) => c.participantIds.includes(uid))
      .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))
  }, [allConversations, uid])

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top shrink-0 bg-black px-4 pb-3">
        <div className="flex items-center justify-between pt-1">
          {!searchOpen ? (
            <>
              <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">
                Сообщения
              </h1>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Поиск людей"
                  className="pressable flex h-10 w-10 items-center justify-center text-white"
                  onClick={() => setSearchOpen(true)}
                >
                  <IconSearch size={22} />
                </button>
                <button
                  type="button"
                  aria-label="Новое сообщение"
                  className="pressable flex h-10 w-10 items-center justify-center text-white"
                  onClick={() => navigate('/app/messages/new')}
                >
                  <IconCompose size={22} />
                </button>
              </div>
            </>
          ) : (
            <div className="people-search-bar flex w-full items-center gap-2 pt-0.5">
              <div className="people-search-field flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#1c1c1e] px-3">
                <IconSearch size={18} className="shrink-0 text-[#8e8e93]" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск людей"
                  className="h-full w-full bg-transparent text-[15px] text-white placeholder:text-[#8e8e93]"
                  autoCapitalize="none"
                  autoCorrect="off"
                  enterKeyHint="search"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    aria-label="Очистить"
                    className="shrink-0 text-[#8e8e93]"
                    onClick={() => setSearchQuery('')}
                  >
                    <IconClose size={16} />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Фильтры людей"
                className={`people-search-filter pressable relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  filtersOn ? 'bg-white text-black' : 'bg-[#1c1c1e] text-white'
                }`}
                onClick={() => setFilterOpen(true)}
              >
                <IconFilter size={18} />
                {filtersOn ? (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#0a84ff]" />
                ) : null}
              </button>
              <button
                type="button"
                className="pressable shrink-0 px-1 text-[15px] text-white"
                onClick={closeSearch}
              >
                Отмена
              </button>
            </div>
          )}
        </div>

        {!searchOpen ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('inbox')}
              className={`chip chip-invert shrink-0 ${tab === 'inbox' ? 'chip-active' : ''}`}
            >
              Входящие
            </button>
            <button
              type="button"
              onClick={() => setTab('requests')}
              className={`chip chip-invert shrink-0 ${tab === 'requests' ? 'chip-active' : ''}`}
            >
              Запросы
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPeopleScope('all')}
              className={`chip chip-invert shrink-0 ${peopleScope === 'all' ? 'chip-active' : ''}`}
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => setPeopleScope('following')}
              className={`chip chip-invert shrink-0 ${
                peopleScope === 'following' ? 'chip-active' : ''
              }`}
            >
              Подписки
            </button>
          </div>
        )}
      </header>

      <div className="no-scrollbar scroll-pad-nav flex-1 overflow-y-auto">
        {searchOpen ? (
          <>
            {peopleLoading && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">Поиск…</p>
            )}
            {!peopleLoading && peopleError && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">{peopleError}</p>
            )}
            {!peopleLoading &&
              !peopleError &&
              !debouncedQ &&
              !filtersOn &&
              peopleScope !== 'following' && (
                <p className="px-4 py-12 text-center text-[#8e8e93]">
                  Введите имя или откройте фильтры
                </p>
              )}
            {!peopleLoading &&
              !peopleError &&
              people.map((u) => (
                <div
                  key={u.id}
                  className="msg-row flex items-center gap-3 px-4 py-3"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => navigate(`/app/u/${encodeURIComponent(u.username)}`)}
                  >
                    <Avatar
                      name={u.display_name || u.username}
                      id={u.id}
                      src={u.avatar_url || undefined}
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-[15px] font-semibold text-white">
                          {u.username}
                        </p>
                        {isVerified(u.username) && (
                          <IconVerified size={14} className="shrink-0" />
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-[#8e8e93]">
                        {[u.display_name, u.city, u.age != null ? `${u.age} лет` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={dmBusy === u.id}
                    className="shrink-0 rounded-full bg-[#1c1c1e] px-3 py-1.5 text-[13px] font-semibold text-white"
                    onClick={() => void startDm(u)}
                  >
                    Написать
                  </button>
                </div>
              ))}
            {!peopleLoading &&
              !peopleError &&
              (debouncedQ || filtersOn || peopleScope === 'following') &&
              !people.length && (
                <p className="px-4 py-12 text-center text-[#8e8e93]">Никого не найдено</p>
              )}
          </>
        ) : tab === 'requests' ? (
          <p className="px-4 py-12 text-center text-[#8e8e93]">Нет запросов на переписку</p>
        ) : api ? (
          <>
            {loading && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">Загрузка…</p>
            )}
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
            {!loading &&
              !error &&
              apiItems.map((c) => {
                const other = c.peer
                const last = c.last_message
                const unread = c.unread > 0
                const uname = other.username
                return (
                  <Link
                    key={c.id}
                    to={`/app/messages/${c.id}`}
                    className="msg-row flex items-center gap-3 px-4 py-3.5"
                  >
                    <Avatar
                      name={other.display_name || other.username}
                      id={other.id}
                      src={other.avatar_url || undefined}
                      size={52}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-[15px] font-semibold text-white">{uname}</p>
                        {isVerified(uname) && <IconVerified size={14} className="shrink-0" />}
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
            {!loading && !error && !apiItems.length && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">Нет диалогов</p>
            )}
          </>
        ) : (
          <>
            {conversations.map((c) => {
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
                    <div className="flex items-center gap-1">
                      <p className="truncate text-[15px] font-semibold text-white">
                        {other.username}
                      </p>
                      {isVerified(other.username) && (
                        <IconVerified size={14} className="shrink-0" />
                      )}
                    </div>
                    <p
                      className={`mt-0.5 truncate text-[14px] leading-snug ${
                        unread ? 'text-[#c8c8c8]' : 'text-[#8e8e93]'
                      }`}
                    >
                      {last?.text ?? 'Нет сообщений'}
                      {last && (
                        <span className="text-[#8e8e93]">
                          {' '}
                          · {formatTimeAgo(last.createdAt)}
                        </span>
                      )}
                    </p>
                  </div>
                  {unread ? <span className="unread-dot" aria-label="Непрочитано" /> : null}
                </Link>
              )
            })}
            {!conversations.length && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">Нет диалогов</p>
            )}
          </>
        )}
      </div>

      <PeopleFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={setFilters}
      />
    </div>
  )
}
