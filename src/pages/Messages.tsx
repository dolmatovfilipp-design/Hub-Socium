import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { formatTimeAgo } from '../utils/validation'
import { IconCompose, IconSearch, IconSliders } from '../components/Icons'
import {
  apiListConversations,
  isApiMode,
  type ApiConversation,
} from '../lib/api'

type Tab = 'inbox' | 'requests'

export function Messages() {
  const uid = useStore((s) => s.currentUserId)!
  const allConversations = useStore((s) => s.conversations)
  const users = useStore((s) => s.users)
  const messages = useStore((s) => s.messages)
  const [tab, setTab] = useState<Tab>('inbox')
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const api = isApiMode()

  const [apiItems, setApiItems] = useState<ApiConversation[]>([])
  const [loading, setLoading] = useState(api)
  const [error, setError] = useState<string | null>(null)

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

  const conversations = useMemo(() => {
    const list = [...allConversations]
      .filter((c) => c.participantIds.includes(uid))
      .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))

    if (!query.trim()) return list
    const q = query.trim().toLowerCase()
    return list.filter((c) => {
      const otherId = c.participantIds.find((id) => id !== uid)
      const other = users.find((u) => u.id === otherId)
      if (!other) return false
      return (
        other.name.toLowerCase().includes(q) ||
        other.username.toLowerCase().includes(q)
      )
    })
  }, [allConversations, uid, query, users])

  const filteredApi = useMemo(() => {
    if (!query.trim()) return apiItems
    const q = query.trim().toLowerCase()
    return apiItems.filter((c) => {
      const p = c.peer
      return (
        p.display_name.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q)
      )
    })
  }, [apiItems, query])

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top shrink-0 bg-black px-4 pb-2">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-[28px] font-bold tracking-tight text-white">Сообщения</h1>
          <button
            type="button"
            aria-label="Новое сообщение"
            className="pressable flex h-10 w-10 items-center justify-center text-white"
            onClick={() => {
              if (api) {
                void loadApi()
                return
              }
              const other = users.find((u) => u.id !== uid)
              if (other) navigate(`/app/messages`)
            }}
          >
            <IconCompose size={22} />
          </button>
        </div>

        <div className="mt-3 flex h-10 items-center gap-2 rounded-xl bg-[#1a1a1a] px-3">
          <IconSearch size={18} className="shrink-0 text-[#777]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="h-full w-full bg-transparent text-[15px] text-white placeholder:text-[#777]"
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="chip flex !h-8 !w-8 !items-center !justify-center !p-0"
            aria-label="Фильтр"
          >
            <IconSliders size={16} />
          </button>
          <button
            type="button"
            onClick={() => setTab('inbox')}
            className={`chip ${tab === 'inbox' ? 'chip-active' : ''}`}
          >
            Входящие
          </button>
          <button
            type="button"
            onClick={() => setTab('requests')}
            className={`chip ${tab === 'requests' ? 'chip-active' : ''}`}
          >
            Запросы
          </button>
        </div>
      </header>

      <div className="no-scrollbar scroll-pad-nav flex-1 overflow-y-auto">
        {tab === 'requests' ? (
          <p className="px-4 py-12 text-center text-[#777]">Нет запросов на переписку</p>
        ) : api ? (
          <>
            {loading && (
              <p className="px-4 py-12 text-center text-[#777]">Загрузка…</p>
            )}
            {!loading && error && (
              <div className="px-4 py-12 text-center">
                <p className="text-[#777]">{error}</p>
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
              filteredApi.map((c) => {
                const other = c.peer
                const last = c.last_message
                const unread = c.unread > 0
                return (
                  <Link
                    key={c.id}
                    to={`/app/messages/${c.id}`}
                    className="flex items-center gap-3 px-4 py-3 active:bg-white/[0.03]"
                  >
                    <Avatar
                      name={other.display_name || other.username}
                      id={other.id}
                      src={other.avatar_url || undefined}
                      size={52}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-white">
                        {other.display_name || other.username}
                      </p>
                      <p
                        className={`mt-0.5 truncate text-[14px] ${
                          unread ? 'text-[#c8c8c8]' : 'text-[#777]'
                        }`}
                      >
                        {last?.body ?? 'Нет сообщений'}
                        {last && (
                          <span className="text-[#777]">
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
              <p className="px-4 py-12 text-center text-[#777]">Нет диалогов</p>
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
                  className="flex items-center gap-3 px-4 py-3 active:bg-white/[0.03]"
                >
                  <Avatar name={other.name} id={other.id} src={other.avatar} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-white">
                      {other.name}
                    </p>
                    <p
                      className={`mt-0.5 truncate text-[14px] ${
                        unread ? 'text-[#c8c8c8]' : 'text-[#777]'
                      }`}
                    >
                      {last?.text ?? 'Нет сообщений'}
                      {last && (
                        <span className="text-[#777]">
                          {' '}
                          · {formatTimeAgo(last.createdAt)}
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
              )
            })}
            {!conversations.length && (
              <p className="px-4 py-12 text-center text-[#777]">Нет диалогов</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
