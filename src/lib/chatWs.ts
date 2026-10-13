/**
 * Chat realtime WebSocket (/v1/ws). Auth is ?access_token=.
 * The shell holds the socket open. Screens listen; they do not own the connection.
 */
import { apiBaseUrl, getAccessToken } from './api'

export type ChatWsEvent =
  | { type: 'message'; conversation_id: string; message: any }
  | { type: 'typing'; conversation_id: string; user_id: string }
  | { type: 'subscribed'; conversation_id: string }
  | { type: 'call_signal'; conversation_id: string; id?: string; from_user_id?: string; to_user_id?: string; kind?: string; payload?: unknown; call_id?: string }
  | { type: 'incoming_call'; conversation_id: string; call_id?: string; [k: string]: unknown }
  | { type: 'pong' }
  | { type: string; [k: string]: unknown }

type Handler = (ev: ChatWsEvent) => void
type StatusHandler = (open: boolean) => void

let socket: WebSocket | null = null
let handlers = new Set<Handler>()
let statusHandlers = new Set<StatusHandler>()
let reconnectTimer: number | null = null
let intentionalClose = false
let held = false
let subscribedConv: string | null = null
let opened = false

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

function emitStatus(open: boolean) {
  if (opened === open) return
  opened = open
  statusHandlers.forEach((fn) => fn(open))
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
    emitStatus(true)
    flushSubscribe()
  }
  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(String(ev.data)) as ChatWsEvent
      handlers.forEach((h) => h(data))
    } catch {
      /* ignore malformed frames */
    }
  }
  socket.onclose = () => {
    socket = null
    emitStatus(false)
    if (!intentionalClose && (held || handlers.size > 0)) scheduleReconnect()
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
    if (held || handlers.size > 0) connect()
  }, 1500)
}

function maybeClose() {
  if (held || handlers.size > 0) return
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
  emitStatus(false)
}

/** Keep /v1/ws up for the signed-in shell. */
export function chatWsHold(): () => void {
  held = true
  connect()
  return () => {
    held = false
    maybeClose()
  }
}

export function chatWsListen(onEvent: Handler): () => void {
  handlers.add(onEvent)
  connect()
  return () => {
    handlers.delete(onEvent)
    maybeClose()
  }
}

export function chatWsOnStatus(onStatus: StatusHandler): () => void {
  statusHandlers.add(onStatus)
  onStatus(chatWsConnected())
  return () => {
    statusHandlers.delete(onStatus)
  }
}

export function chatWsSubscribe(conversationId: string, onEvent: Handler): () => void {
  subscribedConv = conversationId
  const stop = chatWsListen(onEvent)
  connect()
  flushSubscribe()
  return () => {
    if (subscribedConv === conversationId) subscribedConv = null
    stop()
  }
}

export function chatWsConnected(): boolean {
  return !!socket && socket.readyState === WebSocket.OPEN
}
