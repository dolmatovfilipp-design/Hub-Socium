import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import {
  apiCreateConversation,
  apiSearchUsers,
  isApiMode,
  type ApiSearchUser,
} from '../lib/api'
import { useNavMotion } from '../components/NavMotion'

export function NewMessage() {
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('push')
  const uid = useStore((s) => s.currentUserId)!
  const users = useStore((s) => s.users)
  const ensureConversation = useStore((s) => s.ensureConversation)
  const showToast = useStore((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [busy, setBusy] = useState(false)
  const [apiHits, setApiHits] = useState<ApiSearchUser[]>([])
  const [apiLoading, setApiLoading] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!isApiMode()) return
    if (!debounced) {
      setApiHits([])
      return
    }
    let cancelled = false
    setApiLoading(true)
    void (async () => {
      try {
        const res = await apiSearchUsers({ q: debounced, limit: 30 })
        if (!cancelled) setApiHits(res.items ?? [])
      } catch {
        if (!cancelled) setApiHits([])
      } finally {
        if (!cancelled) setApiLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debounced])

  const localRecommendations = useMemo(() => {
    const list = users.filter((u) => u.id !== uid)
    if (!query.trim()) return list
    const q = query.trim().toLowerCase()
    return list.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (u.bio ?? '').toLowerCase().includes(q),
    )
  }, [users, uid, query])

  const openChat = async (otherId: string, username: string) => {
    if (busy) return
    setBusy(true)
    try {
      if (isApiMode()) {
        try {
          const conv = await apiCreateConversation({ user_id: otherId, username })
          navigate(`/app/messages/${conv.id}`, { replace: true })
          return
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Не удалось открыть чат')
          return
        }
      }
      const id = ensureConversation(otherId)
      if (id) navigate(`/app/messages/${id}`, { replace: true })
    } finally {
      setBusy(false)
    }
  }

  const apiMode = isApiMode()

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top shrink-0 bg-black px-4 pb-3 pt-2">
        <div className="relative flex h-10 items-center justify-center">
          <button
            type="button"
            className="pressable absolute left-0 text-[16px] text-white"
            onClick={() => dismiss('/app/messages')}
          >
            Отмена
          </button>
          <h1 className="text-[17px] font-semibold text-white">Новое сообщение</h1>
        </div>

        <div className="mt-3 flex items-center gap-2 border-b border-white/[0.08] pb-3">
          <span className="shrink-0 text-[15px] text-[#8e8e93]">Кому:</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="h-8 w-full bg-transparent text-[15px] text-white placeholder:text-[#8e8e93]"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto">
        <p className="px-4 pb-2 pt-4 text-[15px] font-semibold text-white">
          {apiMode ? 'Люди' : 'Рекомендации'}
        </p>

        {apiMode ? (
          <>
            {apiLoading && (
              <p className="px-4 py-8 text-center text-[#8e8e93]">Поиск…</p>
            )}
            {!apiLoading &&
              apiHits.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  disabled={busy}
                  className="pressable flex w-full items-center gap-3 px-4 py-3 text-left"
                  onClick={() => void openChat(u.id, u.username)}
                >
                  <Avatar
                    name={u.display_name || u.username}
                    id={u.id}
                    src={u.avatar_url || undefined}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-white">
                      {u.username}
                    </p>
                    <p className="truncate text-[14px] text-[#8e8e93]">
                      {[u.display_name, u.city].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </button>
              ))}
            {!apiLoading && debounced && !apiHits.length && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">Никого не найдено</p>
            )}
            {!apiLoading && !debounced && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">
                Начните вводить имя или username
              </p>
            )}
          </>
        ) : (
          <>
            {localRecommendations.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={busy}
                className="pressable flex w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() => void openChat(u.id, u.username)}
              >
                <Avatar name={u.name} id={u.id} src={u.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-white">{u.username}</p>
                  <p className="truncate text-[14px] text-[#8e8e93]">{u.bio || u.name}</p>
                </div>
              </button>
            ))}
            {!localRecommendations.length && (
              <p className="px-4 py-12 text-center text-[#8e8e93]">Никого не найдено</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
