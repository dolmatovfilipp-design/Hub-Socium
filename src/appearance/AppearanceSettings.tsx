import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ChatPreview } from './ChatPreview'
import { APPEARANCE_ERROR_EVENT, APPEARANCE_EVENT, readAppearance, updateAppearance, useChatBackground } from './chatBackground'
import { isApiMode } from '../lib/api'
import { ChatBackgroundSlot } from './pickerSlot'
import { ACCENTS, FONT_SCALES, accentById, fontById, type AccentId, type AppearanceMode, type FontScale } from './types'

const THEMES: { id: AppearanceMode; label: string; icon: typeof Moon }[] = [
  { id: 'dark', label: 'Тёмная', icon: Moon },
  { id: 'light', label: 'Светлая', icon: Sun },
  { id: 'system', label: 'Система', icon: Monitor },
]

export function AppearanceSettings({ showToast }: { showToast: (message: string) => void }) {
  const [prefs, setPrefs] = useState(readAppearance)
  const wall = useChatBackground()
  const accent = accentById(prefs.accent)
  const font = fontById(prefs.fontScale)

  useEffect(() => {
    const sync = () => setPrefs(readAppearance())
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      showToast(detail || 'Не удалось сохранить')
    }
    window.addEventListener(APPEARANCE_EVENT, sync)
    window.addEventListener(APPEARANCE_ERROR_EVENT, onError)
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync)
      window.removeEventListener(APPEARANCE_ERROR_EVENT, onError)
    }
  }, [showToast])

  const saved = () => showToast(isApiMode() ? 'Сохранено' : 'Сохранено на устройстве')

  return (
    <div className="appearance-page pb-8 pt-2">
      <ChatPreview
        image={wall.image}
        background={wall.background}
        accentFill={accent.fill}
        accentInk={accent.ink}
        fontPx={font.px}
      />

      <section className="appearance-block" aria-labelledby="appearance-theme-title">
        <h2 id="appearance-theme-title">Тема</h2>
        <div className="appearance-theme" role="radiogroup" aria-label="Тема приложения">
          {THEMES.map((theme) => {
            const Icon = theme.icon
            const pressed = prefs.appearance === theme.id
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={pressed}
                aria-pressed={pressed}
                onClick={() => {
                  if (pressed) return
                  updateAppearance({ appearance: theme.id })
                  saved()
                }}
              >
                <Icon size={16} strokeWidth={1.6} aria-hidden />
                {theme.label}
              </button>
            )
          })}
        </div>
      </section>

      <section className="appearance-block" aria-labelledby="appearance-accent-title">
        <h2 id="appearance-accent-title">Акцент</h2>
        <div className="appearance-swatches" role="radiogroup" aria-label="Цвет своих сообщений">
          {ACCENTS.map((item) => {
            const pressed = prefs.accent === item.id
            return (
              <button
                key={item.id}
                type="button"
                className="appearance-swatch"
                role="radio"
                aria-checked={pressed}
                aria-pressed={pressed}
                aria-label={item.label}
                style={{ background: item.fill }}
                onClick={() => {
                  if (pressed) return
                  updateAppearance({ accent: item.id as AccentId })
                  saved()
                }}
              />
            )
          })}
        </div>
        <p className="appearance-font-label mt-3" aria-live="polite">
          {accent.label}. Так выглядят ваши сообщения.
        </p>
      </section>

      <section className="appearance-block" aria-labelledby="appearance-font-title">
        <h2 id="appearance-font-title">Размер текста</h2>
        <p className="appearance-font-label" id="appearance-font-value">
          {font.label}
        </p>
        <input
          className="appearance-range"
          type="range"
          min={0}
          max={2}
          step={1}
          aria-labelledby="appearance-font-title appearance-font-value"
          value={FONT_SCALES.findIndex((item) => item.id === prefs.fontScale)}
          onChange={(event) => {
            const next = FONT_SCALES[Number(event.target.value)]
            if (!next || next.id === prefs.fontScale) return
            updateAppearance({ fontScale: next.id as FontScale })
          }}
        />
        <div className="appearance-font-stops" aria-hidden="true">
          {FONT_SCALES.map((item) => (
            <span key={item.id}>{item.label}</span>
          ))}
        </div>
      </section>

      <div data-appearance-slot="chat-background">
        <ChatBackgroundSlot />
      </div>
    </div>
  )
}
