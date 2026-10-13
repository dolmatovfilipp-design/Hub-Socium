import { useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { IconPhone, IconVideo } from './Icons'
import { subscribeOutgoingCalls, type OutgoingCallRequest } from '../lib/callBus'
import { DmVideoSession } from '../lib/webrtcCall'
import {
  apiAnswerCall,
  apiDeclineCall,
  apiEndCall,
  apiListIncomingCalls,
  apiPostCallSignal,
  apiPollCallSignals,
  apiStartCall,
  getAccessToken,
  isApiMode,
  type ApiIceServer,
  type ApiIncomingCall,
} from '../lib/api'
import { useStore } from '../store/useStore'

type LiveCall = {
  conversationId: string
  peerId: string
  peerName: string
  peerAvatar?: string
  video: boolean
  ice: ApiIceServer[]
}

const FALLBACK_ICE: ApiIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function CallHost() {
  const uid = useStore((s) => s.currentUserId)
  const showToast = useStore((s) => s.showToast)
  const [incoming, setIncoming] = useState<ApiIncomingCall | null>(null)
  const [live, setLive] = useState<LiveCall | null>(null)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState('')
  const [micMuted, setMicMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const callRef = useRef<DmVideoSession | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const liveRef = useRef<LiveCall | null>(null)
  const iceRef = useRef<ApiIceServer[]>(FALLBACK_ICE)
  const busyRef = useRef(false)
  liveRef.current = live

  useEffect(() => {
    if (!live) return
    const h = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(h)
  }, [live])

  useEffect(() => {
    if (!isApiMode() || !uid || !getAccessToken()) return
    let stop = false
    const tick = async () => {
      if (stop || liveRef.current || busyRef.current || !getAccessToken()) return
      try {
        const res = await apiListIncomingCalls()
        if (stop || liveRef.current || busyRef.current) return
        if (res.ice_servers?.length) iceRef.current = res.ice_servers
        setIncoming(res.items?.[0] ?? null)
      } catch {
        /* keep the last banner; the next poll retries */
      }
    }
    void tick()
    const h = window.setInterval(() => void tick(), 2500)
    return () => {
      stop = true
      window.clearInterval(h)
    }
  }, [uid])

  const placeRef = useRef<(req: OutgoingCallRequest) => void>(() => {})

  const stopMedia = (conversationId?: string) => {
    busyRef.current = false
    liveRef.current = null
    callRef.current?.stop()
    callRef.current = null
    if (conversationId) void apiEndCall(conversationId).catch(() => {})
    setLive(null)
    setFailed('')
    setStatus('')
    setMicMuted(false)
    setCamOff(false)
    setConnectedAt(null)
  }

  const beginMedia = async (spec: LiveCall) => {
    busyRef.current = true
    liveRef.current = spec
    setIncoming(null)
    setFailed('')
    setStatus('Звоним…')
    setMicMuted(false)
    setCamOff(!spec.video)
    setConnectedAt(null)
    setLive(spec)
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    const session = new DmVideoSession({
      localUserId: uid || '',
      peerId: spec.peerId,
      video: spec.video,
      iceServers: spec.ice.length ? spec.ice : FALLBACK_ICE,
      localVideo: localVideoRef.current,
      remoteVideo: remoteVideoRef.current,
      onStatus: (m) => {
        setStatus(m)
        if (m === 'На связи') setConnectedAt((prev) => prev ?? Date.now())
      },
      onFailed: (m) => setFailed(m),
      sendSignal: (to, kind, payload) => apiPostCallSignal(spec.conversationId, to, kind, payload),
      pollSignals: async () => {
        const r = await apiPollCallSignals(spec.conversationId)
        return (r.items || []) as never
      },
    })
    callRef.current = session
    try {
      await session.start()
    } catch (e) {
      session.stop()
      callRef.current = null
      busyRef.current = false
      liveRef.current = null
      void apiEndCall(spec.conversationId).catch(() => {})
      setLive(null)
      showToast(e instanceof Error ? e.message : 'Звонок не удался')
    }
  }

  const placeCall = async (req: OutgoingCallRequest) => {
    if (!uid || !isApiMode()) return
    if (busyRef.current || liveRef.current) {
      showToast('Уже идёт звонок')
      return
    }
    busyRef.current = true
    try {
      const started = await apiStartCall(req.conversationId, req.video)
      const ice = started.ice_servers?.length ? started.ice_servers : iceRef.current
      if (started.status === 'ringing' && started.initiator_id && started.initiator_id !== uid) {
        await apiAnswerCall(req.conversationId)
      }
      await beginMedia({
        conversationId: req.conversationId,
        peerId: started.peer_id || req.peerId,
        peerName: req.peerName,
        peerAvatar: req.peerAvatar,
        video: started.video ?? req.video,
        ice,
      })
    } catch (e) {
      busyRef.current = false
      showToast(e instanceof Error ? e.message : 'Звонок не удался')
    }
  }

  placeRef.current = (req) => {
    void placeCall(req)
  }

  useEffect(() => subscribeOutgoingCalls((req) => placeRef.current(req)), [])

  const acceptIncoming = async () => {
    const item = incoming
    if (!item || !uid) return
    if (busyRef.current || liveRef.current) return
    busyRef.current = true
    try {
      const answered = await apiAnswerCall(item.conversation_id)
      const ice = answered.ice_servers?.length ? answered.ice_servers : iceRef.current
      await beginMedia({
        conversationId: item.conversation_id,
        peerId: item.peer_id || item.initiator.id,
        peerName: item.initiator.display_name || item.initiator.username,
        peerAvatar: item.initiator.avatar_url,
        video: item.video,
        ice,
      })
    } catch (e) {
      busyRef.current = false
      setIncoming(null)
      showToast(e instanceof Error ? e.message : 'Не удалось ответить')
    }
  }

  const declineIncoming = async () => {
    const item = incoming
    setIncoming(null)
    if (!item) return
    try {
      await apiDeclineCall(item.conversation_id)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось отклонить')
    }
  }

  return (
    <>
      {incoming && !live ? (
        <div className="absolute inset-x-0 top-0 z-[70] px-3 pt-3">
          <div className="safe-top rounded-3xl bg-[#1c1c1e] px-4 py-3 shadow-2xl">
            <div className="flex items-center gap-3">
              <Avatar
                name={incoming.initiator.display_name || incoming.initiator.username}
                id={incoming.initiator.id}
                src={incoming.initiator.avatar_url}
                size={44}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-white">
                  {incoming.initiator.display_name || incoming.initiator.username}
                </p>
                <p className="text-[13px] text-[#a8a8a8]">
                  {incoming.video ? 'Входящий видеозвонок' : 'Входящий звонок'}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="pressable flex-1 rounded-full bg-[#ff3040] py-2.5 text-[14px] font-semibold text-white"
                onClick={() => void declineIncoming()}
              >
                Отклонить
              </button>
              <button
                type="button"
                className="pressable flex-1 rounded-full bg-[#30d158] py-2.5 text-[14px] font-semibold text-black"
                onClick={() => void acceptIncoming()}
              >
                Принять
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {live ? (
        <div className="absolute inset-0 z-[80] flex flex-col bg-black" data-video-call="">
          <div className="safe-top flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-white">{live.peerName}</p>
              <p className="text-[13px] text-[#a8a8a8]">
                {connectedAt ? formatElapsed(now - connectedAt) : status || 'Звоним…'}
              </p>
            </div>
            <button
              type="button"
              className="pressable rounded-full bg-[#ff3040] px-3 py-1.5 text-[13px] font-medium text-white"
              onClick={() => stopMedia(live.conversationId)}
            >
              Сбросить
            </button>
          </div>
          <div className="relative min-h-0 flex-1 bg-[#0a0a0a]">
            {live.video ? (
              <video ref={remoteVideoRef} className="h-full w-full object-cover" playsInline autoPlay />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <Avatar name={live.peerName} id={live.peerId} src={live.peerAvatar} size={120} />
                <p className="text-[20px] font-semibold text-white">{live.peerName}</p>
                <p className="text-[14px] text-[#8e8e93]">{status || 'Аудиозвонок'}</p>
              </div>
            )}
            {failed ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
                <p className="text-[16px] font-semibold text-white">{failed}</p>
                <button
                  type="button"
                  className="pressable rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black"
                  onClick={() => stopMedia(live.conversationId)}
                >
                  Закрыть
                </button>
              </div>
            ) : null}
            {live.video ? (
              <video
                ref={localVideoRef}
                className={`absolute bottom-24 right-4 h-36 w-28 rounded-2xl border border-white/20 object-cover ${camOff ? 'opacity-30' : ''}`}
                playsInline
                autoPlay
                muted
              />
            ) : null}
            <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-4">
              <button
                type="button"
                aria-label={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                className={`pressable h-12 rounded-full px-4 text-[12px] font-medium ${micMuted ? 'bg-white text-black' : 'bg-white/15 text-white'}`}
                onClick={() => {
                  const next = !micMuted
                  setMicMuted(next)
                  callRef.current?.setMicMuted(next)
                }}
              >
                Микрофон
              </button>
              {live.video ? (
                <button
                  type="button"
                  aria-label={camOff ? 'Включить камеру' : 'Выключить камеру'}
                  className={`pressable h-12 rounded-full px-4 text-[12px] font-medium ${camOff ? 'bg-white text-black' : 'bg-white/15 text-white'}`}
                  onClick={() => {
                    const next = !camOff
                    setCamOff(next)
                    callRef.current?.setCamOff(next)
                  }}
                >
                  Камера
                </button>
              ) : null}
              <button
                type="button"
                className="pressable flex h-12 items-center gap-2 rounded-full bg-[#ff3040] px-5 text-[13px] font-semibold text-white"
                onClick={() => stopMedia(live.conversationId)}
              >
                {live.video ? <IconVideo size={16} /> : <IconPhone size={16} />}
                Завершить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
