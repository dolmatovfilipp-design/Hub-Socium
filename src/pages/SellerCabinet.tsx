import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  apiBusinessCabinet,
  apiCreateBusinessProduct,
  apiDeleteBusinessProduct,
  apiListBusinessProducts,
  apiSetBusinessOrderStatus,
  apiUpdateBusinessProduct,
  apiUploadMedia,
  isApiMode,
  type BusinessDraft,
  type BusinessOrder,
  type BusinessProduct,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { formatPrice } from '../utils/validation'
import { IconChevron } from '../components/Icons'

export const BUSINESS_CATEGORIES = ['Электроника', 'Одежда', 'Дом', 'Красота', 'Еда', 'Услуги', 'Разное']

const STATUS_LABEL: Record<string, string> = {
  active: 'В продаже',
  hidden: 'Скрыт',
  sold: 'Продан',
  draft: 'Черновик',
  requested: 'Запрос',
  accepted: 'Принят',
  done: 'Завершён',
  cancelled: 'Отменён',
}

type SpecRow = { key: string; value: string }
type MediaRow = { url: string; kind: 'photo' | 'video' }

const emptyForm = () => ({
  title: '',
  price: '',
  oldPrice: '',
  shortText: '',
  description: '',
  category: 'Разное',
  city: '',
  stock: '1',
  status: 'active',
  specs: [{ key: '', value: '' }] as SpecRow[],
  media: [] as MediaRow[],
})

export function SellerCabinet({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const showToast = useStore((s) => s.showToast)
  const [products, setProducts] = useState<BusinessProduct[]>([])
  const [orders, setOrders] = useState<BusinessOrder[]>([])
  const [stats, setStats] = useState({ views: 0, likes: 0, reviews: 0 })
  const [enabled, setEnabled] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!isApiMode()) return
    void apiListBusinessProducts({ mine: true })
      .then((r) => setProducts(r.items ?? []))
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось загрузить товары'))
    void apiBusinessCabinet()
      .then((r) => {
        setEnabled(!!r.business_mode)
        setStats(r.stats ?? { views: 0, likes: 0, reviews: 0 })
        setOrders(r.orders ?? [])
      })
      .catch(() => {})
  }

  useEffect(() => {
    load()
  }, [])

  const fill = (product: BusinessProduct) => {
    setEditing(product.id)
    setOpen(true)
    setForm({
      title: product.title,
      price: String(product.price),
      oldPrice: product.old_price ? String(product.old_price) : '',
      shortText: product.short_text || '',
      description: product.description || '',
      category: product.category || 'Разное',
      city: product.city || '',
      stock: String(product.stock ?? 0),
      status: product.status || 'active',
      specs: product.specs?.length ? product.specs.map((s) => ({ key: s.key, value: s.value })) : [{ key: '', value: '' }],
      media: (product.media ?? []).map((m) => ({ url: m.url, kind: m.kind === 'video' ? 'video' : 'photo' })),
    })
  }

  const draft = (): BusinessDraft => ({
    title: form.title.trim(),
    price: Number(form.price) || 0,
    old_price: form.oldPrice.trim() ? Number(form.oldPrice) : null,
    short_text: form.shortText.trim(),
    description: form.description.trim(),
    category: form.category,
    city: form.city.trim(),
    stock: Number(form.stock) || 0,
    status: form.status,
    media: form.media,
    specs: form.specs.filter((row) => row.key.trim() && row.value.trim()),
  })

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!isApiMode()) {
      showToast('Кабинет доступен при подключении к серверу')
      return
    }
    setBusy(true)
    const body = draft()
    const req = editing ? apiUpdateBusinessProduct(editing, body) : apiCreateBusinessProduct(body)
    void req
      .then(() => {
        showToast('Сохранено')
        setOpen(false)
        setEditing(null)
        setForm(emptyForm())
        load()
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'Не удалось сохранить'))
      .finally(() => setBusy(false))
  }

  const upload = (file: File) => {
    const kind: MediaRow['kind'] = file.type.startsWith('video/') ? 'video' : 'photo'
    void apiUploadMedia(file)
      .then((media) => setForm((f) => ({ ...f, media: [...f.media, { url: media.url, kind }] })))
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось загрузить файл'))
  }

  return (
    <div className={embedded ? '' : 'flex h-full flex-col bg-black'} data-testid="seller-cabinet">
      {!embedded ? (
        <header className="safe-top relative flex shrink-0 items-center justify-center border-b border-white/[0.06] px-2 pb-3 pt-2">
          <button
            type="button"
            className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
            aria-label="Назад"
            onClick={() => navigate(-1)}
          >
            <IconChevron size={22} className="-scale-x-100" />
          </button>
          <h1 className="text-[17px] font-bold text-white">Кабинет продавца</h1>
        </header>
      ) : (
        <h2 className="px-3 pb-2 pt-1 text-[15px] font-semibold text-white">Кабинет продавца</h2>
      )}
      <div className={embedded ? 'px-3 pb-8' : 'no-scrollbar flex-1 overflow-y-auto px-3 pb-24 pt-3'}>
        {!enabled ? (
          <p className="rounded-2xl bg-[#1c1c1e] px-3 py-3 text-[13px] leading-snug text-[#8e8e93]">
            Включите режим бизнеса в настройках, чтобы публиковать товары.
          </p>
        ) : null}
        <div className="mb-3 grid grid-cols-3 gap-2">
          {[
            ['Просмотры', stats.views],
            ['Лайки', stats.likes],
            ['Отзывы', stats.reviews],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl bg-[#1c1c1e] px-2 py-2.5 text-center">
              <p className="text-[18px] font-semibold text-white">{value}</p>
              <p className="text-[11px] text-[#8e8e93]">{label}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mb-3 h-10 w-full rounded-full bg-white text-[14px] font-semibold text-black"
          onClick={() => {
            setEditing(null)
            setForm(emptyForm())
            setOpen(true)
          }}
        >
          Новый товар
        </button>
        {open ? (
          <form onSubmit={save} className="mb-4 space-y-2 rounded-[22px] bg-[#141416] p-3 ring-1 ring-white/[0.06]">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Название" className="biz-field" />
            <div className="grid grid-cols-2 gap-2">
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="Цена" className="biz-field" />
              <input value={form.oldPrice} onChange={(e) => setForm({ ...form, oldPrice: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="Старая цена" className="biz-field" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="Остаток" className="biz-field" />
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Город" className="biz-field" />
            </div>
            <div className="flex gap-2">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="biz-field">
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="biz-field">
                {Object.entries(STATUS_LABEL).slice(0, 4).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            <textarea value={form.shortText} onChange={(e) => setForm({ ...form, shortText: e.target.value })} rows={2} placeholder="Коротко" className="biz-field resize-none" />
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} placeholder="Полное описание" className="biz-field resize-none" />
            {form.specs.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <input value={row.key} onChange={(e) => setForm({ ...form, specs: form.specs.map((s, at) => (at === i ? { ...s, key: e.target.value } : s)) })} placeholder="Параметр" className="biz-field" />
                <input value={row.value} onChange={(e) => setForm({ ...form, specs: form.specs.map((s, at) => (at === i ? { ...s, value: e.target.value } : s)) })} placeholder="Значение" className="biz-field" />
              </div>
            ))}
            <button type="button" className="text-[13px] text-[#8e8e93]" onClick={() => setForm({ ...form, specs: [...form.specs, { key: '', value: '' }] })}>
              Ещё характеристика
            </button>
            <label className="flex h-10 items-center justify-center rounded-full bg-[#1c1c1e] text-[13px] text-white">
              Фото или видео
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) upload(file)
                  e.target.value = ''
                }}
              />
            </label>
            {form.media.length ? <p className="text-[12px] text-[#8e8e93]">{form.media.length} файл(ов)</p> : null}
            <button type="submit" disabled={busy} className="h-10 w-full rounded-full bg-white text-[14px] font-semibold text-black disabled:opacity-50">
              {editing ? 'Сохранить' : 'Опубликовать'}
            </button>
          </form>
        ) : null}
        <ul className="space-y-2">
          {products.map((product) => (
            <li key={product.id} className="rounded-2xl bg-[#1c1c1e] px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-white">{product.title}</p>
                  <p className="text-[13px] text-[#8e8e93]">
                    {formatPrice(product.price)} · {STATUS_LABEL[product.status] || product.status} · {product.stock} шт.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 text-[13px]">
                  <button type="button" className="text-white" onClick={() => fill(product)}>Изменить</button>
                  <button
                    type="button"
                    className="text-[#8e8e93]"
                    onClick={() => {
                      void apiDeleteBusinessProduct(product.id)
                        .then(() => {
                          setProducts((rows) => rows.filter((row) => row.id !== product.id))
                          showToast('Удалено')
                        })
                        .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось удалить'))
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {!products.length ? <p className="py-4 text-center text-[13px] text-[#8e8e93]">Пока нет товаров</p> : null}
        <h3 className="mb-2 mt-5 text-[15px] font-semibold text-white">Заказы</h3>
        <ul className="space-y-2">
          {orders.map((order) => (
            <li key={order.id} className="rounded-2xl bg-[#1c1c1e] px-3 py-3">
              <p className="text-[15px] text-white">{order.title}</p>
              <p className="text-[13px] text-[#8e8e93]">
                {order.buyer.display_name || order.buyer.username} · {formatPrice(order.price)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={order.status}
                  className="biz-field h-9 flex-1"
                  onChange={(e) => {
                    const status = e.target.value
                    void apiSetBusinessOrderStatus(order.id, status)
                      .then(() => setOrders((rows) => rows.map((row) => (row.id === order.id ? { ...row, status } : row))))
                      .catch((err) => showToast(err instanceof Error ? err.message : 'Не удалось'))
                  }}
                >
                  {(['requested', 'accepted', 'done', 'cancelled'] as const).map((id) => (
                    <option key={id} value={id}>{STATUS_LABEL[id]}</option>
                  ))}
                </select>
                {order.conversation_id ? (
                  <Link to={`/app/messages/${order.conversation_id}`} className="text-[13px] text-white">
                    Чат
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {!orders.length ? <p className="py-4 text-center text-[13px] text-[#8e8e93]">Заказов пока нет</p> : null}
      </div>
    </div>
  )
}
