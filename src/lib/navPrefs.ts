/** Bottom nav preferences — localStorage MVP */

export type NavItemId =
  | 'home'
  | 'messages'
  | 'activity'
  | 'profile'
  | 'explore'
  | 'video'
  | 'music'

export type NavThemeId = 'graphite' | 'black' | 'white' | 'neon' | 'beige'

export type NavPrefs = {
  /** Visible items in display order */
  order: NavItemId[]
  /** Scale multiplier for pill height / icons (0.85–1.2) */
  scale: number
  theme: NavThemeId
}

export const NAV_STORAGE_KEY = 'hub-nav-prefs-v1'

export const NAV_CATALOG: Record<
  NavItemId,
  { label: string; to: string; end?: boolean; optional?: boolean; center?: boolean }
> = {
  home: { label: 'Главная', to: '/app', end: true },
  messages: { label: 'Сообщения', to: '/app/messages' },
  activity: { label: 'Действия', to: '/app/activity' },
  profile: { label: 'Профиль', to: '/app/profile' },
  explore: { label: 'Найти', to: '/app/explore', optional: true },
  video: { label: 'Видео', to: '/app/clips', optional: true, center: true },
  music: { label: 'Музыка', to: '/app/music', optional: true, center: true },
}

/** Default: Главная · Сообщения · Действия · Профиль (no +) */
export const DEFAULT_NAV_PREFS: NavPrefs = {
  order: ['home', 'messages', 'activity', 'profile'],
  scale: 1,
  theme: 'graphite',
}

export const NAV_THEME_META: Record<
  NavThemeId,
  { label: string; preview: string }
> = {
  graphite: { label: 'Графитовый', preview: 'linear-gradient(135deg,#2a2a2e,#1a1a1c)' },
  black: { label: 'Чёрный', preview: 'linear-gradient(135deg,#141414,#0a0a0a)' },
  white: { label: 'Белый', preview: 'linear-gradient(135deg,#f2f2f4,#e4e4e8)' },
  neon: { label: 'Неоновый', preview: 'linear-gradient(135deg,#1a2433,#15202b)' },
  beige: { label: 'Бежевый', preview: 'linear-gradient(135deg,#2a2620,#1c1914)' },
}

const ALL_IDS = Object.keys(NAV_CATALOG) as NavItemId[]

function sanitize(raw: Partial<NavPrefs> | null | undefined): NavPrefs {
  const orderRaw = Array.isArray(raw?.order) ? raw!.order : DEFAULT_NAV_PREFS.order
  const seen = new Set<NavItemId>()
  const order: NavItemId[] = []
  for (const id of orderRaw) {
    if (ALL_IDS.includes(id as NavItemId) && !seen.has(id as NavItemId)) {
      seen.add(id as NavItemId)
      order.push(id as NavItemId)
    }
  }
  if (order.length < 2) {
    return { ...DEFAULT_NAV_PREFS }
  }
  let scale = typeof raw?.scale === 'number' ? raw.scale : 1
  if (!Number.isFinite(scale)) scale = 1
  scale = Math.min(1.2, Math.max(0.85, scale))
  const theme = (raw?.theme && raw.theme in NAV_THEME_META ? raw.theme : 'graphite') as NavThemeId
  return { order, scale, theme }
}

export function loadNavPrefs(): NavPrefs {
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_NAV_PREFS, order: [...DEFAULT_NAV_PREFS.order] }
    return sanitize(JSON.parse(raw) as Partial<NavPrefs>)
  } catch {
    return { ...DEFAULT_NAV_PREFS, order: [...DEFAULT_NAV_PREFS.order] }
  }
}

export function saveNavPrefs(prefs: NavPrefs): void {
  const next = sanitize(prefs)
  localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(next))
  applyNavTheme(next)
  window.dispatchEvent(new CustomEvent('hub-nav-prefs', { detail: next }))
}

export function applyNavTheme(prefs: NavPrefs = loadNavPrefs()): void {
  const root = document.documentElement
  root.setAttribute('data-nav-theme', prefs.theme)
  root.style.setProperty('--hub-nav-scale', String(prefs.scale))
  const base = 56 * prefs.scale
  root.style.setProperty('--hub-nav-pill-h', `${Math.round(base)}px`)
  root.style.setProperty('--hub-nav-height', `${Math.round(base + 16)}px`)
}

export function isNavItemVisible(prefs: NavPrefs, id: NavItemId): boolean {
  return prefs.order.includes(id)
}

export function toggleOptionalNav(prefs: NavPrefs, id: 'video' | 'music' | 'explore'): NavPrefs {
  if (prefs.order.includes(id)) {
    const order = prefs.order.filter((x) => x !== id)
    if (order.length < 2) return prefs
    return { ...prefs, order }
  }
  // Insert center optionals in the middle; explore near messages
  const order = [...prefs.order]
  if (id === 'explore') {
    const msgIdx = order.indexOf('messages')
    order.splice(msgIdx >= 0 ? msgIdx + 1 : Math.min(1, order.length), 0, id)
  } else {
    // video / music → middle of bar
    const mid = Math.floor(order.length / 2)
    order.splice(mid, 0, id)
  }
  return { ...prefs, order }
}

export function moveNavItem(prefs: NavPrefs, id: NavItemId, dir: -1 | 1): NavPrefs {
  const idx = prefs.order.indexOf(id)
  if (idx < 0) return prefs
  const j = idx + dir
  if (j < 0 || j >= prefs.order.length) return prefs
  const order = [...prefs.order]
  ;[order[idx], order[j]] = [order[j], order[idx]]
  return { ...prefs, order }
}

export function setNavItemVisible(prefs: NavPrefs, id: NavItemId, visible: boolean): NavPrefs {
  if (visible) {
    if (prefs.order.includes(id)) return prefs
    if (id === 'video' || id === 'music' || id === 'explore') {
      return toggleOptionalNav(prefs, id)
    }
    return { ...prefs, order: [...prefs.order, id] }
  }
  const order = prefs.order.filter((x) => x !== id)
  if (order.length < 2) return prefs
  return { ...prefs, order }
}
