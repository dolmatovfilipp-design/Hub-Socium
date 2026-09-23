/**
 * T6: 1:1 WebRTC video over DM call signaling (HTTP poll).
 * Glare: lower user id creates offer.
 * ICE: use servers from API (STUN + TURN via HUB_TURN_* or openrelay demo).
 */
import type { IceServer, SignalMsg } from './webrtcVoice'

export type VideoCallOpts = {
  localUserId: string
  peerId: string
  iceServers: IceServer[]
  sendSignal: (to: string, kind: 'offer' | 'answer' | 'ice' | 'hangup', payload: unknown) => Promise<void>
  pollSignals: () => Promise<SignalMsg[]>
  onStatus?: (msg: string) => void
  onFailed?: (msg: string) => void
  localVideo?: HTMLVideoElement | null
  remoteVideo?: HTMLVideoElement | null
}

/** Standalone 1:1 video session with mute / camera toggles. */
export class DmVideoSession {
  private localId: string
  private peerId: string
  private iceServers: RTCIceServer[]
  private sendSignal: VideoCallOpts['sendSignal']
  private pollSignals: VideoCallOpts['pollSignals']
  private onStatus?: (m: string) => void
  private onFailed?: (m: string) => void
  private localVideo: HTMLVideoElement | null
  private remoteVideo: HTMLVideoElement | null
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private pollTimer: number | null = null
  private closed = false
  private makingOffer = false
  private micMuted = false
  private camOff = false
  private failNotified = false

  constructor(opts: VideoCallOpts) {
    this.localId = opts.localUserId
    this.peerId = opts.peerId
    this.iceServers = opts.iceServers.map((s) => ({
      urls: s.urls,
      username: s.username,
      credential: s.credential,
    }))
    this.sendSignal = opts.sendSignal
    this.pollSignals = opts.pollSignals
    this.onStatus = opts.onStatus
    this.onFailed = opts.onFailed
    this.localVideo = opts.localVideo ?? null
    this.remoteVideo = opts.remoteVideo ?? null
  }

  async start() {
    this.onStatus?.('Звоним…')
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      this.onFailed?.('Нет доступа к камере/микрофону')
      throw new Error('media denied')
    }
    if (this.localVideo) {
      this.localVideo.srcObject = this.localStream
      this.localVideo.muted = true
      void this.localVideo.play().catch(() => {})
    }
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.localStream.getTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!))
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) void this.sendSignal(this.peerId, 'ice', ev.candidate.toJSON()).catch(() => {})
    }
    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track])
      if (this.remoteVideo) {
        this.remoteVideo.srcObject = stream
        void this.remoteVideo.play().catch(() => {})
      }
      this.onStatus?.('На связи')
    }
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState
      if (st === 'connected') this.onStatus?.('На связи')
      if (st === 'connecting') this.onStatus?.('Соединяем…')
      if (st === 'failed' || st === 'disconnected') {
        this.onStatus?.('Не достучались')
        if (!this.failNotified) {
          this.failNotified = true
          this.onFailed?.('Не достучались — сеть или NAT. Попробуйте ещё раз.')
        }
      }
    }
    if (this.localId < this.peerId) await this.offer()
    this.pollTimer = window.setInterval(() => void this.poll(), 1000)
    void this.poll()
    this.onStatus?.('Ожидаем ответ…')
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

  private async offer() {
    if (!this.pc || this.makingOffer) return
    this.makingOffer = true
    try {
      const offer = await this.pc.createOffer()
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
    for (const msg of items) {
      if (msg.from_user_id !== this.peerId) continue
      try {
        if (msg.kind === 'offer') {
          await this.pc.setRemoteDescription(msg.payload)
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          await this.sendSignal(this.peerId, 'answer', this.pc.localDescription)
          this.onStatus?.('Ответили…')
        } else if (msg.kind === 'answer') {
          if (this.pc.signalingState === 'have-local-offer') {
            await this.pc.setRemoteDescription(msg.payload)
          }
        } else if (msg.kind === 'ice' && msg.payload) {
          try {
            await this.pc.addIceCandidate(msg.payload)
          } catch {
            /* ignore */
          }
        } else if ((msg.kind as string) === 'hangup') {
          this.onStatus?.('Собеседник сбросил')
          this.onFailed?.('Собеседник завершил звонок')
        }
      } catch (e) {
        this.onStatus?.(e instanceof Error ? e.message : 'ошибка сигнала')
      }
    }
  }

  stop() {
    this.closed = true
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
    if (this.localVideo) this.localVideo.srcObject = null
    if (this.remoteVideo) this.remoteVideo.srcObject = null
  }
}
