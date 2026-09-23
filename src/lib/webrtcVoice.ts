/**
 * Mesh WebRTC audio for voice rooms (P5).
 * Signaling: HTTP poll POST/GET /v1/voice-rooms/{id}/signal(s).
 * Glare avoided: lower user id creates the offer.
 * No TURN — may fail behind symmetric NAT (honest PARTIAL).
 */

export type IceServer = { urls: string | string[]; username?: string; credential?: string }

export type SignalMsg = {
  id: string
  from_user_id: string
  kind: 'offer' | 'answer' | 'ice'
  payload: any
}

type SendSignal = (toUserId: string, kind: 'offer' | 'answer' | 'ice', payload: unknown) => Promise<void>
type PollSignals = () => Promise<SignalMsg[]>

export type VoiceMeshOptions = {
  localUserId: string
  peerIds: string[]
  iceServers: IceServer[]
  muted: boolean
  sendSignal: SendSignal
  pollSignals: PollSignals
  onStatus?: (msg: string) => void
  /** reserved for T6 / future video — unused in voice rooms */
  video?: boolean
}

export class VoiceMesh {
  private localId: string
  private iceServers: RTCIceServer[]
  private sendSignal: SendSignal
  private pollSignals: PollSignals
  private onStatus?: (msg: string) => void
  private video: boolean
  private pcs = new Map<string, RTCPeerConnection>()
  private makingOffer = new Map<string, boolean>()
  private localStream: MediaStream | null = null
  private remoteAudio = new Map<string, HTMLAudioElement>()
  private pollTimer: number | null = null
  private closed = false
  private muted = true

  constructor(opts: VoiceMeshOptions) {
    this.localId = opts.localUserId
    this.iceServers = opts.iceServers.map((s) => ({
      urls: s.urls,
      username: s.username,
      credential: s.credential,
    }))
    this.sendSignal = opts.sendSignal
    this.pollSignals = opts.pollSignals
    this.onStatus = opts.onStatus
    this.video = !!opts.video
    this.muted = opts.muted
  }

  async start(peerIds: string[]) {
    if (this.closed) return
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: this.video,
      })
      this.applyMute()
      this.onStatus?.('Микрофон получен')
    } catch (e) {
      this.onStatus?.(
        e instanceof Error ? `Нет доступа к микрофону: ${e.message}` : 'Нет доступа к микрофону',
      )
      throw e
    }
    for (const peer of peerIds) {
      if (peer !== this.localId) await this.ensurePeer(peer)
    }
    this.pollTimer = window.setInterval(() => {
      void this.poll()
    }, 1200)
    void this.poll()
  }

  async syncPeers(peerIds: string[]) {
    const want = new Set(peerIds.filter((id) => id && id !== this.localId))
    for (const id of [...this.pcs.keys()]) {
      if (!want.has(id)) this.dropPeer(id)
    }
    for (const id of want) {
      if (!this.pcs.has(id)) await this.ensurePeer(id)
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.applyMute()
  }

  private applyMute() {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !this.muted
    })
  }

  stop() {
    this.closed = true
    if (this.pollTimer != null) window.clearInterval(this.pollTimer)
    this.pollTimer = null
    for (const id of [...this.pcs.keys()]) this.dropPeer(id)
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null
  }

  private polite(peerId: string) {
    // Lower id is polite (creates offers)
    return this.localId < peerId
  }

  private async ensurePeer(peerId: string) {
    if (this.pcs.has(peerId) || this.closed) return
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pcs.set(peerId, pc)

    this.localStream?.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream!)
    })

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || this.closed) return
      void this.sendSignal(peerId, 'ice', ev.candidate.toJSON()).catch(() => {})
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track])
      let audio = this.remoteAudio.get(peerId)
      if (!audio) {
        audio = new Audio()
        audio.autoplay = true
        ;(audio as any).playsInline = true
        this.remoteAudio.set(peerId, audio)
      }
      audio.srcObject = stream
      void audio.play().catch(() => {})
      this.onStatus?.(`Аудио от пира…`)
    }

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        this.onStatus?.(`Связь: ${st} (без TURN возможны сбои NAT)`)
      } else if (st === 'connected') {
        this.onStatus?.('Связь установлена')
      }
    }

    if (this.polite(peerId)) {
      await this.createOffer(peerId, pc)
    }
  }

  private async createOffer(peerId: string, pc: RTCPeerConnection) {
    if (this.makingOffer.get(peerId)) return
    this.makingOffer.set(peerId, true)
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.sendSignal(peerId, 'offer', pc.localDescription)
    } catch {
      /* ignore */
    } finally {
      this.makingOffer.set(peerId, false)
    }
  }

  private dropPeer(peerId: string) {
    const pc = this.pcs.get(peerId)
    if (pc) {
      pc.close()
      this.pcs.delete(peerId)
    }
    const audio = this.remoteAudio.get(peerId)
    if (audio) {
      audio.srcObject = null
      this.remoteAudio.delete(peerId)
    }
  }

  private async poll() {
    if (this.closed) return
    let items: SignalMsg[] = []
    try {
      items = await this.pollSignals()
    } catch {
      return
    }
    for (const msg of items) {
      await this.handleSignal(msg)
    }
  }

  private async handleSignal(msg: SignalMsg) {
    const peerId = msg.from_user_id
    if (!peerId || peerId === this.localId) return
    await this.ensurePeer(peerId)
    const pc = this.pcs.get(peerId)
    if (!pc) return

    try {
      if (msg.kind === 'offer') {
        await pc.setRemoteDescription(msg.payload)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await this.sendSignal(peerId, 'answer', pc.localDescription)
      } else if (msg.kind === 'answer') {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(msg.payload)
        }
      } else if (msg.kind === 'ice') {
        if (msg.payload) {
          try {
            await pc.addIceCandidate(msg.payload)
          } catch {
            /* race before remote desc */
          }
        }
      }
    } catch (e) {
      this.onStatus?.(e instanceof Error ? e.message : 'signal error')
    }
  }
}
