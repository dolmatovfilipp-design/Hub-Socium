import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiListDrafts, apiPublishDraft, isApiMode } from '../lib/api'
import { HubEmptyState } from '../components/HubEmptyState'
import { useStore } from '../store/useStore'

type Draft = {
  id: string
  body: string
  status: string
  scheduled_at?: string
  created_at: string
}

export function Drafts() {
  const showToast = useStore((s) => s.showToast)
  const [items, setItems] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    setLoading(true)
    void apiListDrafts()
      .then((r) => setItems(r.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  if (!isApiMode()) {
    return <HubEmptyState title="Черновики" subtitle="Локальные черновики — в Compose" />
  }

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
        <Link to="/app/compose" className="text-[#8e8e93]">
          ←
        </Link>
        <h1 className="text-[17px] font-semibold">Черновики и отложенные</h1>
      </header>
      {loading ? (
        <p className="p-6 text-center text-sm text-[#777]">Загрузка…</p>
      ) : items.length === 0 ? (
        <HubEmptyState title="Пусто" subtitle="Сохраните черновик из Compose" />
      ) : (
        <ul className="overflow-y-auto">
          {items.map((d) => (
            <li key={d.id} className="border-b border-white/[0.06] px-4 py-3">
              <p className="whitespace-pre-wrap text-[15px] text-white">{d.body}</p>
              <p className="mt-1 text-[12px] text-[#8e8e93]">
                {d.status === 'scheduled' ? 'Отложен' : 'Черновик'}
                {d.scheduled_at ? ` · ${new Date(d.scheduled_at).toLocaleString('ru-RU')}` : ''}
              </p>
              <button
                type="button"
                className="mt-2 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black"
                onClick={() => {
                  void apiPublishDraft(d.id)
                    .then(() => {
                      showToast('Опубликовано')
                      load()
                    })
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
                }}
              >
                Опубликовать
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
