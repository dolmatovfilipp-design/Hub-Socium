/**
 * 1:1 WebRTC over DM call signaling (WebSocket, HTTP poll fallback).
 * Glare: the lower user id keeps its offer; the higher id is polite and rolls back.
 * ICE: servers from the API (STUN + coturn HMAC TURN, or the openrelay demo).
 */
import type { IceServer, SignalMsg } from './webrtcVoice'

export type VideoCallOpts = {
  localUserId: string
  peerId: string
  iceServers: IceServer[]
  /** false = audio only. Defaults to video so older callers keep the camera. */
  video?: boolean
  sendSignal: (to: string, kind: 'offer' | 'answer' | 'ice' | 'hangup', payload: unknown) => Promise<void>
  pollSignals: () => Promise<SignalMsg[]>
  onStatus?: (msg: string) => void
  onFailed?: (msg: string) => void
  onIceState?: (state: string) => void
  onRemoteTrack?: () => void
  localVideo?: HTMLVideoElement | null
  remoteVideo?: HTMLVideoElement | null
  remoteAudio?: HTMLAudioElement | null
}

function asDescription(payload: unknown): RTCSessionDescriptionInit | null {
  let value = payload
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const d = value as { type?: string; sdp?: string }
  if (!d.sdp || (d.type !== 'offer' && d.type !== 'answer' && d.type !== 'pranswer')) return null
  return { type: d.type, sdp: d.sdp }
}

function asCandidate(payload: unknown): RTCIceCandidateInit | null {
  let value = payload
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const c = value as RTCIceCandidateInit
  if (!c.candidate) return null
  return {
    candidate: c.candidate,
    sdpMid: c.sdpMid,
    sdpMLineIndex: c.sdpMLineIndex,
    usernameFragment: c.usernameFragment,
  }
}

function markInline(el: HTMLMediaElement) {
  el.setAttribute('playsinline', 'true')
  el.setAttribute('webkit-playsinline', 'true')
  if ('playsInline' in el) (el as HTMLVideoElement).playsInline = true
  el.autoplay = true
}

/** Standalone 1:1 session with mute / camera toggles. */
export class DmVideoSession {
  private localId: string
  private peerId: string
  private iceServers: RTCIceServer[]
  private sendSignal: VideoCallOpts['sendSignal']
  private pollSignals: VideoCallOpts['pollSignals']
  private onStatus?: (m: string) => void
  private onFailed?: (m: string) => void
  private onIceState?: (state: string) => void
  private onRemoteTrack?: () => void
  private localVideo: HTMLVideoElement | null
  private remoteVideo: HTMLVideoElement | null
  private remoteAudio: HTMLAudioElement | null
  private wantVideo: boolean
  /** Higher id rolls back on glare. Lower id keeps the offer. */
  private polite: boolean
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private pendingIce: RTCIceCandidateInit[] = []
  private pollTimer: number | null = null
  private disconnectTimer: number | null = null
  private realtime = false
  private seen = new Set<string>()
  private closed = false
  private makingOffer = false
  private micMuted = false
  private camOff = false
  private failNotified = false
  private remoteNotified = false

  constructor(opts: VideoCallOpts) {
    this.localId = opts.localUserId
    this.peerId = opts.peerId
    this.polite = opts.localUserId > opts.peerId
    this.iceServers = opts.iceServers.map((s) => ({
      urls: s.urls,
      username: s.username,
      credential: s.credential,
    }))
    this.sendSignal = opts.sendSignal
    this.pollSignals = opts.pollSignals
    this.onStatus = opts.onStatus
    this.onFailed = opts.onFailed
    this.onIceState = opts.onIceState
    this.onRemoteTrack = opts.onRemoteTrack
    this.localVideo = opts.localVideo ?? null
    this.remoteVideo = opts.remoteVideo ?? null
    this.remoteAudio = opts.remoteAudio ?? null
    this.wantVideo = opts.video !== false
  }

  setElements(
    localVideo: HTMLVideoElement | null,
    remoteVideo: HTMLVideoElement | null,
    remoteAudio: HTMLAudioElement | null,
  ) {
    this.localVideo = localVideo
    this.remoteVideo = remoteVideo
    this.remoteAudio = remoteAudio
    this.attachLocal()
    if (this.remoteStream) this.attachRemote(this.remoteStream)
  }

  /**
   * `preset` is a stream from getUserMedia started inside the click/tap,
   * before any await. iOS Safari drops the user-activation token otherwise.
   */
  async start(preset?: MediaStream | null) {
    this.onStatus?.('Звоним…')
    if (preset) {
      this.localStream = preset
    } else if (!this.localStream) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: this.wantVideo ? { facingMode: 'user' } : false,
        })
      } catch {
        this.onFailed?.(this.wantVideo ? 'Нет доступа к камере/микрофону' : 'Нет доступа к микрофону')
        throw new Error('media denied')
      }
    }
    this.attachLocal()
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.localStream.getTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!))
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) void this.sendSignal(this.peerId, 'ice', ev.candidate.toJSON()).catch(() => {})
    }
    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0] || this.remoteStream || new MediaStream()
      if (!ev.streams[0]) stream.addTrack(ev.track)
      this.attachRemote(stream)
      this.onStatus?.('На связи')
    }
    this.pc.oniceconnectionstatechange = () => {
      this.noteIce(this.pc?.iceConnectionState)
    }
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState
      if (st === 'connected') this.onStatus?.('На связи')
      if (st === 'connecting') this.onStatus?.('Соединяем…')
      if (st === 'failed') this.failHard()
    }
    if (this.localId < this.peerId) await this.offer()
    this.armPoll()
    void this.poll()
    this.onStatus?.('Ожидаем ответ…')
  }

  /** When the chat socket is open, signals arrive here and HTTP poll slows to 30s. */
  setRealtime(on: boolean) {
    if (this.realtime === on) return
    this.realtime = on
    this.armPoll()
  }

  ingest(msg: { id?: string; from_user_id?: string; kind: string; payload?: unknown }) {
    void this.apply([msg as SignalMsg])
  }

  private noteIce(state: RTCIceConnectionState | undefined) {
    if (!state) return
    this.onIceState?.(state)
    if (state === 'connected' || state === 'completed') {
      this.clearDisconnect()
      this.onStatus?.('На связи')
      return
    }
    if (state === 'checking') this.onStatus?.('Соединяем…')
    if (state === 'disconnected') {
      this.onStatus?.('Соединение нестабильно…')
      this.armDisconnect()
    }
    if (state === 'failed') this.failHard()
  }

  private armDisconnect() {
    if (this.disconnectTimer != null || this.closed) return
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null
      const ice = this.pc?.iceConnectionState
      const conn = this.pc?.connectionState
      if (ice === 'disconnected' || ice === 'failed' || conn === 'failed') this.failHard()
    }, 8000)
  }

  private clearDisconnect() {
    if (this.disconnectTimer != null) {
      window.clearTimeout(this.disconnectTimer)
      this.disconnectTimer = null
    }
  }

  private failHard() {
    this.onStatus?.('Не достучались')
    if (!this.failNotified) {
      this.failNotified = true
      this.onFailed?.('Не достучались — сеть или NAT. Попробуйте ещё раз.')
    }
  }

  private armPoll() {
    if (this.pollTimer != null) window.clearInterval(this.pollTimer)
    if (this.closed) return
    const ms = this.realtime ? 30_000 : 400
    this.pollTimer = window.setInterval(() => void this.poll(), ms)
  }

  setMicMuted(muted: boolean) {
    this.micMuted = muted
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
  }

  setCamOff(off: boolean) {
    this.camOff = off
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = !off
    })
  }

  get micMutedState() {
    return this.micMuted
  }
  get camOffState() {
    return this.camOff
  }

  private attachLocal() {
    const el = this.localVideo
    const stream = this.localStream
    if (!this.wantVideo || !el || !stream) return
    markInline(el)
    el.muted = true
    el.defaultMuted = true
    el.srcObject = stream
    void el.play().catch(() => {})
  }

  private attachRemote(stream: MediaStream) {
    this.remoteStream = stream
    // Sound goes through the audio element that was play()'d inside the tap.
    // iOS will not start a second, unmuted <video> that was mounted later.
    if (this.remoteAudio) {
      markInline(this.remoteAudio)
      this.remoteAudio.muted = false
      if (this.remoteAudio.srcObject !== stream) this.remoteAudio.srcObject = stream
      void this.remoteAudio.play().catch(() => {})
    }
    if (this.wantVideo && this.remoteVideo) {
      markInline(this.remoteVideo)
      this.remoteVideo.muted = !!this.remoteAudio
      this.remoteVideo.defaultMuted = !!this.remoteAudio
      if (this.remoteVideo.srcObject !== stream) this.remoteVideo.srcObject = stream
      void this.remoteVideo.play().catch(() => {})
    } else if (!this.remoteAudio && this.remoteVideo) {
      markInline(this.remoteVideo)
      this.remoteVideo.muted = false
      if (this.remoteVideo.srcObject !== stream) this.remoteVideo.srcObject = stream
      void this.remoteVideo.play().catch(() => {})
    }
    if (!this.remoteNotified) {
      this.remoteNotified = true
      this.onRemoteTrack?.()
    }
  }

  private async offer() {
    if (!this.pc || this.makingOffer || this.closed) return
    this.makingOffer = true
    try {
      const offer = await this.pc.createOffer()
      if (this.closed || !this.pc) return
      await this.pc.setLocalDescription(offer)
      await this.sendSignal(this.peerId, 'offer', this.pc.localDescription)
    } finally {
      this.makingOffer = false
    }
  }

  private async poll() {
    if (this.closed || !this.pc) return
    let items: SignalMsg[] = []
    try {
      items = await this.pollSignals()
    } catch {
      return
    }
    await this.apply(items)
  }

  private async flushIce() {
    if (!this.pc?.remoteDescription) return
    const queued = this.pendingIce
    this.pendingIce = []
    for (const cand of queued) {
      try {
        await this.pc.addIceCandidate(cand)
      } catch {
        /* ignore late or duplicate candidates */
      }
    }
  }

  private async apply(items: SignalMsg[]) {
    if (this.closed || !this.pc) return
    for (const msg of items) {
      if (msg.id) {
        if (this.seen.has(msg.id)) continue
        this.seen.add(msg.id)
      }
      if (msg.from_user_id && msg.from_user_id !== this.peerId && (msg.kind as string) !== 'hangup') continue
      try {
        if (msg.kind === 'offer') {
          const desc = asDescription(msg.payload)
          if (!desc) continue
          const collision = this.makingOffer || this.pc.signalingState !== 'stable'
          if (collision && !this.polite) continue
          if (collision) {
            await this.pc.setLocalDescription({ type: 'rollback' })
          }
          await this.pc.setRemoteDescription(desc)
          await this.flushIce()
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          await this.sendSignal(this.peerId, 'answer', this.pc.localDescription)
          this.onStatus?.('Ответили…')
        } else if (msg.kind === 'answer') {
          const desc = asDescription(msg.payload)
          if (desc && this.pc.signalingState === 'have-local-offer') {
            await this.pc.setRemoteDescription(desc)
            await this.flushIce()
          }
        } else if (msg.kind === 'ice' && msg.payload) {
          const cand = asCandidate(msg.payload)
          if (!cand) continue
          if (!this.pc.remoteDescription) {
            this.pendingIce.push(cand)
            continue
          }
          try {
            await this.pc.addIceCandidate(cand)
          } catch {
            this.pendingIce.push(cand)
          }
        } else if ((msg.kind as string) === 'hangup') {
          const reason =
            msg.payload && typeof msg.payload === 'object' && 'reason' in msg.payload
              ? String((msg.payload as { reason?: string }).reason || '')
              : ''
          if (reason === 'declined') {
            this.onStatus?.('Отклонили')
            this.onFailed?.('Собеседник отклонил звонок')
          } else if (reason === 'missed' || reason === 'cancelled') {
            this.onStatus?.('Нет ответа')
            this.onFailed?.('Нет ответа')
          } else {
            this.onStatus?.('Собеседник сбросил')
            this.onFailed?.('Собеседник завершил звонок')
          }
        }
      } catch (e) {
        this.onStatus?.(e instanceof Error ? e.message : 'ошибка сигнала')
      }
    }
  }

  stop() {
    this.closed = true
    this.clearDisconnect()
    if (this.pollTimer != null) window.clearInterval(this.pollTimer)
    try {
      void this.sendSignal(this.peerId, 'hangup', {})
    } catch {
      /* ignore */
    }
    this.pc?.close()
    this.pc = null
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null
    this.remoteStream = null
    this.pendingIce = []
    if (this.localVideo) this.localVideo.srcObject = null
    if (this.remoteVideo) this.remoteVideo.srcObject = null
    if (this.remoteAudio) this.remoteAudio.srcObject = null
  }
}
