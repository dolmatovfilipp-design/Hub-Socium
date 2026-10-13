import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconHeart } from '../components/Icons'
import {
  apiAddBusinessReview,
  apiBuyBusinessProduct,
  apiCreateBusinessProduct,
  apiGetBusinessProfile,
  apiLikeBusinessProduct,
  apiListBusinessProducts,
  apiListBusinessReviews,
  apiUnlikeBusinessProduct,
  apiUpdateBusinessProduct,
  isApiMode,
  type BusinessProduct,
  type BusinessReview,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { formatPrice } from '../utils/validation'
import { useVoiceMarketBridge } from '../voice/surfaces'
import type { MarketListing } from '../voice/commands/types'
import { SellerCabinet, BUSINESS_CATEGORIES } from './SellerCabinet'

type Pane = 'shop' | 'cabinet'

export function BusinessFeed() {
  const navigate = useNavigate()
  const showToast = useStore((s) => s.showToast)
  const currentUserId = useStore((s) => s.currentUserId)
  const [items, setItems] = useState<BusinessProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('Все')
  const [city, setCity] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [ratingMin, setRatingMin] = useState(0)
  const [sort, setSort] = useState<'default' | 'new' | 'cheap' | 'expensive'>('default')
  const [priceOpen, setPriceOpen] = useState(false)
  const [cityOpen, setCityOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reviews, setReviews] = useState<Record<string, BusinessReview[]>>({})
  const [reviewBody, setReviewBody] = useState('')
  const [sentiment, setSentiment] = useState<'' | 'positive' | 'negative'>('')
  const [reviewFor, setReviewFor] = useState<string | null>(null)
  const [businessMode, setBusinessMode] = useState(false)
  const [pane, setPane] = useState<Pane>('shop')
  const [focus, setFocus] = useState(0)

  const load = () => {
    if (!isApiMode()) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    void apiListBusinessProducts({
      q: q.trim() || undefined,
      category: category === 'Все' ? undefined : category,
      city: city.trim() || undefined,
      price_min: priceMin ? Number(priceMin) : undefined,
      price_max: priceMax ? Number(priceMax) : undefined,
      rating_min: ratingMin || undefined,
      sort: sort === 'default' ? undefined : sort,
    })
      .then((r) => setItems(r.items ?? []))
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось загрузить'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const timer = window.setTimeout(load, 180)
    return () => window.clearTimeout(timer)
  }, [q, category, city, priceMin, priceMax, ratingMin, sort])

  useEffect(() => {
    if (!isApiMode()) return
    void apiGetBusinessProfile()
      .then((p) => setBusinessMode(!!p.business_mode))
      .catch(() => {})
  }, [])

  const listings = useMemo<MarketListing[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        title: item.title,
        price: item.price,
        category: item.category,
        city: item.city,
        description: item.short_text || item.description,
      })),
    [items],
  )

  const openReviews = (id: string) => {
    setExpanded(id)
    setReviewFor(id)
    if (reviews[id]) return
    void apiListBusinessReviews(id)
      .then((r) => setReviews((prev) => ({ ...prev, [id]: r.items ?? [] })))
      .catch(() => {})
  }

  const buy = async (id: string) => {
    try {
      const order = await apiBuyBusinessProduct(id)
      showToast('Запрос отправлен продавцу')
      navigate(`/app/messages/${order.conversation_id}`)
      return { ok: true as const }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось'
      showToast(message)
      return { ok: false as const, error: message }
    }
  }

  useVoiceMarketBridge({
    setQuery: setQ,
    setCategory: (next) => setCategory(next || 'Все'),
    setCity,
    setPriceFrom: setPriceMin,
    setPriceTo: setPriceMax,
    setSort,
    setSellerType: () => {},
    resetFilters: () => {
      setQ('')
      setCategory('Все')
      setCity('')
      setPriceMin('')
      setPriceMax('')
      setRatingMin(0)
      setSort('default')
    },
    listings: () => listings,
    messageSeller: (id) => buy(id),
    archiveListing: async (id) => {
      const item = items.find((row) => row.id === id)
      if (!item || item.seller_id !== currentUserId) return { ok: false, error: 'Скрыть может продавец' }
      await apiUpdateBusinessProduct(id, {
        title: item.title,
        price: item.price,
        old_price: item.old_price ?? null,
        short_text: item.short_text,
        description: item.description,
        category: item.category,
        city: item.city,
        stock: item.stock,
        status: 'hidden',
        media: item.media,
        specs: item.specs,
      })
      setItems((rows) => rows.filter((row) => row.id !== id))
      return { ok: true }
    },
    demoPay: async (id) => {
      const result = await buy(id)
      if (!result.ok) return result
      return { ok: true, message: 'Открываю чат с продавцом' }
    },
    createAd: async (input) => {
      if (!businessMode) return { ok: false, error: 'Включите режим бизнеса в настройках' }
      await apiCreateBusinessProduct({ title: input.title, price: input.price, city: input.city, status: 'active' })
      load()
      return { ok: true }
    },
    reviewOpen: () => reviewFor != null,
    setReviewRating: (rating) => setSentiment(rating >= 4 ? 'positive' : 'negative'),
    setReviewBody: setReviewBody,
    submitReview: async () => {
      if (!reviewFor) return { ok: false, error: 'Сначала откройте товар' }
      const created = await apiAddBusinessReview(reviewFor, reviewBody, sentiment)
      setReviews((prev) => ({ ...prev, [reviewFor]: [created, ...(prev[reviewFor] ?? [])] }))
      setReviewBody('')
      setReviewFor(null)
      return { ok: true }
    },
    closeReview: () => setReviewFor(null),
    focusListing: (id) => {
      const index = items.findIndex((row) => row.id === id)
      if (index >= 0) setFocus(index)
      document.querySelector(`[data-voice-listing="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
    },
  })

  useEffect(() => {
    if (focus >= listings.length) setFocus(0)
  }, [focus, listings.length])

  const toggleLike = (product: BusinessProduct) => {
    const req = product.liked ? apiUnlikeBusinessProduct(product.id) : apiLikeBusinessProduct(product.id)
    void req
      .then((r) => {
        setItems((rows) =>
          rows.map((row) =>
            row.id === product.id ? { ...row, liked: r.liked, like_count: r.like_count, rating: r.rating } : row,
          ),
        )
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
  }

  return (
    <div data-testid="business-feed">
      {businessMode ? (
        <div className="mx-3 mb-2 flex h-8 items-center rounded-full bg-[#1c1c1e] p-0.5">
          <button
            type="button"
            className={`h-7 flex-1 rounded-full text-[13px] font-semibold ${pane === 'shop' ? 'bg-white text-black' : 'text-[#aaa]'}`}
            onClick={() => setPane('shop')}
          >
            Витрина
          </button>
          <button
            type="button"
            className={`h-7 flex-1 rounded-full text-[13px] font-semibold ${pane === 'cabinet' ? 'bg-white text-black' : 'text-[#aaa]'}`}
            onClick={() => setPane('cabinet')}
          >
            Кабинет
          </button>
        </div>
      ) : null}
      {pane === 'cabinet' && businessMode ? (
        <SellerCabinet embedded />
      ) : (
        <>
          <div className="px-3 pb-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск товаров"
              className="h-9 w-full rounded-full bg-[#1c1c1e] px-3 text-[14px] text-white outline-none placeholder:text-[#8e8e93]"
            />
          </div>
          <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto px-3">
            {['Все', ...BUSINESS_CATEGORIES].map((name) => (
              <button
                key={name}
                type="button"
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                  category === name ? 'bg-white text-black' : 'bg-[#1c1c1e] text-[#d1d1d6]'
                }`}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
            <button type="button" className={`shrink-0 rounded-full px-3 py-1 text-[12px] ${priceOpen || priceMin || priceMax ? 'bg-white text-black' : 'bg-[#1c1c1e] text-[#d1d1d6]'}`} onClick={() => setPriceOpen((v) => !v)}>
              Цена
            </button>
            <button type="button" className={`shrink-0 rounded-full px-3 py-1 text-[12px] ${cityOpen || city ? 'bg-white text-black' : 'bg-[#1c1c1e] text-[#d1d1d6]'}`} onClick={() => setCityOpen((v) => !v)}>
              {city || 'Город'}
            </button>
            <button
              type="button"
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] ${ratingMin ? 'bg-white text-black' : 'bg-[#1c1c1e] text-[#d1d1d6]'}`}
              onClick={() => setRatingMin((n) => (n === 0 ? 1 : n === 1 ? 5 : n === 5 ? 10 : 0))}
            >
              {ratingMin ? `Рейтинг ${ratingMin}+` : 'Рейтинг'}
            </button>
          </div>
          {priceOpen ? (
            <div className="mb-2 grid grid-cols-2 gap-2 px-3">
              <input value={priceMin} onChange={(e) => setPriceMin(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="От" className="biz-field" />
              <input value={priceMax} onChange={(e) => setPriceMax(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="До" className="biz-field" />
            </div>
          ) : null}
          {cityOpen ? (
            <div className="mb-2 px-3">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Город" className="biz-field" />
            </div>
          ) : null}
          {loading && !items.length ? <p className="py-10 text-center text-[13px] text-[#8e8e93]">Загрузка…</p> : null}
          {!loading && !items.length ? (
            <div className="px-6 py-16 text-center">
              <p className="text-[17px] font-semibold text-white">В бизнес-ленте пока пусто</p>
              <p className="mt-1 text-[13px] text-[#8e8e93]">Товары продавцов появятся здесь.</p>
            </div>
          ) : null}
          {items.map((product, index) => {
            const open = expanded === product.id
            const sellerName = product.seller.display_name || product.seller.username
            return (
              <article
                key={product.id}
                data-testid="product-card"
                data-voice-listing={product.id}
                className={`mx-3 mb-3 overflow-hidden rounded-[22px] bg-[#141416] ring-1 ${
                  index === focus ? 'ring-white/30' : 'ring-white/[0.06]'
                }`}
              >
                <Link to={`/app/u/${product.seller.username}`} className="flex items-center gap-2.5 px-3 py-2.5">
                  <Avatar name={sellerName} id={product.seller.id} src={product.seller.avatar_url || undefined} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-white">{sellerName}</p>
                    <p className="truncate text-[12px] text-[#8e8e93]">{product.city || product.category}</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-black" title="Рейтинг продавца">
                    {product.seller.rating}
                  </span>
                </Link>
                <MediaStrip media={product.media} title={product.title} />
                <div className="flex items-baseline gap-2 px-3 pt-3">
                  <span className="text-[22px] font-semibold tracking-tight text-white">{formatPrice(product.price)}</span>
                  {product.old_price ? (
                    <span className="text-[13px] text-[#8e8e93] line-through">{formatPrice(product.old_price)}</span>
                  ) : null}
                  <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white" title="Рейтинг товара">
                    {product.rating}
                  </span>
                </div>
                <p className="px-3 pt-1 text-[13px] text-[#8e8e93]">{product.category}{product.stock === 0 ? ' · нет в наличии' : ''}</p>
                <p className={`px-3 pt-1 text-[14px] leading-snug text-white ${open ? '' : 'line-clamp-2'}`}>
                  {open ? product.description || product.short_text || product.title : product.short_text || product.description || product.title}
                </p>
                {open ? (
                  <div data-testid="product-expanded" className="px-3 pt-2">
                    {product.specs?.length ? (
                      <dl className="divide-y divide-white/[0.06] rounded-2xl bg-black/30">
                        {product.specs.map((spec) => (
                          <div key={`${spec.key}-${spec.value}`} className="flex justify-between gap-3 px-3 py-2 text-[13px]">
                            <dt className="text-[#8e8e93]">{spec.key}</dt>
                            <dd className="text-right text-white">{spec.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      {(reviews[product.id] ?? []).map((review) => (
                        <div key={review.id} className="text-[13px]">
                          <p className="text-white">
                            <span className="font-semibold">{review.author.display_name || review.author.username}</span>
                            {review.sentiment === 'positive' ? ' · плюс' : review.sentiment === 'negative' ? ' · минус' : ''}
                          </p>
                          <p className="text-[#d1d1d6]">{review.body}</p>
                        </div>
                      ))}
                      {reviewFor === product.id ? (
                        <div className="space-y-2">
                          <div className="flex gap-1.5">
                            {(['positive', 'negative'] as const).map((mark) => (
                              <button
                                key={mark}
                                type="button"
                                className={`rounded-full px-3 py-1 text-[12px] ${sentiment === mark ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
                                onClick={() => setSentiment(mark)}
                              >
                                {mark === 'positive' ? 'Плюс' : 'Минус'}
                              </button>
                            ))}
                          </div>
                          <input
                            value={reviewBody}
                            onChange={(e) => setReviewBody(e.target.value)}
                            placeholder="Отзыв"
                            className="biz-field"
                          />
                          <button
                            type="button"
                            className="text-[13px] font-semibold text-white"
                            onClick={() => {
                              if (!reviewBody.trim()) return
                              void apiAddBusinessReview(product.id, reviewBody.trim(), sentiment)
                                .then((created) => {
                                  setReviews((prev) => ({ ...prev, [product.id]: [created, ...(prev[product.id] ?? [])] }))
                                  setReviewBody('')
                                  setItems((rows) =>
                                    rows.map((row) => {
                                      if (row.id !== product.id) return row
                                      const delta = sentiment === 'positive' ? 1 : sentiment === 'negative' ? -1 : 0
                                      return {
                                        ...row,
                                        review_count: row.review_count + 1,
                                        rating: Math.max(0, row.rating + delta),
                                        seller: { ...row.seller, rating: Math.max(0, row.seller.rating + delta) },
                                      }
                                    }),
                                  )
                                  showToast('Отзыв сохранён')
                                })
                                .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
                            }}
                          >
                            Отправить отзыв
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center gap-1.5 px-3 py-3">
                  <button type="button" className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[13px] text-white" onClick={() => toggleLike(product)}>
                    <IconHeart size={14} />
                    {product.like_count}
                  </button>
                  <button type="button" className="rounded-full bg-white/10 px-2.5 py-1 text-[13px] text-white" onClick={() => (open ? setExpanded(null) : openReviews(product.id))}>
                    {open ? 'Свернуть' : `Отзывы ${product.review_count}`}
                  </button>
                  <button
                    type="button"
                    disabled={product.stock === 0 || product.seller_id === currentUserId}
                    className="ml-auto rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold text-black disabled:opacity-40"
                    onClick={() => void buy(product.id)}
                  >
                    Купить
                  </button>
                </div>
              </article>
            )
          })}
        </>
      )}
    </div>
  )
}

function MediaStrip({ media, title }: { media: BusinessProduct['media']; title: string }) {
  if (!media?.length) {
    return <div className="flex h-[180px] items-center justify-center bg-[#1c1c1e] text-[13px] text-[#8e8e93]">Нет фото</div>
  }
  return (
    <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto">
      {media.map((file) =>
        file.kind === 'video' ? (
          <video key={file.url} src={file.url} className="h-[210px] w-full shrink-0 snap-center bg-black object-cover" controls playsInline />
        ) : (
          <img key={file.url} src={file.url} alt={title} className="h-[210px] w-full shrink-0 snap-center object-cover" />
        ),
      )}
    </div>
  )
}
