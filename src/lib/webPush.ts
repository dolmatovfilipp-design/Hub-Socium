import { apiPushPublicKey, apiSubscribePush, apiUnsubscribePush, isApiMode } from './api'

const ENDPOINT_KEY = 'hub_push_endpoint'
export const PUSH_DISMISS_KEY = 'hub_push_ask_dismissed'

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushEndpoint(): string {
  try {
    return localStorage.getItem(ENDPOINT_KEY) || sessionStorage.getItem(ENDPOINT_KEY) || ''
  } catch {
    return ''
  }
}

function rememberEndpoint(endpoint: string) {
  try {
    localStorage.setItem(ENDPOINT_KEY, endpoint)
    sessionStorage.removeItem(ENDPOINT_KEY)
  } catch {
    /* ignore */
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  return reg
}

export async function loadVapidPublicKey(): Promise<string> {
  if (isApiMode()) {
    try {
      const res = await apiPushPublicKey()
      const key = String(res.public_key || '').trim()
      if (key) return key
    } catch {
      /* fall through to the build-time key */
    }
  }
  const baked = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim()
  if (!baked) throw new Error('Push не настроен')
  return baked
}

/** Call from a click or tap. iOS only shows the permission sheet after a gesture. */
export async function enableWebPush(): Promise<string> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Браузер не поддерживает уведомления')
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Разрешение на уведомления не выдано')
  const key = await loadVapidPublicKey()
  const reg = await registerServiceWorker()
  if (!reg) throw new Error('Браузер не поддерживает уведомления')
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
  }
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Не удалось получить подписку')
  }
  if (isApiMode()) {
    await apiSubscribePush({
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    })
  }
  rememberEndpoint(json.endpoint)
  try {
    localStorage.removeItem(PUSH_DISMISS_KEY)
  } catch {
    /* ignore */
  }
  return 'Подписка сохранена'
}

export async function disableWebPush(): Promise<void> {
  const endpoint = pushEndpoint()
  if (endpoint && isApiMode()) {
    try {
      await apiUnsubscribePush(endpoint)
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(ENDPOINT_KEY)
    sessionStorage.removeItem(ENDPOINT_KEY)
  } catch {
    /* ignore */
  }
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    await sub?.unsubscribe()
  }
}

/** Permission was already granted, so no extra sheet is needed. */
export async function syncGrantedPush(): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (!isApiMode()) return
  const reg = await registerServiceWorker()
  if (!reg) return
  const existing = await reg.pushManager.getSubscription()
  if (existing && pushEndpoint() === existing.endpoint) return
  await enableWebPush()
}
