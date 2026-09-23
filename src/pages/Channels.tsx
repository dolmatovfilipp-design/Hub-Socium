import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  apiCreateChannel,
  apiListChannels,
  isApiMode,
  type ApiChannel,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { HubEmptyState } from '../components/HubEmptyState'

export function Channels() {
  const showToast = useStore((s) => s.showToast)
  const navigate = useNavigate()
  const [items, setItems] = useState<ApiChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')

  const load = useCallback(async () => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiListChannels()
      setItems(res.items ?? [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    if (!title.trim() || !slug.trim()) {
      showToast('Укажите название и адрес (slug)')
      return
    }
    setCreating(true)
    try {
      const ch = await apiCreateChannel({
        title: title.trim(),
        slug: slug.trim().toLowerCase(),
        description: description.trim(),
        rules: rules.trim(),
      })
      showToast('Канал создан')
      navigate(`/app/channels/${ch.id}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось создать')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Link to="/app" className="text-[15px] text-[#8e8e93]">
          ← Назад
        </Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white">Клубы</h1>
        <div className="w-14" />
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto scroll-pad-nav px-4 py-4">
        <section className="mb-6 rounded-2xl bg-white/[0.04] p-4">
          <h2 className="mb-3 text-[15px] font-semibold text-white">Создать канал</h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название"
            className="mb-2 w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none"
          />
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Адрес (латиница): travel-ru"
            className="mb-2 w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание"
            rows={2}
            className="mb-2 w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none"
          />
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder="Простые правила"
            rows={2}
            className="mb-3 w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none"
          />
          <button
            type="button"
            disabled={creating || !isApiMode()}
            onClick={() => void onCreate()}
            className="pressable w-full rounded-xl bg-white py-2.5 text-[15px] font-semibold text-black disabled:opacity-40"
          >
            {creating ? 'Создание…' : 'Создать'}
          </button>
        </section>

        {loading && <p className="text-center text-[#777]">Загрузка…</p>}
        {!loading && !items.length && (
          <HubEmptyState title="Клубов пока нет" subtitle="Создайте канал или дождитесь приглашения." />
        )}
        <ul className="space-y-2">
          {items.map((ch) => (
            <li key={ch.id}>
              <Link
                to={`/app/channels/${ch.id}`}
                className="block rounded-2xl bg-white/[0.04] px-4 py-3"
              >
                <p className="text-[16px] font-semibold text-white">{ch.title}</p>
                <p className="text-[13px] text-[#8e8e93]">
                  @{ch.slug} · {ch.members} уч. {ch.joined ? '· вы внутри' : ''}
                </p>
                {ch.description ? (
                  <p className="mt-1 line-clamp-2 text-[13px] text-[#aaa]">{ch.description}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
