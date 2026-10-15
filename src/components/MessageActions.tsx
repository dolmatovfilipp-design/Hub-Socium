import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import {
  IconArchive,
  IconCheck,
  IconClose,
  IconCopy,
  IconEye,
  IconForward,
  IconHeart,
  IconPencil,
  IconPin,
  IconReply,
  IconSearch,
  IconTrash,
} from './Icons'
import {
  apiForwardMessageToMany,
  apiGetSavedMessages,
  apiListConversations,
  type ApiConversation,
  type ApiForwardedFrom,
  type ApiMessage,
  type ApiReplyQuote,
} from '../lib/api'

function overlayRoot(): HTMLElement {
  return document.getElementById('hub-overlay-root') || document.body
}

export function quotePreview(q: { body?: string; msg_type?: string; media_url?: string }): string {
  const t = (q.msg_type || 'text').toLowerCase()
  if (t === 'voice') return 'Голосовое сообщение'
  if (t === 'video_note') return 'Видеосообщение'
  if (t === 'image') return 'Фото'
  if (t === 'video') return 'Видео'
  if (t === 'file') return q.body?.trim() || 'Файл'
  if (t === 'sticker') return 'Стикер'
  if (t === 'gif') return 'GIF'
  if (t === 'location') return 'Местоположение'
  if (t === 'contact') return 'Контакт'
  const body = (q.body || '').trim()
  return body || 'Сообщение'
}

export function copyableText(m: { body?: string; msg_type?: string }): string {
  const t = (m.msg_type || 'text').toLowerCase()
  if (t !== 'text') return ''
  return (m.body || '').trim()
}

export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* fall through to the selection fallback */
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

export function senderLabel(m: ApiMessage): string {
  return m.sender?.display_name || m.sender_name || m.sender?.username || m.sender_username || ''
}

export function QuoteBlock({
  quote,
  onJump,
}: {
  quote: ApiReplyQuote
  onJump?: (id: string) => void
}) {
  return (
    <button
      type="button"
      className="msg-quote"
      data-testid="reply-quote"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (quote.id) onJump?.(quote.id)
      }}
    >
      <span className="msg-quote-name">{quote.sender_name || 'Сообщение'}</span>
      <span className="msg-quote-body">{quotePreview(quote)}</span>
    </button>
  )
}

export function ForwardedLine({ from }: { from?: ApiForwardedFrom | null }) {
  const name = from?.name || from?.username
  if (!name) return null
  return <p className="msg-forwarded">Переслано от {name}</p>
}

export function ComposerQuote({
  kind,
  title,
  preview,
  onClear,
}: {
  kind: 'reply' | 'edit'
  title: string
  preview: string
  onClear: () => void
}) {
  return (
    <div className="msg-composer-quote" data-testid={kind === 'reply' ? 'composer-quote' : 'composer-edit'}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[#6eb6ff]">
          {kind === 'reply' ? 'В ответ' : 'Редактирование'}
          {kind === 'reply' && title ? ` · ${title}` : ''}
        </span>
        <span className="block truncate text-[13px] text-[#d8d8de]">{preview}</span>
      </span>
      <button type="button" className="pressable shrink-0 text-white" aria-label="Отменить" onClick={onClear}>
        <IconClose size={18} strokeWidth={1.7} />
      </button>
    </div>
  )
}

const HOLD_MS = 400
const MOVE_PX = 12

export function HoldBubble({
  className,
  msgId,
  voiceMsg,
  voiceMine,
  onLongPress,
  children,
}: {
  className: string
  msgId: string
  voiceMsg?: string
  voiceMine?: boolean
  onLongPress?: (el: HTMLElement) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const opened = useRef(false)
  const suppressClick = useRef(false)

  const clear = () => {
    window.clearTimeout(timer.current)
    start.current = null
    ref.current?.classList.remove('is-holding')
  }

  const fire = () => {
    if (opened.current || !ref.current || !onLongPress) return
    opened.current = true
    suppressClick.current = true
    ref.current.classList.remove('is-holding')
    try {
      navigator.vibrate?.(12)
    } catch {
      /* iOS Safari has no vibrate; the scale is the cue */
    }
    onLongPress(ref.current)
  }

  return (
    <div
      ref={ref}
      data-testid="msg-bubble"
      data-msg-id={msgId}
      data-voice-msg={voiceMsg}
      data-voice-mine={voiceMine ? '1' : '0'}
      className={className}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        opened.current = false
        start.current = { x: e.clientX, y: e.clientY }
        ref.current?.classList.add('is-holding')
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(fire, HOLD_MS)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const dx = e.clientX - start.current.x
        const dy = e.clientY - start.current.y
        if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) clear()
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => {
        e.preventDefault()
        fire()
      }}
      onDragStart={(e) => e.preventDefault()}
      onClickCapture={(e) => {
        if (!suppressClick.current) return
        e.preventDefault()
        e.stopPropagation()
        suppressClick.current = false
      }}
    >
      {children}
    </div>
  )
}

type MenuExtra = {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
}

function MenuRow({
  label,
  icon,
  testId,
  danger,
  onClick,
}: {
  label: string
  icon: ReactNode
  testId: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      className="msg-hold-row"
      style={danger ? { color: '#ff453a' } : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="shrink-0" style={danger ? { color: '#ff453a' } : undefined}>
        {icon}
      </span>
    </button>
  )
}

export function MessageHoldMenu({
  anchor,
  mine,
  canEdit,
  canCopy,
  extras,
  onClose,
  onReply,
  onForward,
  onEdit,
  onCopy,
  onDelete,
}: {
  anchor: HTMLElement
  mine: boolean
  canEdit: boolean
  canCopy: boolean
  extras?: MenuExtra[]
  onClose: () => void
  onReply: () => void
  onForward: () => void
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const liftRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const src = (anchor.querySelector('.msg-bubble') as HTMLElement | null) || anchor
    const root = overlayRoot()
    const rootRect = root.getBoundingClientRect()
    const rect = src.getBoundingClientRect()
    setBox({
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      width: rect.width,
      height: rect.height,
    })
    src.classList.add('msg-hold-hidden')
    return () => {
      src.classList.remove('msg-hold-hidden')
    }
  }, [anchor])

  useLayoutEffect(() => {
    const slot = liftRef.current
    if (!slot || !box) return
    const src = (anchor.querySelector('.msg-bubble') as HTMLElement | null) || anchor
    const clone = src.cloneNode(true) as HTMLElement
    clone.classList.remove('msg-hold-hidden', 'is-holding')
    clone.style.width = '100%'
    clone.style.maxWidth = 'none'
    clone.style.margin = '0'
    slot.replaceChildren(clone)
  }, [anchor, box])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu || !box) return
    const root = overlayRoot()
    const mh = menu.offsetHeight
    const mw = menu.offsetWidth
    const rootH = root.clientHeight
    const rootW = root.clientWidth
    const gap = 10
    const spaceBelow = rootH - (box.top + box.height + gap)
    const spaceAbove = box.top - gap
    let top = box.top + box.height + gap
    if (spaceBelow < mh && spaceAbove > spaceBelow) top = box.top - gap - mh
    top = Math.max(8, Math.min(top, rootH - mh - 8))
    let left = mine ? box.left + box.width - mw : box.left
    left = Math.max(8, Math.min(left, rootW - mw - 8))
    setMenuPos({ top, left })
  }, [box, mine, canEdit, canCopy, extras?.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const icon = (node: ReactNode) => node

  return createPortal(
    <div className="msg-hold-layer absolute inset-0 z-[90]" data-testid="msg-hold-menu">
      <button type="button" className="msg-hold-backdrop" aria-label="Закрыть" onClick={onClose} />
      {box ? (
        <div
          ref={liftRef}
          className="msg-hold-lift"
          style={{ top: box.top, left: box.left, width: box.width }}
        />
      ) : null}
      <div
        ref={menuRef}
        role="menu"
        className="msg-hold-menu"
        style={{
          top: menuPos?.top ?? -9999,
          left: menuPos?.left ?? 8,
          visibility: menuPos ? 'visible' : 'hidden',
        }}
      >
        <MenuRow label="Ответить" testId="msg-action-reply" icon={icon(<IconReply size={22} strokeWidth={1.6} />)} onClick={onReply} />
        <MenuRow label="Переслать" testId="msg-action-forward" icon={icon(<IconForward size={22} strokeWidth={1.6} />)} onClick={onForward} />
        {canEdit ? (
          <MenuRow label="Редактировать" testId="msg-action-edit" icon={icon(<IconPencil size={22} strokeWidth={1.6} />)} onClick={onEdit} />
        ) : null}
        {canCopy ? (
          <MenuRow label="Копировать" testId="msg-action-copy" icon={icon(<IconCopy size={22} strokeWidth={1.6} />)} onClick={onCopy} />
        ) : null}
        {extras?.map((row) => (
          <MenuRow key={row.id} label={row.label} testId={`msg-action-${row.id}`} icon={row.icon} onClick={row.onClick} />
        ))}
        <MenuRow label="Удалить" testId="msg-action-delete" danger icon={icon(<IconTrash size={22} strokeWidth={1.6} />)} onClick={onDelete} />
      </div>
    </div>,
    overlayRoot(),
  )
}

export function messageMenuExtras(actions: {
  onReact?: () => void
  onPin?: () => void
  onReaders?: () => void
  onArchive?: () => void
  onTranslate?: () => void
}): MenuExtra[] {
  const rows: MenuExtra[] = []
  if (actions.onReact) {
    rows.push({ id: 'react', label: 'Реакция', icon: <IconHeart size={22} strokeWidth={1.6} />, onClick: actions.onReact })
  }
  if (actions.onPin) {
    rows.push({ id: 'pin', label: 'Закрепить', icon: <IconPin size={22} strokeWidth={1.6} />, onClick: actions.onPin })
  }
  if (actions.onReaders) {
    rows.push({ id: 'readers', label: 'Кто прочитал', icon: <IconEye size={22} strokeWidth={1.6} />, onClick: actions.onReaders })
  }
  if (actions.onArchive) {
    rows.push({ id: 'archive', label: 'В архив', icon: <IconArchive size={22} strokeWidth={1.6} />, onClick: actions.onArchive })
  }
  if (actions.onTranslate) {
    rows.push({ id: 'translate', label: 'Перевести', icon: <IconReply size={22} strokeWidth={1.6} />, onClick: actions.onTranslate })
  }
  return rows
}

function chatTitle(c: ApiConversation): string {
  if (c.is_group) return c.title || c.peer?.display_name || 'Группа'
  if ((c as ApiConversation & { is_saved?: boolean }).is_saved) return 'Избранное'
  return c.peer?.display_name || c.peer?.username || 'Чат'
}

export function ForwardPicker({
  onClose,
  onSend,
  sending,
}: {
  onClose: () => void
  onSend: (ids: string[]) => void
  sending?: boolean
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<ApiConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([
      apiListConversations().catch(() => ({ items: [] as ApiConversation[] })),
      apiGetSavedMessages().catch(() => null),
    ]).then(([list, saved]) => {
      if (cancelled) return
      const rows = list.items ?? []
      if (saved?.id && !rows.some((c) => c.id === saved.id)) {
        rows.unshift({ ...saved, is_saved: true } as ApiConversation)
      }
      setItems(rows)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const needle = q.trim().toLowerCase()
  const shown = needle
    ? items.filter((c) => {
        const blob = `${chatTitle(c)} ${c.peer?.username || ''} ${c.title || ''}`.toLowerCase()
        return blob.includes(needle)
      })
    : items

  const toggle = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return createPortal(
    <div className="msg-hold-layer absolute inset-0 z-[90] flex items-end" data-testid="forward-picker">
      <button type="button" className="msg-hold-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div
        className="relative flex max-h-[86%] w-full flex-col rounded-t-3xl bg-[#1c1c1e] pb-[max(12px,var(--hub-safe-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/25" />
        <p className="px-4 pb-2 pt-3 text-center text-[16px] font-semibold text-white">Переслать</p>
        <div className="px-3 pb-2">
          <div className="hub-search-pill">
            <IconSearch size={16} className="shrink-0 text-[#aeaeb2]" />
            <input
              data-testid="forward-search"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2">
          {loading ? <p className="py-8 text-center text-[14px] text-[#d1d1d6]">Загрузка…</p> : null}
          {!loading && !shown.length ? <p className="py-8 text-center text-[14px] text-[#d1d1d6]">Ничего не найдено</p> : null}
          {shown.map((c) => {
            const on = picked.includes(c.id)
            const title = chatTitle(c)
            return (
              <button
                key={c.id}
                type="button"
                data-testid="forward-row"
                aria-pressed={on}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-white/[0.06]"
                onClick={() => toggle(c.id)}
              >
                <Avatar
                  id={c.peer?.id || c.id}
                  name={title}
                  src={c.is_group ? c.avatar_url || c.peer?.avatar_url : c.peer?.avatar_url}
                  size={44}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] text-white">{title}</span>
                  {c.is_group ? (
                    <span className="block text-[13px] text-[#aeaeb2]">Группа</span>
                  ) : c.peer?.username && c.peer.username !== 'group' ? (
                    <span className="block truncate text-[13px] text-[#aeaeb2]">@{c.peer.username}</span>
                  ) : null}
                </span>
                <span className="msg-picker-check" aria-hidden>
                  {on ? <IconCheck size={20} strokeWidth={1.8} /> : (
                    <span className="block h-[18px] w-[18px] rounded-[5px] border border-white/35" />
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <div className="px-3 pt-2">
          <button
            type="button"
            data-testid="forward-send"
            disabled={!picked.length || sending}
            className="w-full rounded-2xl bg-white py-3 text-[16px] font-semibold text-black disabled:opacity-40"
            onClick={() => onSend(picked)}
          >
            {picked.length ? `Переслать · ${picked.length}` : 'Переслать'}
          </button>
        </div>
      </div>
    </div>,
    overlayRoot(),
  )
}

export function DeleteMessageSheet({
  mine,
  onClose,
  onDeleteForMe,
  onDeleteForEveryone,
}: {
  mine: boolean
  onClose: () => void
  onDeleteForMe: () => void
  onDeleteForEveryone: () => void
}) {
  return createPortal(
    <div className="msg-hold-layer absolute inset-0 z-[90] flex items-end" data-testid="delete-sheet">
      <button type="button" className="msg-hold-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="relative w-full rounded-t-3xl bg-[#1c1c1e] px-3 pb-[max(16px,var(--hub-safe-bottom))] pt-2">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
        <p className="mb-3 text-center text-[16px] font-semibold text-white">Удалить сообщение</p>
        <div className="overflow-hidden rounded-2xl bg-black/30">
          <button
            type="button"
            data-testid="delete-for-me"
            className="msg-hold-row"
            onClick={onDeleteForMe}
          >
            <span>Удалить у себя</span>
            <IconTrash size={22} strokeWidth={1.6} />
          </button>
          {mine ? (
            <button
              type="button"
              data-testid="delete-for-everyone"
              className="msg-hold-row"
              style={{ color: '#ff453a' }}
              onClick={onDeleteForEveryone}
            >
              <span>Удалить у всех</span>
              <IconTrash size={22} strokeWidth={1.6} />
            </button>
          ) : null}
        </div>
        <button type="button" className="mt-2 w-full py-3 text-center text-[16px] text-[#d1d1d6]" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>,
    overlayRoot(),
  )
}

export { apiForwardMessageToMany }
