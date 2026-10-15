const DISMISS_KEY = 'hub_a2hs_dismissed'
export const SHOW_A2HS_EVENT = 'hub:show-a2hs'

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  )
}

function isAppleMobile(): boolean {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** Safari and Yandex Browser on iPhone/iPad. Other iOS browsers cannot install a Home Screen web app the same way. */
export function isIosInstallBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  if (!isAppleMobile()) return false
  const ua = navigator.userAgent || ''
  if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)) return false
  return /YaBrowser/i.test(ua) || /Safari/i.test(ua)
}

export function a2hsDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissA2HS(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function replayA2HS(): void {
  window.dispatchEvent(new Event(SHOW_A2HS_EVENT))
}

export function shouldAutoShowA2HS(): boolean {
  return isIosInstallBrowser() && !isStandalone() && !a2hsDismissed()
}
