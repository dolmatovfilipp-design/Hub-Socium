import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  apiCreateVoiceRoom,
  apiGetVoiceRoom,
  apiJoinVoiceRoom,
  apiLeaveVoiceRoom,
  apiListVoiceRooms,
  apiVoiceHeartbeat,
  isApiMode,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { HubEmptyState } from '../components/HubEmptyState'

export function VoiceRooms() {
  const showToast = useStore((s) => s.showToast)
  const navigate = useNavigate()
  const [items, setItems] = useState<any[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isApiMode()) { setLoading(false); return }
    try {
      const res = await apiListVoiceRooms()
      setItems(res.items ?? [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void load(); const h = setInterval(() => void load(), 5000); return () => clearInterval(h) }, [load])

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Link to="/app" className="text-[#8e8e93]">←</Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold">Голосовые комнаты</h1>
        <div className="w-6" />
      </header>
      <p className="px-4 py-2 text-[12px] text-[#8e8e93]">
        MVP: кто в эфире и микрофон. Живой звук (WebRTC) — позже. Чаты не затронуты.
      </p>
      <div className="border-b border-white/[0.06] px-4 py-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название комнаты"
          className="mb-2 w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] outline-none" />
        <button type="button" className="w-full rounded-xl bg-white py-2.5 text-[15px] font-semibold text-black"
          onClick={() => {
            void apiCreateVoiceRoom(title.trim() || 'Комната').then((r) => {
              showToast('Комната создана')
              navigate(`/app/voice/${r.id}`)
            }).catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
          }}>Создать комнату</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && <p className="text-center text-[#777]">Загрузка…</p>}
        {!loading && !items.length && <HubEmptyState title="Никого в эфире" subtitle="Создайте комнату — друзья смогут зайти." />}
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id}>
              <Link to={`/app/voice/${r.id}`} className="block rounded-2xl bg-white/[0.04] px-4 py-3">
                <p className="font-semibold">{r.title}</p>
                <p className="text-[13px] text-[#8e8e93]">@{r.host?.username} · в эфире: {r.live_count}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function VoiceRoomDetail() {
  const { id = '' } = useParams()
  const showToast = useStore((s) => s.showToast)
  const [room, setRoom] = useState<any>(null)
  const [muted, setMuted] = useState(true)

  const refresh = useCallback(async () => {
    if (!id || !isApiMode()) return
    try {
      const r = await apiGetVoiceRoom(id)
      setRoom(r)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    }
  }, [id, showToast])

  useEffect(() => {
    void (async () => {
      try {
        await apiJoinVoiceRoom(id)
        await refresh()
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Не удалось войти')
      }
    })()
    const h = setInterval(() => {
      void apiVoiceHeartbeat(id, muted).then(() => refresh())
    }, 4000)
    return () => {
      clearInterval(h)
      void apiLeaveVoiceRoom(id).catch(() => {})
    }
  }, [id, muted, refresh, showToast])

  if (!room) return <div className="flex h-full items-center justify-center bg-black text-[#777]">Загрузка…</div>

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Link to="/app/voice" className="text-[#8e8e93]">←</Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold">{room.title}</h1>
        <div className="w-6" />
      </header>
      <p className="px-4 py-2 text-[12px] text-[#8e8e93]">{room.note}</p>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <h2 className="mb-2 text-[13px] uppercase text-[#8e8e93]">В эфире</h2>
        <ul className="space-y-2">
          {(room.members ?? []).map((m: any) => (
            <li key={m.id} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
              <span>@{m.username} · {m.role}</span>
              <span className="text-[12px] text-[#8e8e93]">{m.muted ? '🔇 mute' : '🎙️'}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2 border-t border-white/[0.06] px-4 py-3">
        <button type="button" className="flex-1 rounded-xl bg-[#1c1c1e] py-3 font-semibold"
          onClick={() => setMuted((v) => !v)}>{muted ? 'Включить микрофон' : 'Выключить микрофон'}</button>
        <Link to="/app/voice" className="rounded-xl bg-white px-4 py-3 font-semibold text-black">Выйти</Link>
      </div>
    </div>
  )
}
