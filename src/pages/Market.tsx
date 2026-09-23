import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { formatPrice } from '../utils/validation'
import { IconChevron, IconSearch, IconSliders } from '../components/Icons'
import { MarketFilterSheet } from '../components/MarketFilterSheet'
import {
  applyMarketFilters,
  DEFAULT_MARKET_FILTERS,
  MARKET_FILTER_CATEGORIES,
  type MarketFilterState,
} from '../lib/marketFilters'
import { apiCreateConversation, isApiMode } from '../lib/api'
import type { MarketItem } from '../types'

interface Props {
  embedded?: boolean
}

const ORBIT = ['Все', ...MARKET_FILTER_CATEGORIES] as const

export function Market({ embedded }: Props) {
  const market = useStore((s) => s.market)
  const ensureConversation = useStore((s) => s.ensureConversation)
  const showToast = useStore((s) => s.showToast)
  const navigate = useNavigate()
  const [dmBusy, setDmBusy] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [orbit, setOrbit] = useState<string>('Все')
  const [filters, setFilters] = useState<MarketFilterState>(DEFAULT_MARKET_FILTERS)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [focusCity, setFocusCity] = useState(false)

  const orbitCategory = orbit === 'Все' ? null : orbit

  const items = useMemo(
    () => applyMarketFilters(market, q, filters, orbitCategory),
    [market, q, filters, orbitCategory],
  )

  const previewCount = useCallback(
    (draft: MarketFilterState) =>
      applyMarketFilters(market, q, draft, orbitCategory).length,
    [market, q, orbitCategory],
  )

  const openSheet = (cityFocus = false) => {
    setFocusCity(cityFocus)
    setSheetOpen(true)
  }

  const cityLabel =
    filters.city && filters.city !== 'Вся Россия' ? filters.city : 'Вся Россия'

  const messageSeller = async (item: MarketItem) => {
    if (dmBusy) return
    setDmBusy(item.id)
    try {
      if (isApiMode()) {
        if (!item.sellerUsername) {
          showToast('Продавец не привязан')
          return
        }
        const conv = await apiCreateConversation({ username: item.sellerUsername })
        navigate(`/app/messages/${conv.id}`)
      } else {
        const sid = item.sellerUserId
        if (!sid) {
          showToast('Продавец не привязан')
          return
        }
        const cid = ensureConversation(sid)
        navigate(`/app/messages/${cid}`)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось открыть чат')
    } finally {
      setDmBusy(null)
    }
  }

  return (
    <div className={embedded ? 'bg-black' : 'flex h-full flex-col bg-black'}>
      {!embedded && (
        <header className="safe-top relative flex shrink-0 items-center justify-center bg-black px-2 pb-3 pt-2">
          <h1 className="text-[17px] font-bold text-white">Маркет</h1>
        </header>
      )}

      <div className={embedded ? 'px-4 pt-1' : 'no-scrollbar flex-1 overflow-y-auto px-4 pt-1'}>
        {embedded && (
          <h2 className="mb-3 text-[17px] font-bold text-white">Маркет</h2>
        )}

        <div className="relative mb-2">
          <IconSearch
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8e8e93]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск"
            aria-label="Поиск"
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-[16px] text-white placeholder:text-[#8e8e93]/50 focus:border-white/20 focus:outline-none"
          />
        </div>

        <div className="mb-1">
          <button
            type="button"
            onClick={() => openSheet(true)}
            className="flex w-full items-center justify-between gap-3 py-[14px] text-left active:bg-white/[0.03]"
            aria-label="Город"
          >
            <span className="text-[16px] font-normal text-white">{cityLabel}</span>
            <IconChevron size={18} className="shrink-0 text-[#777]" />
          </button>
          <button
            type="button"
            onClick={() => openSheet(false)}
            className="flex w-full items-center justify-between gap-3 py-[14px] text-left active:bg-white/[0.03]"
            aria-label="Фильтры"
          >
            <span className="flex items-center gap-3.5">
              <IconSliders size={22} className="shrink-0 text-white" />
              <span className="text-[16px] font-normal text-white">Фильтры</span>
            </span>
            <IconChevron size={18} className="shrink-0 text-[#777]" />
          </button>
        </div>

        <div
          className="no-scrollbar -mx-1 mb-2 flex gap-4 overflow-x-auto px-1 pb-2"
          role="tablist"
          aria-label="Категории"
        >
          {ORBIT.map((cat) => {
            const active = orbit === cat
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                className={`shrink-0 whitespace-nowrap py-1 text-[15px] transition-colors ${
                  active
                    ? 'font-semibold text-white'
                    : 'font-normal text-[#777]'
                }`}
                onClick={() => setOrbit(cat)}
              >
                {cat}
              </button>
            )
          })}
        </div>

        <div className="pb-6">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex w-full items-center gap-3.5 py-[14px] active:bg-white/[0.03]"
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[22px]"
                aria-hidden
              >
                {item.image}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[16px] font-normal text-white">
                  {item.title}
                </h3>
                <p className="mt-0.5 truncate text-[13px] text-[#8e8e93]">
                  {item.category}
                  {item.badge === 'near'
                    ? ' · Рядом'
                    : item.badge === 'hit'
                      ? ' · Хит'
                      : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[15px] font-semibold text-white">
                  {formatPrice(item.price)}
                </span>
                <button
                  type="button"
                  disabled={dmBusy === item.id}
                  className="text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                  onClick={() => void messageSeller(item)}
                >
                  {dmBusy === item.id ? '…' : 'Написать продавцу'}
                </button>
              </div>
            </article>
          ))}
        </div>

        {!items.length && (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <p className="text-[17px] font-bold text-white">Маркет пуст</p>
            <p className="mt-2 max-w-[260px] text-[15px] leading-snug text-[#777]">
              Попробуйте другой запрос или сбросьте фильтры.
            </p>
            <button
              type="button"
              className="mt-5 rounded-full bg-white px-5 py-2.5 text-[15px] font-semibold text-black active:opacity-80"
              onClick={() => {
                setQ('')
                setOrbit('Все')
                setFilters(DEFAULT_MARKET_FILTERS)
              }}
            >
              Сбросить
            </button>
          </div>
        )}
      </div>

      <MarketFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        value={filters}
        onApply={setFilters}
        previewCount={previewCount}
        focusCity={focusCity}
      />
    </div>
  )
}
