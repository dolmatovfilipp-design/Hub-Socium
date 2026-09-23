import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export type FeedsDrawerItemId =
  | 'feed'
  | 'market'
  | 'communities'
  | 'video'
  | 'news'
  | 'travel'
  | 'hobby'
  | 'library'
  | 'entertainment'
  | 'music'
  | 'ads'

const FEED_ITEMS: { id: FeedsDrawerItemId; label: string; betaHidden?: boolean }[] = [
  { id: 'feed', label: 'Лента' },
  { id: 'market', label: 'Маркет' },
  { id: 'communities', label: 'Сообщества' },
  { id: 'video', label: 'Видео' },
  { id: 'news', label: 'Новости' },
  { id: 'travel', label: 'Путешествия' },
  { id: 'hobby', label: 'Хобби' },
  { id: 'library', label: 'Библиотека' },
  { id: 'entertainment', label: 'Развлечения' },
  // Music / Ads: hidden in private beta (no product wiring)
  { id: 'music', label: 'Музыка', betaHidden: true },
  { id: 'ads', label: 'Реклама', betaHidden: true },
]

interface FeedsDrawerProps {
  /** Visible under stage when progress > ~0.01 */
  open: boolean
  /** Pointer-events / tab focus when progress > ~0.5 or settled open */
  interactive?: boolean
  activeId?: FeedsDrawerItemId | null
  onClose: () => void
  onSelect: (id: FeedsDrawerItemId) => void
}

/**
 * Threads-style left «Меню» panel: fixed underneath the sliding stage (no parallax).
 * Gesture open/close is owned by Feed; this panel only shows/accepts input.
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
          <div className="mt-3 flex flex-col gap-2 px-1">
            <Link
              to="/app/explore"
              onClick={onClose}
              className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-[15px] font-semibold text-white"
            >
              Интересное
            </Link>
            <Link
              to="/app/drafts"
              onClick={onClose}
              className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-[15px] font-semibold text-white"
            >
              Черновики
            </Link>
            <Link
              to="/app/voice"
              onClick={onClose}
              className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-[15px] font-semibold text-white"
            >
              Голосовые комнаты
            </Link>
            <Link
              to="/app/meetups"
              onClick={onClose}
              className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-[15px] font-semibold text-white"
            >
              Встречи
            </Link>
            <Link
              to="/app/nearby"
              onClick={onClose}
              className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-[15px] font-semibold text-white"
            >
              Рядом
            </Link>
          </div>
        </header>

        <nav className="feeds-list-card" aria-label="Разделы">
          {FEED_ITEMS.map((item, index) => {
            const active = activeId === item.id
            return (
              <button
                key={item.id}
                type="button"
                tabIndex={interactive ? 0 : -1}
                className={`feeds-list-row pressable ${
                  active ? 'feeds-list-row-active' : ''
                }`}
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
