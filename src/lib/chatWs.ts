/**
 * Chat realtime WebSocket (/v1/ws). Falls back silently — Chat keeps short poll.
 */
import { apiBaseUrl, getAccessToken } from './api'

export type ChatWsEvent =
  | { type: 'message'; conversation_id: string; message: any }
  | { type: 'typing'; conversation_id: string; user_id: string }
  | { type: 'subscribed'; conversation_id: string }
  | { type: 'pong' }
  | { type: string; [k: string]: unknown }

type Handler = (ev: ChatWsEvent) => void

let socket: WebSocket | null = null
let handlers = new Set<Handler>()
let reconnectTimer: number | null = null
let intentionalClose = false
let subscribedConv: string | null = null

function wsURL(): string {
  const token = getAccessToken() || ''
  const base = apiBaseUrl()
  let origin: string
  if (base) {
    origin = base.replace(/^http/, 'ws')
  } else if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    origin = `${proto}//${window.location.host}`
  } else {
    origin = 'ws://127.0.0.1:8080'
  }
  const q = token ? `?access_token=${encodeURIComponent(token)}` : ''
  return `${origin}/v1/ws${q}`
}

function flushSubscribe() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !subscribedConv) return
  socket.send(JSON.stringify({ type: 'subscribe', conversation_id: subscribedConv }))
}

function connect() {
  if (typeof window === 'undefined') return
  if (!getAccessToken()) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }
  intentionalClose = false
  try {
    socket = new WebSocket(wsURL())
  } catch {
    scheduleReconnect()
    return
  }
  socket.onopen = () => {
    flushSubscribe()
  }
  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(String(ev.data)) as ChatWsEvent
      handlers.forEach((h) => h(data))
    } catch {
      /* ignore */
    }
  }
  socket.onclose = () => {
    socket = null
    if (!intentionalClose) scheduleReconnect()
  }
  socket.onerror = () => {
    try {
      socket?.close()
    } catch {
      /* ignore */
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer != null) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 1500)
}

export function chatWsSubscribe(conversationId: string, onEvent: Handler): () => void {
  subscribedConv = conversationId
  handlers.add(onEvent)
  connect()
  flushSubscribe()
  return () => {
    handlers.delete(onEvent)
    if (handlers.size === 0) {
      intentionalClose = true
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
      socket = null
      subscribedConv = null
    }
  }
}

export function chatWsConnected(): boolean {
  return !!socket && socket.readyState === WebSocket.OPEN
}
