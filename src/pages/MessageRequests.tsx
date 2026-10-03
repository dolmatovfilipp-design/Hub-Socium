import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { IconChevron, IconFilter, IconPlane, IconSearch } from '../components/Icons'
import { useNavMotion } from '../components/NavMotion'

type Tab = 'requests' | 'hidden'

export function MessageRequests() {
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('push')
  const [tab, setTab] = useState<Tab>('requests')
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const filterBtnRef = useRef<HTMLButtonElement>(null)
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null)

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

  if (tab === 'hidden') {
    return (
      <div className={`flex h-full flex-col bg-black ${motionClass}`}>
        <header className="hub-screen-header relative flex shrink-0 items-center justify-center px-3 pb-2">
          <button
            type="button"
            className="absolute left-3 flex items-center gap-0.5 text-[17px] text-white"
            onClick={() => setTab('requests')}
          >
            <IconChevron size={20} className="-scale-x-100" />
            <span>Назад</span>
          </button>
          <h1 className="text-[17px] font-bold text-white">Скрытые запросы</h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
          <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#1c1c1e] text-[#8e8e93]">
            <IconPlane size={28} />
          </span>
          <h2 className="text-[20px] font-bold text-white">Нет скрытых запросов</h2>
          <p className="mt-2 max-w-[300px] text-[14px] leading-snug text-[#8e8e93]">
            Здесь будут показываться запросы на переписку, содержащие скрытые слова, а также
            оскорбительные или нежелательные сообщения.
          </p>
          <button
            type="button"
            className="mt-6 rounded-full border border-white/25 px-5 py-2.5 text-[14px] font-semibold text-white"
            onClick={() => navigate('/app/messages/hidden-words')}
          >
            Изменить предпочтения для скрытых слов
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="hub-screen-header shrink-0 px-3 pb-2">
        <div className="relative flex h-11 items-center justify-center">
          <button
            type="button"
            className="absolute left-0 flex items-center gap-0.5 text-[17px] text-white"
            onClick={() => dismiss('/app/messages')}
          >
            <IconChevron size={20} className="-scale-x-100" />
            <span>Назад</span>
          </button>
          <h1 className="text-[17px] font-bold text-white">Запросы</h1>
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
            className={`hub-circle-btn h-9 w-9 ${filter !== 'all' ? 'bg-white text-black' : ''}`}
            aria-label="Фильтр"
            onClick={() => (filterOpen ? setFilterOpen(false) : openFilter())}
          >
            <IconFilter size={16} />
          </button>
          <button
            type="button"
            className="rounded-full border border-white px-3.5 py-1.5 text-[14px] font-semibold text-white"
          >
            Запросы
          </button>
          <button
            type="button"
            className="rounded-full bg-[#1c1c1e] px-3.5 py-1.5 text-[14px] font-semibold text-white"
            onClick={() => { setFilterOpen(false); setTab('hidden') }}
          >
            Скрыто
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
        <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#1c1c1e] text-[#8e8e93]">
          <IconPlane size={28} />
        </span>
        <h2 className="text-[20px] font-bold text-white">
          {filter === 'unread' ? 'Нет непрочитанных запросов' : 'Пока нет запросов на переписку'}
        </h2>
        <p className="mt-2 max-w-[300px] text-[14px] leading-snug text-[#8e8e93]">
          Здесь будут показываться сообщения от пользователей, на которых вы не подписаны. Эту
          настройку всегда можно выключить.
        </p>
        <button
          type="button"
          className="mt-6 rounded-full border border-white/25 px-5 py-2.5 text-[14px] font-semibold text-white"
          onClick={() => navigate('/app/settings')}
        >
          Настройки
        </button>
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
  const { motionClass, dismiss } = useNavMotion('push')
  const [words, setWords] = useState(() => {
    try {
      return localStorage.getItem('hub_hidden_words') || ''
    } catch {
      return ''
    }
  })

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
          Запросы с этими словами попадут в «Скрыто». По одному слову или фразе на строку.
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
          className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-white text-[15px] font-semibold text-black"
          onClick={() => {
            try {
              localStorage.setItem('hub_hidden_words', words)
            } catch {
              /* ignore */
            }
            dismiss('/app/messages/requests')
          }}
        >
          Сохранить
        </button>
      </div>
    </div>
  )
}
