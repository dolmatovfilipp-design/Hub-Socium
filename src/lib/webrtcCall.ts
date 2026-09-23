/**
 * T6: 1:1 WebRTC video over DM call signaling (HTTP poll).
 * Glare: lower user id creates offer. STUN only — no TURN (NAT may fail).
 */
import type { IceServer, SignalMsg } from './webrtcVoice'

export type VideoCallOpts = {
  localUserId: string
  peerId: string
  iceServers: IceServer[]
  sendSignal: (to: string, kind: 'offer' | 'answer' | 'ice', payload: unknown) => Promise<void>
  pollSignals: () => Promise<SignalMsg[]>
  onStatus?: (msg: string) => void
  localVideo?: HTMLVideoElement | null
  remoteVideo?: HTMLVideoElement | null
}

/** Standalone 1:1 video session with explicit video elements. */
export class DmVideoSession {
  private localId: string
  private peerId: string
  private iceServers: RTCIceServer[]
  private sendSignal: VideoCallOpts['sendSignal']
  private pollSignals: VideoCallOpts['pollSignals']
  private onStatus?: (m: string) => void
  private localVideo: HTMLVideoElement | null
  private remoteVideo: HTMLVideoElement | null
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private pollTimer: number | null = null
  private closed = false
  private makingOffer = false

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
    this.localVideo = opts.localVideo ?? null
    this.remoteVideo = opts.remoteVideo ?? null
  }

  async start() {
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
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
      this.onStatus?.('Видео пира')
    }
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState
      if (st === 'connected') this.onStatus?.('Связь есть')
      if (st === 'failed' || st === 'disconnected') this.onStatus?.(`Связь: ${st} (STUN only)`)
    }
    if (this.localId < this.peerId) await this.offer()
    this.pollTimer = window.setInterval(() => void this.poll(), 1000)
    void this.poll()
    this.onStatus?.('Камера включена')
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
        }
      } catch (e) {
        this.onStatus?.(e instanceof Error ? e.message : 'signal error')
      }
    }
  }

  stop() {
    this.closed = true
    if (this.pollTimer != null) window.clearInterval(this.pollTimer)
    this.pc?.close()
    this.pc = null
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null
    if (this.localVideo) this.localVideo.srcObject = null
    if (this.remoteVideo) this.remoteVideo.srcObject = null
  }
}
