/**
 * Chat realtime WebSocket (/v1/ws). Falls back silently — Chat keeps short poll.
 */
import { apiBaseUrl, getAccessToken } from './api'

export type ChatWsEvent =
  | { type: 'message'; conversation_id: string; message: any }
  | { type: 'typing'; conversation_id: string; user_id: string }
  | { type: 'subscribed'; conversation_id: string }
  | { type: 'ws_connected' }    // НОВОЕ: сигнал для загрузки пропущенных сообщений
  | { type: 'ws_disconnected' } // НОВОЕ: сигнал для UI, что связь потеряна
  | { type: 'pong' }
  | { type: string; [k: string]: unknown }

type Handler = (ev: ChatWsEvent) => void

let socket: WebSocket | null = null
let handlers = new Set<Handler>()
let reconnectTimer: number | null = null
let pingTimer: number | null = null
let intentionalClose = false
let subscribedConv: string | null = null
let reconnectDelay = 1000 // Начинаем с 1 секунды

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

function startHeartbeat() {
  if (pingTimer) window.clearInterval(pingTimer)
  // Отправляем "ping" каждые 25 секунд, чтобы прокси не рвал соединение
  pingTimer = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping' }))
    }
  }, 25000)
}

function stopHeartbeat() {
  if (pingTimer) {
    window.clearInterval(pingTimer)
    pingTimer = null
  }
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
    reconnectDelay = 1000 // Сбрасываем задержку при успехе
    flushSubscribe()
    startHeartbeat()
    // Сообщаем приложению, что связь есть (чтобы оно загрузило пропущенные сообщения)
    handlers.forEach((h) => h({ type: 'ws_connected' }))
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
    stopHeartbeat()
    handlers.forEach((h) => h({ type: 'ws_disconnected' }))
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
  }, reconnectDelay)
  // Увеличиваем задержку (максимум до 15 секунд), чтобы не спамить сервер
  reconnectDelay = Math.min(reconnectDelay * 1.5, 15000)
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
      stopHeartbeat()
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

// НОВОЕ: функция для отправки сообщений (например, статуса "прочитано") через сокет
export function chatWsSend(payload: Record<string, unknown>): boolean {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
    return true
  }
  return false
}
