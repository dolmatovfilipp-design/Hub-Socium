import { applyAppTheme } from '../lib/theme'
import { readStore } from './storage'
import { accentById, fontById, type AppearancePrefs } from './types'
import './appearance.css'

export function applyPrefs(prefs: AppearancePrefs) {
  applyAppTheme(prefs.appearance)
  const accent = accentById(prefs.accent)
  const font = fontById(prefs.fontScale)
  const root = document.documentElement
  root.dataset.accent = accent.id
  root.dataset.fontScale = font.id
  root.style.setProperty('--hub-accent-fill', accent.fill)
  root.style.setProperty('--hub-accent-ink', accent.ink)
  root.style.setProperty('--hub-msg-size', `${font.px}px`)
}

export function applyCachedPrefs() {
  if (typeof document === 'undefined') return
  applyPrefs(readStore().prefs)
}

applyCachedPrefs()
