import { apiBaseUrl, apiFetch, getAccessToken } from './api'

/** Build stamp. Override with VITE_APP_VERSION when cutting a release. */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0'

const SID_KEY = 'hub_tel_sid'
const SESSION_SENT = 'hub_tel_session_sent'

type EventName =
  | 'session_start'
  | 'screen_view'
  | 'register_open'
  | 'register_submit'
  | 'register_code'
  | 'register_done'
  | 'message_send'

type AdminError = {
  fingerprint: string
  message: string
  stack: string
  route: string
  source: string
  app_version: string
  count: number
  last_seen: string
  user_id?: string
}

export type TelemetryAdmin = {
  online: number
  dau: number
  registrations_today: number
  screens: { route: string; count: number }[]
  funnel: { step: string; label: string; count: number }[]
  errors: AdminError[]
}

const recent = new Map<string, number>()
let windowStart = 0
let windowCount = 0
let started = false

function sessionId(): string {
  try {
    const cur = sessionStorage.getItem(SID_KEY)
    if (cur && /^[A-Za-z0-9_-]{8,64}$/.test(cur)) return cur
    const raw = (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(
      /[^A-Za-z0-9_-]/g,
      '',
    )
    const id = (raw.length >= 8 ? raw : `sid${Date.now().toString(36)}abcd`).slice(0, 64)
    sessionStorage.setItem(SID_KEY, id)
    return id
  } catch {
    return `sid${Date.now().toString(36)}abcd`
  }
}

function scrub(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s()-]{8,}\d/g, '[phone]')
    .slice(0, 4000)
}

function frame(stack: string): string {
  const line = stack.split('\n').map((s) => s.trim()).find((s) => s.startsWith('at ') || s.includes('.ts') || s.includes('.tsx'))
  return (line || stack.split('\n')[0] || '').slice(0, 180)
}

function allow(key: string): boolean {
  const now = Date.now()
  if (now - windowStart > 60_000) {
    windowStart = now
    windowCount = 0
  }
  if (windowCount >= 20) return false
  const prev = recent.get(key)
  if (prev && now - prev < 60_000) return false
  recent.set(key, now)
  windowCount += 1
  if (recent.size > 200) {
    for (const [k, at] of recent) {
      if (now - at > 60_000) recent.delete(k)
    }
  }
  return true
}

function post(path: string, body: unknown) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const tok = getAccessToken()
  if (tok) {
    headers.Authorization = `Bearer ${tok}`
    headers['X-Access-Token'] = tok
  }
  void fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}

function report(source: string, message: string, stack: string, route: string) {
  const clean = scrub(message).slice(0, 500)
  if (!clean || clean.includes('/v1/telemetry')) return
  const key = `${source}|${clean.slice(0, 180)}|${frame(stack)}|${route}`
  if (!allow(key)) return
  post('/v1/telemetry/errors', {
    message: clean,
    stack: scrub(stack).slice(0, 8000),
    route: route.slice(0, 180),
    user_agent: navigator.userAgent.slice(0, 240),
    app_version: APP_VERSION,
  })
}

export function reportBoundary(err: unknown, componentStack?: string | null) {
  const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'render error')
  report('client', error.message || 'render error', `${error.stack || ''}\n${componentStack || ''}`, location.pathname)
}

export function reportApiFailure(path: string, status: number, detail: string) {
  if (path.split('?')[0].startsWith('/v1/telemetry')) return
  const message = status > 0 ? `API ${status} ${path.split('?')[0]}` : `Сеть: ${path.split('?')[0]}`
  report('client', message, detail || message, path.split('?')[0])
}

let lastScreen = ''
let lastScreenAt = 0

export function trackEvent(name: EventName, route = '') {
  const screen = (route || (typeof location !== 'undefined' ? location.pathname : '')).split('?')[0]
  if (name === 'screen_view') {
    const now = Date.now()
    if (screen === lastScreen && now - lastScreenAt < 800) return
    lastScreen = screen
    lastScreenAt = now
  } else {
    const key = `ev:${name}:${screen}`
    if (!allow(key)) return
  }
  post('/v1/telemetry/events', {
    name,
    route: screen,
    session_id: sessionId(),
  })
}

export function initTelemetry() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('error', (event) => {
    const message = event.message || 'window error'
    if (message.includes('ResizeObserver loop')) return
    const stack = event.error instanceof Error ? event.error.stack || '' : `${event.filename || ''}:${event.lineno || 0}`
    report('client', message, stack, location.pathname)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const error = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'unhandled rejection')
    report('client', error.message || 'unhandled rejection', error.stack || '', location.pathname)
  })
  try {
    if (sessionStorage.getItem(SESSION_SENT) !== '1') {
      sessionStorage.setItem(SESSION_SENT, '1')
      trackEvent('session_start')
    }
  } catch {
    trackEvent('session_start')
  }
}

export function apiTelemetryAdmin(): Promise<TelemetryAdmin> {
  return apiFetch<TelemetryAdmin>('/v1/telemetry/admin')
}
