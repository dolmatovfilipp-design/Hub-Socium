import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/useStore'
import { ShareSheet } from './ShareSheet'
import { apiQuoteRepost, apiMuteUser, isApiMode } from '../lib/api'
import {
  IconLink,
  IconBookmark,
  IconEye,
  IconEyeOff,
  IconHideUser,
  IconRestrict,
  IconBlock,
  IconReport,
  IconTrash,
} from './Icons'

interface Props {
  postId: string
  authorId: string
  authorUsername: string
  open: boolean
  onClose: () => void
}

type Row = {
  id: string
  label: string
  danger?: boolean
  icon: ReactNode
  action: () => void
}

type OverlayMode = null | 'delete' | 'block' | 'report'

const REPORT_REASONS = [
  { id: 'spam', label: 'Спам' },
  { id: 'abuse', label: 'Оскорбления' },
  { id: 'illegal', label: 'Запрещённый контент' },
  { id: 'other', label: 'Другое' },
] as const

export function PostMoreSheet({
  postId,
  authorId,
  authorUsername,
  open,
  onClose,
}: Props) {
  const showToast = useStore((s) => s.showToast)
  const toggleSave = useStore((s) => s.toggleSave)
  const saved = useStore((s) => s.savedPostIds.includes(postId))
  const currentUserId = useStore((s) => s.currentUserId)
  const markInterested = useStore((s) => s.markInterested)
  const hidePost = useStore((s) => s.hidePost)
  const hideAuthor = useStore((s) => s.hideAuthor)
  const restrictAuthor = useStore((s) => s.restrictAuthor)
  const blockAuthor = useStore((s) => s.blockAuthor)
  const reportPost = useStore((s) => s.reportPost)
  const deletePost = useStore((s) => s.deletePost)

  const isOwn = !!currentUserId && authorId === currentUserId
  const startY = useRef<number | null>(null)
  const [dragY, setDragY] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [overlay, setOverlay] = useState<OverlayMode>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setDragY(0)
      setOverlay(null)
      return
    }
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 220)
    return () => window.clearTimeout(t)
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (overlay) setOverlay(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, overlay])

  const host =
    typeof document !== 'undefined'
      ? document.getElementById('hub-overlay-root')
      : null

  if (!mounted || !host) return null

  const copyLink = async () => {
    const url = `${window.location.origin}/app/p/${encodeURIComponent(postId)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Hub', url })
      } else {
        await navigator.clipboard.writeText(url)
        showToast('Ссылка скопирована')
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url)
        showToast('Ссылка скопирована')
      } catch {
        showToast('Не удалось скопировать')
      }
    }
    onClose()
  }

  const openShareSheet = () => setShareOpen(true)

  const quoteRepost = () => {
    const q = window.prompt('Цитата к репосту (необязательно)')
    if (q == null) return
    if (!isApiMode()) {
      showToast('Цитата — в API-режиме')
      onClose()
      return
    }
    void apiQuoteRepost(postId, q.trim())
      .then(() => {
        showToast(q.trim() ? 'Цитата опубликована' : 'Репост сделан')
        onClose()
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
  }

  const muteAuthor = () => {
    if (!isApiMode()) {
      showToast('Беззвучный режим — в API')
      return
    }
    void apiMuteUser(authorId)
      .then(() => {
        showToast(`@${authorUsername} в беззвучном режиме`)
        onClose()
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
  }

  const ownBlocks: Row[][] = [
    [
      {
        id: 'copy',
        label: 'Копировать ссылку',
        icon: <IconLink size={22} strokeWidth={1.5} />,
        action: () => void copyLink(),
      },
      {
        id: 'share-qr',
        label: 'Поделиться / QR',
        icon: <IconLink size={22} strokeWidth={1.5} />,
        action: () => openShareSheet(),
      },
      {
        id: 'quote',
        label: 'Цитата / репост',
        icon: <IconLink size={22} strokeWidth={1.5} />,
        action: () => quoteRepost(),
      },
    ],
    [
      {
        id: 'save',
        label: saved ? 'Сохранено' : 'Сохранить',
        icon: <IconBookmark size={22} filled={saved} strokeWidth={1.5} />,
        action: () => {
          toggleSave(postId)
          showToast(saved ? 'Удалено из сохранённых' : 'Сохранено')
          onClose()
        },
      },
    ],
    [
      {
        id: 'delete',
        label: 'Удалить',
        danger: true,
        icon: <IconTrash size={22} strokeWidth={1.5} />,
        action: () => setOverlay('delete'),
      },
    ],
  ]

  const otherBlocks: Row[][] = [
    [
      {
        id: 'copy',
        label: 'Копировать ссылку',
        icon: <IconLink size={22} strokeWidth={1.5} />,
        action: () => void copyLink(),
      },
      {
        id: 'share-qr',
        label: 'Поделиться / QR',
        icon: <IconLink size={22} strokeWidth={1.5} />,
        action: () => openShareSheet(),
      },
      {
        id: 'quote',
        label: 'Цитата / репост',
        icon: <IconLink size={22} strokeWidth={1.5} />,
        action: () => quoteRepost(),
      },
    ],
    [
      {
        id: 'save',
        label: saved ? 'Сохранено' : 'Сохранить',
        icon: <IconBookmark size={22} filled={saved} strokeWidth={1.5} />,
        action: () => {
          toggleSave(postId)
          showToast(saved ? 'Удалено из сохранённых' : 'Сохранено')
          onClose()
        },
      },
      {
        id: 'interest',
        label: 'Интересует',
        icon: <IconEye size={22} strokeWidth={1.5} />,
        action: () => {
          markInterested(authorId)
          showToast('Будем показывать больше похожего')
          onClose()
        },
      },
      {
        id: 'not-interest',
        label: 'Не интересует',
        icon: <IconEyeOff size={22} strokeWidth={1.5} />,
        action: () => {
          hidePost(postId)
          showToast('Меньше похожих')
          onClose()
        },
      },
    ],
    [
      {
        id: 'mute',
        label: 'Беззвучный режим',
        icon: <IconHideUser size={22} strokeWidth={1.5} />,
        action: () => muteAuthor(),
      },
      {
        id: 'hide',
        label: 'Скрыть пользователя',
        icon: <IconHideUser size={22} strokeWidth={1.5} />,
        action: () => {
          hideAuthor(authorId)
          showToast(`Скрыт @${authorUsername}`)
          onClose()
        },
      },
      {
        id: 'restrict',
        label: 'Установить ограничения',
        icon: <IconRestrict size={22} strokeWidth={1.5} />,
        action: () => {
          restrictAuthor(authorId)
          showToast(`Ограничения для @${authorUsername}`)
          onClose()
        },
      },
      {
        id: 'block',
        label: 'Заблокировать',
        danger: true,
        icon: <IconBlock size={22} strokeWidth={1.5} />,
        action: () => setOverlay('block'),
      },
      {
        id: 'report',
        label: 'Пожаловаться',
        danger: true,
        icon: <IconReport size={22} strokeWidth={1.5} />,
        action: () => setOverlay('report'),
      },
    ],
  ]

  const blocks = isOwn ? ownBlocks : otherBlocks

  const onTouchStart = (e: TouchEvent) => {
    if (overlay) return
    startY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: TouchEvent) => {
    if (overlay || startY.current == null) return
    const dy = e.touches[0].clientY - startY.current
    if (dy > 0) setDragY(dy)
  }
  const onTouchEnd = () => {
    if (!overlay && dragY > 80) onClose()
    setDragY(0)
    startY.current = null
  }

  const confirmYes = () => {
    if (overlay === 'delete') {
      void (async () => {
        await deletePost(postId)
        showToast('Публикация удалена')
        setOverlay(null)
        onClose()
      })()
      return
    }
    if (overlay === 'block') {
      void (async () => {
        const res = await blockAuthor(authorId)
        if (!res.ok) {
          showToast(res.error ?? 'Не удалось заблокировать')
          return
        }
        showToast(`@${authorUsername} заблокирован`)
        setOverlay(null)
        onClose()
      })()
    }
  }

  const submitReport = (reason: string) => {
    void (async () => {
      const res = await reportPost(postId, reason)
      if (!res.ok) {
        showToast(res.error ?? 'Не удалось отправить жалобу')
        return
      }
      showToast('Жалоба отправлена')
      setOverlay(null)
      onClose()
    })()
  }

  return createPortal(
    <div
      className={`post-more-root pointer-events-auto absolute inset-0 z-[80] flex flex-col justify-end ${
        open ? 'post-more-open' : 'post-more-closing'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Действия с публикацией"
    >
      <button
        type="button"
        className="post-more-backdrop absolute inset-0"
        aria-label="Закрыть"
        onClick={() => {
          if (overlay) setOverlay(null)
          else onClose()
        }}
      />

      {overlay === 'report' ? (
        <div className="post-more-sheet relative z-[1] px-3 pb-[max(12px,var(--hub-safe-bottom))] pt-2">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
          <p className="mb-2 px-1 text-center text-[13px] text-[#8e8e93]">Причина жалобы</p>
          <div className="overflow-hidden rounded-[14px] bg-[#1c1c1e]">
            {REPORT_REASONS.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => submitReport(r.id)}
                className={`pressable flex w-full items-center justify-between gap-3 px-4 py-[14px] text-left text-[16px] text-white ${
                  i < REPORT_REASONS.length - 1 ? 'border-b border-white/[0.08]' : ''
                }`}
              >
                <span className="font-normal">{r.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pressable mt-2.5 flex w-full items-center justify-center rounded-[14px] bg-[#1c1c1e] px-4 py-[14px] text-[16px] font-semibold text-white"
            onClick={() => setOverlay(null)}
          >
            Отмена
          </button>
        </div>
      ) : overlay === 'delete' || overlay === 'block' ? (
        <div className="relative z-[1] flex flex-1 items-center justify-center px-6 pb-[max(12px,var(--hub-safe-bottom))]">
          <div className="w-full max-w-[300px] overflow-hidden rounded-[16px] bg-[#1c1c1e] shadow-2xl">
            <p className="border-b border-white/[0.08] px-5 py-5 text-center text-[17px] font-medium text-white">
              вы уверены?
            </p>
            <div className="flex">
              <button
                type="button"
                className="pressable flex-1 border-r border-white/[0.08] py-[14px] text-[16px] text-[#8e8e93]"
                onClick={() => {
                  setOverlay(null)
                  onClose()
                }}
              >
                Нет
              </button>
              <button
                type="button"
                className={`pressable flex-1 py-[14px] text-[16px] font-semibold ${
                  overlay === 'delete' || overlay === 'block'
                    ? 'text-[#ff3040]'
                    : 'text-white'
                }`}
                onClick={confirmYes}
              >
                Да
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="post-more-sheet relative z-[1] px-3 pb-[max(12px,var(--hub-safe-bottom))] pt-2"
          style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
          <div className="flex flex-col gap-2.5">
            {blocks.map((rows, bi) => (
              <div key={bi} className="overflow-hidden rounded-[14px] bg-[#1c1c1e]">
                {rows.map((row, ri) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={row.action}
                    className={`pressable flex w-full items-center justify-between gap-3 px-4 py-[14px] text-left text-[16px] ${
                      row.danger ? 'text-[#ff3040]' : 'text-white'
                    } ${ri < rows.length - 1 ? 'border-b border-white/[0.08]' : ''}`}
                  >
                    <span className="font-normal">{row.label}</span>
                    <span className={row.danger ? 'text-[#ff3040]' : 'text-white'}>
                      {row.icon}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Поделиться постом"
        path={`/app/p/${postId}`}
      />
    </div>,
    host,
  )
}
