import { useEffect } from 'react'
import { IconSettings } from './Icons'

interface FeedsDrawerProps {
  open: boolean
  interactive?: boolean
  onClose: () => void
  onOpenSettings: () => void
}

/**
 * Threads-style left menu: settings entry only (sections live in Settings «Разделы»).
 */
export function FeedsDrawer({
  open,
  interactive = false,
  onClose,
  onOpenSettings,
}: FeedsDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <aside
      className={`feeds-panel absolute inset-y-0 left-0 z-0 flex flex-col ${
        open ? 'feeds-panel-visible' : ''
      } ${interactive ? 'feeds-panel-interactive' : ''}`}
      aria-hidden={!open}
      aria-label="Меню"
    >
      <div className="feeds-panel-inner flex min-h-0 flex-1 flex-col items-stretch">
        <header className="feeds-panel-header shrink-0">
          <h1 className="feeds-panel-title">Меню</h1>
        </header>

        <nav className="feeds-list-card" aria-label="Меню">
          <button
            type="button"
            tabIndex={interactive ? 0 : -1}
            className="feeds-list-row pressable"
            onClick={onOpenSettings}
          >
            <span className="feeds-list-label flex items-center gap-3">
              <IconSettings size={20} className="shrink-0 text-white" />
              Настройки
            </span>
          </button>
        </nav>
      </div>
    </aside>
  )
}
