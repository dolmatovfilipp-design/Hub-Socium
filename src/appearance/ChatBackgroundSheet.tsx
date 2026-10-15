import { createPortal } from 'react-dom'
import { ChatPreview } from './ChatPreview'
import { readAppearance, useChatBackground } from './chatBackground'
import { ChatBackgroundSlot, useChatBackgroundPickerReady } from './pickerSlot'
import { accentById, fontById } from './types'

export function ChatBackgroundSheet({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) {
  const wall = useChatBackground(conversationId)
  const ready = useChatBackgroundPickerReady()
  const prefs = readAppearance()
  const accent = accentById(prefs.accent)
  const font = fontById(prefs.fontScale)
  const root = (typeof document !== 'undefined' && document.getElementById('hub-overlay-root')) || document.body
  return createPortal(
    <div className="pointer-events-auto absolute inset-0 z-[var(--hub-z-sheet)] flex items-end justify-center">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Закрыть" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Фон чата"
        className="relative max-h-[85%] w-full overflow-y-auto rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <p className="mb-3 text-center text-[15px] font-semibold text-white">Фон чата</p>
        <ChatPreview
          image={wall.image}
          background={wall.background}
          accentFill={accent.fill}
          accentInk={accent.ink}
          fontPx={font.px}
        />
        <div className="mt-4">
          {ready ? (
            <ChatBackgroundSlot conversationId={conversationId} onClose={onClose} />
          ) : (
            <p className="px-1 py-4 text-center text-[14px] leading-snug text-[#8e8e93]">
              Свой фон для этого чата. Каталог появится здесь.
            </p>
          )}
        </div>
        <button type="button" className="mt-1 w-full py-2 text-center text-[15px] text-[#8e8e93]" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>,
    root,
  )
}
