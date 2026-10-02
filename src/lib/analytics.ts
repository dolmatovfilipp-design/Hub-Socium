/** Optional PostHog / Plausible — no-op without keys. */
declare global {
  interface Window {
    posthog?: {
      capture: (event: string, props?: Record<string, unknown>) => void
      init?: (key: string, opts?: Record<string, unknown>) => void
    }
    plausible?: (event: string, opts?: { props?: Record<string, unknown> }) => void
  }
}

let ready = false

export function initAnalytics(): boolean {
  const posthogKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined
  const posthogHost =
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com'
  const plausibleDomain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined

  if (posthogKey && typeof document !== 'undefined') {
    // Official snippet loader — activates when VITE_POSTHOG_KEY is set
    const s = document.createElement('script')
    s.async = true
    s.src = `${posthogHost.replace(/\/$/, '')}/static/array.js`
    s.onload = () => {
      try {
        window.posthog?.init?.(posthogKey, {
          api_host: posthogHost,
          person_profiles: 'identified_only',
          capture_pageview: true,
        })
        ready = true
      } catch {
        /* ignore */
      }
    }
    // stub before load so early track() calls don't throw
    window.posthog = window.posthog || {
      capture: () => {},
      init: () => {},
    }
    document.head.appendChild(s)
    console.info('[analytics] PostHog: ключ найден, SDK грузится')
    return true
  }

  if (plausibleDomain && typeof document !== 'undefined') {
    const s = document.createElement('script')
    s.defer = true
    s.dataset.domain = plausibleDomain
    s.src = 'https://plausible.io/js/script.js'
    document.head.appendChild(s)
    ready = true
    return true
  }

  return false
}

export function track(event: string, props?: Record<string, unknown>) {
  try {
    if (!ready && !window.posthog && !window.plausible) return
    window.posthog?.capture?.(event, props)
    window.plausible?.(event, props ? { props } : undefined)
  } catch {
    /* ignore */
  }
}
