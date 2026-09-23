import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  apiCreateMeetup, apiGetMeetup, apiListMeetups, apiMeetupCancel, apiMeetupGoing, isApiMode,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { HubEmptyState } from '../components/HubEmptyState'

export function Meetups() {
  const showToast = useStore((s) => s.showToast)
  const navigate = useNavigate()
  const [items, setItems] = useState<any[]>([])
  const [title, setTitle] = useState('')
  const [city, setCity] = useState('')
  const [place, setPlace] = useState('')
  const [starts, setStarts] = useState('')

  const load = useCallback(async () => {
    if (!isApiMode()) return
    try {
      const res = await apiListMeetups()
      setItems(res.items ?? [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    }
  }, [showToast])

  useEffect(() => { void load() }, [load])

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Link to="/app" className="text-[#8e8e93]">←</Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold">Встречи</h1>
        <div className="w-6" />
      </header>
      <div className="space-y-2 border-b border-white/[0.06] px-4 py-3">
        <input className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px]" placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px]" placeholder="Город" value={city} onChange={(e) => setCity(e.target.value)} />
        <input className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px]" placeholder="Место" value={place} onChange={(e) => setPlace(e.target.value)} />
        <input className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px]" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        <button type="button" className="w-full rounded-xl bg-white py-2.5 font-semibold text-black"
          onClick={() => {
            if (!title.trim() || !starts) { showToast('Укажите название и дату'); return }
            const iso = new Date(starts).toISOString()
            void apiCreateMeetup({ title: title.trim(), city, place, starts_at: iso })
              .then((m) => { showToast('Встреча создана'); navigate(`/app/meetups/${m.id}`) })
              .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
          }}>Создать</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!items.length && <HubEmptyState title="Встреч пока нет" subtitle="Создайте событие — гости нажмут «Пойду»." />}
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id}>
              <Link to={`/app/meetups/${m.id}`} className="block rounded-2xl bg-white/[0.04] px-4 py-3">
                <p className="font-semibold">{m.title}</p>
                <p className="text-[13px] text-[#8e8e93]">{m.city} · {m.place} · пойдут: {m.going}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function MeetupDetail() {
  const { id = '' } = useParams()
  const showToast = useStore((s) => s.showToast)
  const navigate = useNavigate()
  const [m, setM] = useState<any>(null)

  const load = useCallback(async () => {
    if (!id || !isApiMode()) return
    setM(await apiGetMeetup(id))
  }, [id])

  useEffect(() => { void load().catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка')) }, [load, showToast])

  if (!m) return <div className="flex h-full items-center justify-center bg-black text-[#777]">Загрузка…</div>

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Link to="/app/meetups" className="text-[#8e8e93]">←</Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold">{m.title}</h1>
        <div className="w-6" />
      </header>
      <div className="flex-1 px-4 py-4">
        <p className="text-[14px] text-[#ccc]">{m.description || 'Без описания'}</p>
        <p className="mt-3 text-[14px] text-[#8e8e93]">{m.city} · {m.place}</p>
        <p className="mt-1 text-[14px] text-[#8e8e93]">{new Date(m.starts_at).toLocaleString('ru-RU')}</p>
        <p className="mt-3 text-[14px]">Пойдут: {m.going}</p>
      </div>
      <div className="flex gap-2 border-t border-white/[0.06] px-4 py-3">
        {!m.i_go ? (
          <button type="button" className="flex-1 rounded-xl bg-white py-3 font-semibold text-black"
            onClick={() => {
              void apiMeetupGoing(id).then((r) => {
                showToast('Вы идёте · чат участников готов')
                void load()
                if (r.conversation_id) navigate(`/app/messages/${r.conversation_id}`)
              }).catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
            }}>Пойду</button>
        ) : (
          <>
            <button type="button" className="flex-1 rounded-xl bg-[#1c1c1e] py-3 font-semibold"
              onClick={() => { void apiMeetupCancel(id).then(() => { showToast('Отменено'); void load() }) }}>Не пойду</button>
            {m.conversation_id && (
              <button type="button" className="rounded-xl bg-white px-4 py-3 font-semibold text-black"
                onClick={() => navigate(`/app/messages/${m.conversation_id}`)}>Чат</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
