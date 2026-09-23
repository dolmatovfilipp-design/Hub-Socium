import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconChevron, IconClose } from './Icons'
import {
  DEFAULT_MARKET_FILTERS,
  MARKET_CITY_CHIPS,
  MARKET_FILTER_CATEGORIES,
  lotWord,
  type MarketFilterState,
  type SellerFilter,
  type SortFilter,
} from '../lib/marketFilters'

const SORT_ROWS: { id: SortFilter; label: string }[] = [
  { id: 'default', label: 'По умолчанию' },
  { id: 'new', label: 'Новые' },
  { id: 'cheap', label: 'Дешевле' },
  { id: 'expensive', label: 'Дороже' },
]

const SELLER_SEGMENTS: { id: SellerFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'private', label: 'Частные' },
  { id: 'company', label: 'Компании' },
]

interface Props {
  open: boolean
  onClose: () => void
  value: MarketFilterState
  onApply: (next: MarketFilterState) => void
  previewCount: (draft: MarketFilterState) => number
  focusCity?: boolean
}

export function MarketFilterSheet({
  open,
  onClose,
  value,
  onApply,
  previewCount,
  focusCity,
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [draft, setDraft] = useState<MarketFilterState>(value)

  useEffect(() => {
    if (open) {
      setDraft(value)
      setMounted(true)
      return
    }
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 240)
    return () => window.clearTimeout(t)
  }, [open, value, mounted])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const count = useMemo(() => previewCount(draft), [draft, previewCount])

  const host =
    typeof document !== 'undefined'
      ? document.getElementById('hub-overlay-root')
      : null

  if (!mounted || !host) return null

  const toggleCategory = (cat: string) => {
    setDraft((d) => {
      const has = d.categories.includes(cat)
      return {
        ...d,
        categories: has
          ? d.categories.filter((c) => c !== cat)
          : [...d.categories, cat],
      }
    })
  }

  const reset = () => setDraft({ ...DEFAULT_MARKET_FILTERS, city: 'Вся Россия' })

  const apply = () => {
    onApply(draft)
    onClose()
  }

  return createPortal(
    <div
      className={`market-filter-root pointer-events-auto absolute inset-0 z-[90] flex flex-col ${
        open ? 'market-filter-open' : 'market-filter-closing'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Фильтры"
    >
      <button
        type="button"
        className="market-filter-backdrop absolute inset-0"
        aria-label="Закрыть"
        onClick={onClose}
      />

      <div className="market-filter-sheet relative z-[1] flex min-h-0 flex-1 flex-col bg-black">
        <header className="safe-top relative flex shrink-0 items-center justify-center bg-black px-2 pb-3 pt-2">
          <button
            type="button"
            className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <IconClose size={20} />
          </button>
          <h2 className="text-[17px] font-bold text-white">Фильтры</h2>
          <button
            type="button"
            className="absolute right-3 text-[15px] font-medium text-[#8e8e93] active:opacity-70"
            onClick={reset}
          >
            Сбросить
          </button>
        </header>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          <section className="mb-5">
            <h3 className="pb-1 pt-1 text-[16px] font-bold text-white">Категории</h3>
            {MARKET_FILTER_CATEGORIES.map((cat) => {
              const on = draft.categories.includes(cat)
              return (
                <button
                  key={cat}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-[14px] text-left active:bg-white/[0.03]"
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="text-[16px] font-normal text-white">{cat}</span>
                  {on ? (
                    <span className="text-[15px] font-bold text-white">✓</span>
                  ) : (
                    <IconChevron size={18} className="shrink-0 text-[#777]" />
                  )}
                </button>
              )
            })}
          </section>

          <section className="mb-5">
            <h3 className="pb-1 pt-1 text-[16px] font-bold text-white">Где искать</h3>
            <input
              autoFocus={!!focusCity}
              value={draft.cityQuery}
              onChange={(e) =>
                setDraft((d) => ({ ...d, cityQuery: e.target.value }))
              }
              placeholder="Город, район, метро"
              className="mb-1 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white placeholder:text-[#8e8e93]/50 focus:border-white/20 focus:outline-none"
            />
            {MARKET_CITY_CHIPS.map((city) => {
              const on = draft.city === city
              return (
                <button
                  key={city}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-[14px] text-left active:bg-white/[0.03]"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      city,
                      cityQuery: city === 'Вся Россия' ? '' : d.cityQuery,
                    }))
                  }
                >
                  <span className="text-[16px] font-normal text-white">{city}</span>
                  {on ? (
                    <span className="text-[15px] font-bold text-white">✓</span>
                  ) : null}
                </button>
              )
            })}
          </section>

          <section className="mb-5">
            <h3 className="pb-1 pt-1 text-[16px] font-bold text-white">Цена</h3>
            <div className="mb-1 flex items-center gap-2">
              <input
                inputMode="numeric"
                value={draft.priceFrom}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priceFrom: e.target.value }))
                }
                placeholder="От"
                className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white placeholder:text-[#8e8e93]/50 focus:border-white/20 focus:outline-none"
              />
              <span className="text-[14px] text-[#777]">—</span>
              <input
                inputMode="numeric"
                value={draft.priceTo}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priceTo: e.target.value }))
                }
                placeholder="До"
                className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white placeholder:text-[#8e8e93]/50 focus:border-white/20 focus:outline-none"
              />
            </div>
            <div className="flex w-full items-center justify-between gap-3 py-[14px]">
              <span className="text-[16px] font-normal text-white">Только с ценой</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.onlyWithPrice}
                aria-label="Только с ценой"
                onClick={() =>
                  setDraft((d) => ({ ...d, onlyWithPrice: !d.onlyWithPrice }))
                }
                className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${
                  draft.onlyWithPrice ? 'bg-[#34c759]' : 'bg-[#39393d]'
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-[left] ${
                    draft.onlyWithPrice ? 'left-[22px]' : 'left-[2px]'
                  }`}
                />
              </button>
            </div>
          </section>

          <section className="mb-5">
            <h3 className="pb-1 pt-1 text-[16px] font-bold text-white">Кто продаёт</h3>
            {SELLER_SEGMENTS.map((s) => {
              const on = draft.sellerType === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-[14px] text-left active:bg-white/[0.03]"
                  onClick={() => setDraft((d) => ({ ...d, sellerType: s.id }))}
                >
                  <span className="text-[16px] font-normal text-white">{s.label}</span>
                  {on ? (
                    <span className="text-[15px] font-bold text-white">✓</span>
                  ) : null}
                </button>
              )
            })}
          </section>

          <section className="mb-2">
            <h3 className="pb-1 pt-1 text-[16px] font-bold text-white">Сортировка</h3>
            {SORT_ROWS.map((row) => {
              const on = draft.sort === row.id
              return (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-[14px] text-left active:bg-white/[0.03]"
                  onClick={() => setDraft((d) => ({ ...d, sort: row.id }))}
                >
                  <span className="text-[16px] font-normal text-white">{row.label}</span>
                  {on ? (
                    <span className="text-[15px] font-bold text-white">✓</span>
                  ) : null}
                </button>
              )
            })}
          </section>
        </div>

        <footer
          className="shrink-0 border-t border-white/[0.06] px-4 pt-3"
          style={{ paddingBottom: 'max(12px, var(--hub-safe-bottom))' }}
        >
          <button
            type="button"
            className="w-full rounded-full bg-white py-3.5 text-[16px] font-semibold text-black active:opacity-85"
            onClick={apply}
          >
            Показать {count} {lotWord(count)}
          </button>
        </footer>
      </div>
    </div>,
    host,
  )
}
