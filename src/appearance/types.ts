export type AppearanceMode = 'dark' | 'light' | 'system'
export type AccentId = 'graphite' | 'blue' | 'violet' | 'pink' | 'orange' | 'green'
export type FontScale = 'sm' | 'md' | 'lg'
export type BackgroundKind = 'none' | 'wallpaper' | 'custom'

/** Stored chat wallpaper. Wallpaper ids come from the manifest, not a fixed enum. */
export type ChatBackground = {
  kind: BackgroundKind
  id?: string
  url?: string
  blur: number
  dim: number
}

export type AppearancePrefs = {
  themeId: string
  appearance: AppearanceMode
  accent: AccentId
  fontScale: FontScale
  background: ChatBackground
}

export type WallpaperEntry = {
  id: string
  name: string
  file: string
  src: string
}

/** Props for the «Фон чата» picker. The picker UI itself lives outside this module. */
export type ChatBackgroundPickerProps = {
  /** Set to edit one conversation. Omit to edit the account-wide background. */
  conversationId?: string
  onClose?: () => void
}

export type AppearancePatch = {
  appearance?: AppearanceMode
  accent?: AccentId
  fontScale?: FontScale
  background?: ChatBackground
}

export const BLUR_MAX = 24
export const DIM_MAX = 75

export const ACCENTS: readonly { id: AccentId; label: string; fill: string; ink: string }[] = [
  { id: 'graphite', label: 'Графит', fill: '#1c1c1e', ink: '#ffffff' },
  { id: 'blue', label: 'Синий', fill: '#0b5ed7', ink: '#ffffff' },
  { id: 'violet', label: 'Фиолетовый', fill: '#5e5ce6', ink: '#ffffff' },
  { id: 'pink', label: 'Розовый', fill: '#e11d48', ink: '#ffffff' },
  { id: 'orange', label: 'Оранжевый', fill: '#ff9f0a', ink: '#1a1000' },
  { id: 'green', label: 'Зелёный', fill: '#1e7a34', ink: '#ffffff' },
]

export const FONT_SCALES: readonly { id: FontScale; label: string; px: number }[] = [
  { id: 'sm', label: 'Мелкий', px: 13 },
  { id: 'md', label: 'Обычный', px: 15 },
  { id: 'lg', label: 'Крупный', px: 18 },
]

export function noneBackground(): ChatBackground {
  return { kind: 'none', blur: 0, dim: 0 }
}

export function defaultPrefs(): AppearancePrefs {
  return {
    themeId: 'default',
    appearance: 'dark',
    accent: 'graphite',
    fontScale: 'md',
    background: noneBackground(),
  }
}

export function accentById(id: string) {
  return ACCENTS.find((item) => item.id === id) ?? ACCENTS[0]
}

export function fontById(id: string) {
  return FONT_SCALES.find((item) => item.id === id) ?? FONT_SCALES[1]
}
