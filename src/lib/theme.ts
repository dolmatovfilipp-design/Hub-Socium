export function applyAppTheme(appearance: string) {
  let theme = appearance
  if (appearance === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  if (theme !== 'light' && theme !== 'dark') theme = 'dark'
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('hub-theme', theme)
    localStorage.setItem('hub-theme-pref', appearance)
  } catch {
    /* ignore */
  }
}
