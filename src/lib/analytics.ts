/** Optional PostHog / Plausible — no-op without keys. */
declare global {
  interface Window {
    posthog?: { capture: (event: string, props?: Record<string, unknown>) => void; init?: (...args: unknown[]) => void }
    plausible?: (event: string, opts?: { props?: Record<string, unknown> }) => void
  }
}

export function initAnalytics(): boolean {
  const posthogKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined
  const posthogHost = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://app.posthog.com'
  const plausibleDomain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined

  if (posthogKey && typeof document !== 'undefined') {
    const s = document.createElement('script')
    s.async = true
    s.src = `${posthogHost.replace(/\/$/, '')}/static/array.js`
    s.onload = () => {
      try {
        // Minimal stub until full posthog-js is added; capture via window if injected
        ;(window as unknown as { posthog?: { capture: (e: string) => void } }).posthog = {
          capture: (event: string) => {
            console.debug('[analytics]', event)
          },
        }
      } catch {
        /* ignore */
      }
    }
    document.head.appendChild(s)
    console.info('[analytics] PostHog key set — wire posthog-js for production')
    return true
  }

  if (plausibleDomain && typeof document !== 'undefined') {
    const s = document.createElement('script')
    s.defer = true
    s.dataset.domain = plausibleDomain
    s.src = 'https://plausible.io/js/script.js'
    document.head.appendChild(s)
    return true
  }

  return false
}

export function track(event: string, props?: Record<string, unknown>) {
  try {
    window.posthog?.capture?.(event, props)
    window.plausible?.(event, props ? { props } : undefined)
  } catch {
    /* ignore */
  }
}
