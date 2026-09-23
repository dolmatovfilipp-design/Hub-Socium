import { useEffect } from 'react'

export type FeedsDrawerItemId = 'feed' | 'market' | 'communities' | 'video' | 'nearby'

const FEED_ITEMS: { id: FeedsDrawerItemId; label: string }[] = [
  { id: 'feed', label: 'Лента' },
  { id: 'market', label: 'Маркет' },
  { id: 'communities', label: 'Сообщества' },
  { id: 'video', label: 'Видео' },
  { id: 'nearby', label: 'Рядом' },
]

interface FeedsDrawerProps {
  open: boolean
  interactive?: boolean
  activeId?: FeedsDrawerItemId | null
  onClose: () => void
  onSelect: (id: FeedsDrawerItemId) => void
}

/**
 * Threads-style left menu: short liquid-glass list only (no pill grid).
 */
export function FeedsDrawer({
  open,
  interactive = false,
  activeId,
  onClose,
  onSelect,
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

        <nav className="feeds-list-card" aria-label="Разделы">
          {FEED_ITEMS.map((item, index) => {
            const active = activeId === item.id
            return (
              <button
                key={item.id}
                type="button"
                tabIndex={interactive ? 0 : -1}
                className={`feeds-list-row pressable ${active ? 'feeds-list-row-active' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                {index > 0 && <span className="feeds-list-divider" aria-hidden />}
                <span className="feeds-list-label">{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
