import * as Sentry from '@sentry/react'

const SENSITIVE_KEYS =
  /^(authorization|cookie|password|passwd|token|access_token|refresh_token|jwt|email|phone|secret|api[_-]?key)$/i

function scrubValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.test(key)) return '[Filtered]'
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return value.map((v, i) => scrubValue(String(i), v))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(k, v)
    }
    return out
  }
  if (typeof value === 'string' && /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) {
    return '[Filtered JWT]'
  }
  return value
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request?.headers) {
    const headers = { ...event.request.headers }
    for (const k of Object.keys(headers)) {
      if (/^(authorization|cookie)$/i.test(k)) {
        headers[k] = '[Filtered]'
      }
    }
    event.request.headers = headers
  }
  if (event.request?.cookies) {
    event.request.cookies = {}
  }
  if (event.request?.data) {
    event.request.data = scrubValue('body', event.request.data)
  }
  if (event.extra) {
    event.extra = scrubValue('extra', event.extra) as Record<string, unknown>
  }
  if (event.contexts) {
    event.contexts = scrubValue('contexts', event.contexts) as typeof event.contexts
  }
  if (event.user) {
    const { id, ip_address } = event.user
    event.user = { id, ip_address }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => {
      const data = b.data ? (scrubValue('data', b.data) as Record<string, unknown>) : undefined
      return { ...b, data }
    })
  }
  return event
}

/** Init Sentry only when VITE_SENTRY_DSN is set; otherwise no-op. */
export function initSentry(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return false

  const environment = import.meta.env.VITE_SENTRY_ENV || 'development'
  const release = import.meta.env.VITE_SENTRY_RELEASE || undefined

  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event)
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = scrubValue('data', breadcrumb.data) as Record<string, unknown>
      }
      if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
        if (breadcrumb.data && 'Authorization' in (breadcrumb.data as object)) {
          ;(breadcrumb.data as Record<string, unknown>).Authorization = '[Filtered]'
        }
      }
      return breadcrumb
    },
  })
  return true
}

export { Sentry }
