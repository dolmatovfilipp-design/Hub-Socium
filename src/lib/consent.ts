/** Phase-1 152-FZ consent gate (local). Prefer syncing to API when available. */
const CONSENT_KEY = 'hub-consent-v1'
const LEGACY_KEYS = ['hub_consent_152', 'hub-consent-152', 'hub_consent_v1'] as const

export function getLocalConsent152(): boolean {
  if (typeof window === 'undefined') return false
  if (window.localStorage.getItem(CONSENT_KEY) === '1') return true
  for (const k of LEGACY_KEYS) {
    if (window.localStorage.getItem(k) === '1') {
      window.localStorage.setItem(CONSENT_KEY, '1')
      return true
    }
  }
  return false
}

export function setLocalConsent152(accepted: boolean) {
  if (typeof window === 'undefined') return
  if (accepted) {
    window.localStorage.setItem(CONSENT_KEY, '1')
    for (const k of LEGACY_KEYS) window.localStorage.removeItem(k)
  } else {
    window.localStorage.removeItem(CONSENT_KEY)
    for (const k of LEGACY_KEYS) window.localStorage.removeItem(k)
  }
}
