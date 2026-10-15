import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { IconChevron, IconFilter, IconPlane, IconSearch } from '../components/Icons'
import { useNavMotion } from '../components/NavMotion'
import { Avatar } from '../components/Avatar'
import {
  apiGetMessagePrefs,
  apiListConversations,
  apiSetRequestState,
  apiUpdateMessagePrefs,
  isApiMode,
  type ApiConversation,
} from '../lib/api'
import { useStore } from '../store/useStore'

type Tab = 'requests' | 'hidden'
type Policy = 'everyone' | 'requests' | 'following' | 'none'

const POLICIES: { id: Policy; label: string }[] = [
  { id: 'everyone', label: 'Все' },
  { id: 'requests', label: 'Запросы' },
  { id: 'following', label: 'Только подписки' },
  { id: 'none', label: 'Никто' },
]

export function MessageRequests() {
  const navigate = useNavigate()
  const showToast = useStore((s) => s.showToast)
  const { motionClass, dismiss } = useNavMotion('push')
  const [tab, setTab] = useState<Tab>('requests')
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [items, setItems] = useState<ApiConversation[]>([])
  const [loading, setLoading] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)
  const [policy, setPolicy] = useState<Policy>('requests')
  const filterBtnRef = useRef<HTMLButtonElement>(null)
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!isApiMode()) return
    void apiGetMessagePrefs()
      .then((p) => {
        if (POLICIES.some((row) => row.id === p.message_policy)) setPolicy(p.message_policy as Policy)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isApiMode()) return
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void apiListConversations({
        inbox: tab === 'hidden' ? 'hidden' : 'request',
        q: query.trim() || undefined,
        unread: filter === 'unread',
      })
        .then((r) => {
          if (!cancelled) setItems(r.items ?? [])
        })
        .catch((e) => {
          if (!cancelled) {
            setItems([])
            showToast(e instanceof Error ? e.message : 'Не удалось загрузить запросы')
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [tab, query, filter, showToast])

  const openFilter = () => {
    const el = filterBtnRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      const root = document.getElementById('hub-overlay-root')
      const rootRect = root?.getBoundingClientRect()
      const top = rootRect ? r.bottom - rootRect.top + 6 : r.bottom + 6
      let left = rootRect ? r.left - rootRect.left : r.left
      const width = rootRect?.width ?? window.innerWidth
      left = Math.max(12, Math.min(left, width - 220))
      setFilterPos({ top, left })
    }
    setFilterOpen(true)
  }

  const act = (id: string, action: 'accept' | 'hide') => {
    void apiSetRequestState(id, action)
      .then(() => {
        setItems((rows) => rows.filter((row) => row.id !== id))
        showToast(action === 'accept' ? 'Запрос принят' : 'Запрос скрыт')
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
  }

  const savePolicy = (next: Policy) => {
    setPolicy(next)
    if (!isApiMode()) return
    void apiUpdateMessagePrefs({ message_policy: next })
      .then(() => showToast('Сохранено'))
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось сохранить'))
  }

  const emptyTitle =
    tab === 'hidden'
      ? 'Нет скрытых запросов'
      : filter === 'unread'
        ? 'Нет непрочитанных запросов'
        : query.trim()
          ? 'Ничего не найдено'
          : 'Пока нет запросов на переписку'

  return (
    <>
      <div className={`flex h-full flex-col bg-black ${motionClass}`}>
        <header className="hub-screen-header shrink-0 px-3 pb-2">
          <div className="relative flex h-11 items-center justify-center">
            <button
              type="button"
              className="absolute left-0 flex items-center gap-0.5 text-[17px] text-white"
              onClick={() => (tab === 'hidden' ? setTab('requests') : dismiss('/app/messages'))}
            >
              <IconChevron size={20} className="-scale-x-100" />
              <span>Назад</span>
            </button>
            <h1 className="text-[17px] font-bold text-white">
              {tab === 'hidden' ? 'Скрытые запросы' : 'Запросы'}
            </h1>
          </div>

          <div className="hub-search-pill mt-2">
            <IconSearch size={18} className="shrink-0 text-[#8e8e93]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              ref={filterBtnRef}
              type="button"
              className="hub-circle-btn"
              data-active={filter !== 'all' ? 'true' : 'false'}
              aria-label="Фильтр"
              onClick={() => (filterOpen ? setFilterOpen(false) : openFilter())}
            >
              <IconFilter size={22} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold text-white ${
                tab === 'requests' ? 'border border-white' : 'bg-[#1c1c1e]'
              }`}
              onClick={() => setTab('requests')}
            >
              Запросы
            </button>
            <button
              type="button"
              className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold text-white ${
                tab === 'hidden' ? 'border border-white' : 'bg-[#1c1c1e]'
              }`}
              onClick={() => {
                setFilterOpen(false)
                setTab('hidden')
              }}
            >
              Скрыто
            </button>
            {tab === 'requests' ? (
              <button
                type="button"
                className="rounded-full bg-[#1c1c1e] px-3.5 py-1.5 text-[14px] font-semibold text-white"
                onClick={() => setPolicyOpen((v) => !v)}
              >
                Настройки
              </button>
            ) : null}
          </div>
          {policyOpen && tab === 'requests' ? (
            <div className="mt-3 rounded-2xl bg-[#1c1c1e] p-3 text-left">
              <p className="px-1 pb-2 text-[13px] text-[#8e8e93]">Кто может писать вам</p>
              {POLICIES.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[15px] text-white active:bg-white/[0.06]"
                  onClick={() => savePolicy(row.id)}
                >
                  <span className="w-4">{policy === row.id ? '✓' : ''}</span>
                  {row.label}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto pb-8">
          {loading && !items.length ? (
            <p className="px-4 py-10 text-center text-[14px] text-[#8e8e93]">Загрузка…</p>
          ) : null}
          {items.map((row) => {
            const name = row.peer?.display_name || row.peer?.username || 'Пользователь'
            return (
              <div key={row.id} className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(`/app/messages/${row.id}`)}>
                  <div className="flex items-center gap-3">
                    <Avatar name={name} id={row.peer?.id || row.id} src={row.peer?.avatar_url || undefined} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-white">{name}</p>
                      <p className="truncate text-[13px] text-[#8e8e93]">
                        {row.last_message?.body || 'Сообщение'}
                        {row.unread ? ` · ${row.unread}` : ''}
                      </p>
                    </div>
                  </div>
                </button>
                {tab === 'requests' ? (
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      className="rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-black"
                      onClick={() => act(row.id, 'accept')}
                    >
                      Принять
                    </button>
                    <button
                      type="button"
                      className="rounded-full bg-[#1c1c1e] px-3 py-1 text-[13px] font-semibold text-white"
                      onClick={() => act(row.id, 'hide')}
                    >
                      Скрыть
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-black"
                    onClick={() => act(row.id, 'accept')}
                  >
                    Принять
                  </button>
                )}
              </div>
            )
          })}
          {!loading && !items.length ? (
            <div className="flex flex-col items-center px-8 pb-8 pt-16 text-center">
              <span className="mb-5 flex h-11 w-11 items-center justify-center text-[#8e8e93]">
                <IconPlane size={22} strokeWidth={1.6} />
              </span>
              <h2 className="text-[20px] font-bold text-white">{emptyTitle}</h2>
              <p className="mt-2 max-w-[300px] text-[14px] leading-snug text-[#8e8e93]">
                {tab === 'hidden'
                  ? 'Здесь запросы, в которых нашлись скрытые слова.'
                  : 'Сообщения от людей вне ваших подписок попадают сюда, если политика — «Запросы».'}
              </p>
              {tab === 'hidden' ? (
                <button
                  type="button"
                  className="mt-6 rounded-full border border-white/25 px-5 py-2.5 text-[14px] font-semibold text-white"
                  onClick={() => navigate('/app/messages/hidden-words')}
                >
                  Изменить предпочтения для скрытых слов
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
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
              style={{ top: filterPos?.top ?? 120, left: filterPos?.left ?? 12 }}
              role="menu"
            >
              <p className="px-4 pb-1 pt-3 text-[12px] font-medium text-[#8e8e93]">Фильтр</p>
              {([
                ['all', 'Все'],
                ['unread', 'Непрочитанные'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-white active:bg-white/[0.06]"
                  onClick={() => {
                    setFilter(key)
                    setFilterOpen(false)
                  }}
                >
                  <span className="w-4 shrink-0">{filter === key ? '✓' : ''}</span>
                  {label}
                </button>
              ))}
              <div className="h-2" />
            </div>
          </div>,
          document.getElementById('hub-overlay-root') ?? document.body,
        )}
    </>
  )
}

export function HiddenWordsPrefs() {
  const showToast = useStore((s) => s.showToast)
  const { motionClass, dismiss } = useNavMotion('push')
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isApiMode()) return
    void apiGetMessagePrefs()
      .then((p) => setWords(p.hidden_words || ''))
      .catch(() => {})
  }, [])

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="hub-screen-header relative flex shrink-0 items-center justify-center px-3 pb-2">
        <button
          type="button"
          className="absolute left-3 flex items-center gap-0.5 text-[17px] text-white"
          onClick={() => dismiss('/app/messages/requests')}
        >
          <IconChevron size={20} className="-scale-x-100" />
          <span>Назад</span>
        </button>
        <h1 className="text-[17px] font-bold text-white">Скрытые слова</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pt-2">
        <p className="text-[14px] leading-snug text-[#8e8e93]">
          Запросы с этими словами попадут в «Скрыто». По одному слову или фразе на строку, от 2 символов.
        </p>
        <textarea
          value={words}
          onChange={(e) => setWords(e.target.value)}
          rows={8}
          placeholder="спам&#10;оскорбление"
          className="mt-4 w-full resize-none rounded-2xl border border-white/[0.08] bg-[#1c1c1e] px-4 py-3 text-[15px] text-white outline-none placeholder:text-[#8e8e93]"
        />
        <button
          type="button"
          disabled={busy}
          className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-white text-[15px] font-semibold text-black disabled:opacity-50"
          onClick={() => {
            if (!isApiMode()) {
              showToast('Сохранение доступно при подключении к серверу')
              return
            }
            setBusy(true)
            void apiUpdateMessagePrefs({ hidden_words: words })
              .then(() => {
                showToast('Сохранено')
                dismiss('/app/messages/requests')
              })
              .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось сохранить'))
              .finally(() => setBusy(false))
          }}
        >
          Сохранить
        </button>
      </div>
    </div>
  )
}
