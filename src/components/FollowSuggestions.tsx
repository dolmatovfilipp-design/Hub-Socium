import { useCallback, useEffect, useState } from 'react'
import { apiSearchUsers, isApiMode, type ApiSearchUser } from '../lib/api'
import { useStore } from '../store/useStore'
import { Avatar } from './Avatar'
import { publicAppUrl } from './ShareSheet'

const STORAGE_KEY = 'hub_follow_nudge_v1'
const TARGET = 5

export function shouldShowFollowNudge(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1'
  } catch {
    return true
  }
}

export function markFollowNudgeSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function FollowSuggestions({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const followUser = useStore((s) => s.followUser)
  const followingIds = useStore((s) => s.followingIds)
  const currentUserId = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  const showToast = useStore((s) => s.showToast)
  const [items, setItems] = useState<ApiSearchUser[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)

  const load = useCallback(async () => {
    if (!isApiMode()) {
      setItems(
        users
          .filter((u) => u.id !== currentUserId && !followingIds.includes(u.id))
          .slice(0, 12)
          .map((u) => ({
            id: u.id,
            username: u.username,
            display_name: u.name,
            avatar_url: u.avatar,
          })),
      )
      return
    }
    try {
      const res = await apiSearchUsers({ q: '', limit: 24 })
      setItems((res.items || []).filter((u) => u.id !== currentUserId).slice(0, 12))
    } catch {
      setItems([])
    }
  }, [currentUserId, followingIds, users])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  if (!open) return null

  const done = () => {
    markFollowNudgeSeen()
    onClose()
  }

  const shareTg = () => {
    const url = publicAppUrl('/invite')
    const text = 'Присоединяйся в Get Hub — коротко и по делу'
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[var(--hub-z-sheet)] flex items-end justify-center bg-black/70 sm:items-center">
      <div className="relative z-[var(--hub-z-base)] max-h-[85%] w-full max-w-md overflow-hidden rounded-t-3xl border border-white/[0.08] bg-[#111] sm:rounded-3xl">
        <div className="px-5 pb-2 pt-4">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
          <h3 className="text-center text-[17px] font-bold text-white">5 подписок для старта</h3>
          <p className="mt-1 text-center text-[13px] text-[#8e8e93]">
            Лента оживает, когда вы на кого-то подписаны. Выберите до {TARGET} человек.
          </p>
          <p className="mt-2 text-center text-[12px] text-[#aaa]">
            Выбрано: {picked}/{TARGET}
          </p>
        </div>
        <div className="max-h-[45vh] space-y-1 overflow-y-auto px-3 pb-3">
          {items.map((u) => {
            const already = followingIds.includes(u.id)
            return (
              <div key={u.id} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                <Avatar name={u.display_name || u.username} id={u.id} src={u.avatar_url || undefined} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-white">{u.username}</p>
                  <p className="truncate text-[12px] text-[#8e8e93]">{u.display_name}</p>
                </div>
                <button
                  type="button"
                  disabled={already || busy === u.id || picked >= TARGET}
                  className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-black disabled:opacity-40"
                  onClick={() => {
                    void (async () => {
                      setBusy(u.id)
                      try {
                        const res = await followUser(u.id)
                        if (!res.ok) {
                          showToast(res.error ?? 'Ошибка')
                          return
                        }
                        setPicked((n) => Math.min(TARGET, n + 1))
                        showToast(`Подписка на @${u.username}`)
                      } finally {
                        setBusy(null)
                      }
                    })()
                  }}
                >
                  {already ? 'ОК' : busy === u.id ? '…' : 'Подписка'}
                </button>
              </div>
            )
          })}
          {!items.length ? (
            <p className="py-8 text-center text-[14px] text-[#777]">Пока нет подсказок — поищите людей в сообщении.</p>
          ) : null}
        </div>
        <div className="flex gap-2 border-t border-white/[0.06] px-4 py-3 pb-[max(1rem,var(--hub-safe-bottom))]">
          <button
            type="button"
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-[#2AABEE]/80 text-[14px] font-semibold text-white"
            onClick={shareTg}
          >
            В Telegram
          </button>
          <button
            type="button"
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-white text-[14px] font-semibold text-black"
            onClick={done}
          >
            {picked >= TARGET ? 'Готово' : 'Позже'}
          </button>
        </div>
      </div>
    </div>
  )
}
