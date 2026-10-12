export type OutgoingCallRequest = {
  conversationId: string
  peerId: string
  peerName: string
  peerAvatar?: string
  video: boolean
}

type Listener = (req: OutgoingCallRequest) => void
const listeners = new Set<Listener>()

export function requestOutgoingCall(req: OutgoingCallRequest) {
  listeners.forEach((fn) => fn(req))
}

export function subscribeOutgoingCalls(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
