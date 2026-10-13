/** Bottom nav preferences — localStorage MVP */

export type NavItemId =
  | 'home'
  | 'messages'
  | 'activity'
  | 'profile'
  | 'search'
  | 'video'
  | 'music'

export type NavThemeId =
  | 'graphite'
  | 'black'
  | 'white'
  | 'neon'
  | 'beige'
  | 'cream'
  | 'sand'
  | 'peach'
  | 'honey'
  | 'terracotta'
  | 'rose'
  | 'latte'
  | 'amber'
  | 'warm-gray'
  | 'ivory'

export type NavPrefs = {
  enableSearch: boolean
  enableVideo: boolean
  enableMusic: boolean
  /** Scale multiplier for pill height / icons (0.85–1.2) */
  scale: number
  theme: NavThemeId
  /** Whether the floating nav is reduced to the Home icon. */
  collapsed: boolean
  /** Whether the nav frame and active item indicator are shown. */
  showFrameAndIndicator: boolean
}

export const NAV_STORAGE_KEY = 'hub-nav-prefs-v1'

export const NAV_CATALOG: Record<
  NavItemId,
  { label: string; to: string; end?: boolean }
> = {
  home: { label: 'Главная', to: '/app', end: true },
  messages: { label: 'Сообщения', to: '/app/messages' },
  activity: { label: 'Действия', to: '/app/activity' },
  profile: { label: 'Профиль', to: '/app/profile' },
  search: { label: 'Поиск', to: '/app/explore' },
  video: { label: 'Видео', to: '/app/clips' },
  music: { label: 'Музыка', to: '/app/music' },
}

/** Items currently exposed in the bottom navigation, in their visual order. */
export function getVisibleNavItemIds(prefs: NavPrefs): NavItemId[] {
  if (prefs.collapsed) return ['home']
  return [
    'home',
    'messages',
    ...(prefs.enableSearch ? ['search' as const] : []),
    ...(prefs.enableVideo ? ['video' as const] : []),
    ...(prefs.enableMusic ? ['music' as const] : []),
    'activity',
    'profile',
  ]
}

/** Default: Главная · Сообщения · Действия · Профиль (no +) */
export const DEFAULT_NAV_PREFS: NavPrefs = {
  enableSearch: false,
  enableVideo: false,
  enableMusic: false,
  scale: 1,
  theme: 'graphite',
  collapsed: false,
  showFrameAndIndicator: true,
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
  cream: { label: 'Кремовый', preview: 'linear-gradient(135deg,#fff7e6,#ead7b7)' },
  sand: { label: 'Песочный', preview: 'linear-gradient(135deg,#e7d3b5,#b8956a)' },
  peach: { label: 'Персиковый', preview: 'linear-gradient(135deg,#ffd1b8,#e9967a)' },
  honey: { label: 'Медовый', preview: 'linear-gradient(135deg,#ffe08a,#d59b2b)' },
  terracotta: { label: 'Терракотовый', preview: 'linear-gradient(135deg,#d98268,#8f4536)' },
  rose: { label: 'Розовый', preview: 'linear-gradient(135deg,#f2b6c6,#b96782)' },
  latte: { label: 'Латте', preview: 'linear-gradient(135deg,#d8b08c,#8c6748)' },
  amber: { label: 'Янтарный', preview: 'linear-gradient(135deg,#f6c453,#b56b12)' },
  'warm-gray': { label: 'Тёплый серый', preview: 'linear-gradient(135deg,#d9d1ca,#8f8781)' },
  ivory: { label: 'Слоновая кость', preview: 'linear-gradient(135deg,#fffff0,#d8d2b4)' },
}

function legacyEnabled(raw: Partial<NavPrefs> & { order?: unknown[] }, id: NavItemId): boolean {
  if (!Array.isArray(raw.order)) return false
  return raw.order.includes(id) || (id === 'search' && raw.order.includes('explore'))
}

function sanitize(raw: Partial<NavPrefs> & { order?: unknown[] } | null | undefined): NavPrefs {
  const source = raw ?? {}
  let scale = typeof source.scale === 'number' ? source.scale : 1
  if (!Number.isFinite(scale)) scale = 1
  scale = Math.min(1.2, Math.max(0.85, scale))
  const theme = (source.theme && source.theme in NAV_THEME_META ? source.theme : 'graphite') as NavThemeId

  return {
    enableSearch: typeof source.enableSearch === 'boolean' ? source.enableSearch : legacyEnabled(source, 'search'),
    enableVideo: typeof source.enableVideo === 'boolean' ? source.enableVideo : legacyEnabled(source, 'video'),
    enableMusic: typeof source.enableMusic === 'boolean' ? source.enableMusic : legacyEnabled(source, 'music'),
    scale,
    theme,
    collapsed: typeof source.collapsed === 'boolean' ? source.collapsed : false,
    showFrameAndIndicator:
      typeof source.showFrameAndIndicator === 'boolean' ? source.showFrameAndIndicator : true,
  }
}

export function loadNavPrefs(): NavPrefs {
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_NAV_PREFS }
    return sanitize(JSON.parse(raw) as Partial<NavPrefs> & { order?: unknown[] })
  } catch {
    return { ...DEFAULT_NAV_PREFS }
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
