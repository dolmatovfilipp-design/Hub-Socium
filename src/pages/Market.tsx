import { useMemo, useState } from 'react'
import { Search, ShoppingBag } from 'lucide-react'
import { useStore } from '../store/useStore'
import { formatPrice } from '../utils/validation'

interface Props {
  embedded?: boolean
}

export function Market({ embedded }: Props) {
  const market = useStore((s) => s.market)
  const addToCartToast = useStore((s) => s.addToCartToast)
  const [q, setQ] = useState('')

  const items = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return market
    return market.filter(
      (i) =>
        i.title.toLowerCase().includes(query) ||
        i.category.toLowerCase().includes(query) ||
        i.description.toLowerCase().includes(query)
    )
  }, [market, q])

  return (
    <div className={embedded ? '' : 'flex h-full flex-col'}>
      {!embedded && (
        <header className="safe-top glass-strong shrink-0 border-b border-white/5 px-4 pb-3 pt-3">
          <h1 className="text-lg font-bold text-hub-text">Маркет</h1>
        </header>
      )}
      <div className="px-4 pt-4">
        <p className="mb-3 text-xs text-hub-muted">
          Каталог демо · оплата демо, без эквайринга
        </p>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-hub-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск…"
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-4 text-[15px] text-hub-text placeholder:text-hub-muted/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 pb-4">
          {items.map((item) => (
            <article
              key={item.id}
              className="animate-fade-in flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-b from-[#1e1e22] to-[#141416]"
            >
              <div className="flex h-28 items-center justify-center bg-white/[0.03] text-4xl">
                {item.image}
              </div>
              <div className="flex flex-1 flex-col p-3">
                <span className="text-[10px] uppercase tracking-wider text-hub-muted">
                  {item.category}
                </span>
                <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-hub-text">
                  {item.title}
                </h3>
                <p className="mt-auto pt-2 text-sm font-medium text-hub-silver">
                  {formatPrice(item.price)}
                </p>
                <button
                  type="button"
                  onClick={() => addToCartToast(item.title)}
                  className="mt-2 flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] text-xs font-semibold text-hub-silver active:scale-[0.97]"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />В корзину
                </button>
              </div>
            </article>
          ))}
        </div>
        {!items.length && (
          <p className="py-8 text-center text-sm text-hub-muted">Ничего не найдено</p>
        )}
      </div>
    </div>
  )
}
