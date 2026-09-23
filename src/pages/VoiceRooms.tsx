import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  apiCreateVoiceRoom,
  apiGetVoiceRoom,
  apiJoinVoiceRoom,
  apiLeaveVoiceRoom,
  apiListVoiceRooms,
  apiVoiceHeartbeat,
  apiVoicePollSignals,
  apiVoiceSignal,
  isApiMode,
} from '../lib/api'
import { VoiceMesh } from '../lib/webrtcVoice'
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
        Живой звук WebRTC (mesh + STUN). Без TURN за жёстким NAT связь может не подняться. Presence S6 сохранён.
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
                <p className="text-[13px] text-[#8e8e93]">
                  @{r.host?.username} · в эфире: {r.live_count}
                  {r.audio === 'webrtc' ? ' · 🎙️ live' : ''}
                </p>
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
  const mutedRef = useRef(true)
  const [rtcStatus, setRtcStatus] = useState('Подключение аудио…')
  const [audioReady, setAudioReady] = useState(false)
  const meshRef = useRef<VoiceMesh | null>(null)
  const startedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!id || !isApiMode()) return null
    try {
      const r = await apiGetVoiceRoom(id)
      setRoom(r)
      return r
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
      return null
    }
  }, [id, showToast])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await apiJoinVoiceRoom(id)
        const r = await refresh()
        if (cancelled || !r || startedRef.current) return
        startedRef.current = true
        const me = r.me as string
        const ice = (r.ice_servers || [
          { urls: 'stun:stun.l.google.com:19302' },
        ]) as { urls: string | string[] }[]
        const mesh = new VoiceMesh({
          localUserId: me,
          peerIds: (r.members || []).map((m: any) => m.id),
          iceServers: ice,
          muted: true,
          sendSignal: (to, kind, payload) => apiVoiceSignal(id, to, kind, payload).then(() => undefined),
          pollSignals: async () => {
            const res = await apiVoicePollSignals(id)
            return (res.items || []) as any
          },
          onStatus: (msg) => setRtcStatus(msg),
        })
        meshRef.current = mesh
        try {
          await mesh.start((r.members || []).map((m: any) => m.id).filter((pid: string) => pid !== me))
          setAudioReady(true)
          setRtcStatus('Аудио готово (unmute чтобы говорить)')
        } catch (e) {
          setRtcStatus(e instanceof Error ? e.message : 'getUserMedia недоступен')
          setAudioReady(false)
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Не удалось войти')
      }
    })()

    const h = setInterval(() => {
      void apiVoiceHeartbeat(id, mutedRef.current).then(async () => {
        const r = await refresh()
        if (r && meshRef.current) {
          const me = r.me as string
          await meshRef.current.syncPeers(
            (r.members || []).map((m: any) => m.id).filter((pid: string) => pid !== me),
          )
        }
      })
    }, 4000)

    return () => {
      cancelled = true
      clearInterval(h)
      meshRef.current?.stop()
      meshRef.current = null
      startedRef.current = false
      void apiLeaveVoiceRoom(id).catch(() => {})
    }
  }, [id, refresh, showToast]) // muted intentionally not in deps — heartbeat interval reads muted via closure refresh path

  // Keep muted in sync with mesh + heartbeat without remounting mesh
  useEffect(() => {
    mutedRef.current = muted
    meshRef.current?.setMuted(muted)
    if (id && isApiMode()) void apiVoiceHeartbeat(id, muted).catch(() => {})
  }, [muted, id])

  if (!room) return <div className="flex h-full items-center justify-center bg-black text-[#777]">Загрузка…</div>

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Link to="/app/voice" className="text-[#8e8e93]">←</Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold">{room.title}</h1>
        <div className="w-6" />
      </header>
      <p className="px-4 py-2 text-[12px] text-[#8e8e93]">{room.note}</p>
      <p className={`px-4 pb-2 text-[12px] ${audioReady ? 'text-emerald-400' : 'text-amber-400'}`}>
        WebRTC: {rtcStatus}
      </p>
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
