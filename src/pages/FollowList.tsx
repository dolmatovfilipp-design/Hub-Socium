import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { useNavMotion } from '../components/NavMotion'
import {
  apiListFollowers,
  apiListFollowingOf,
  isApiMode,
  type ApiFollowUser,
} from '../lib/api'
import { useStore } from '../store/useStore'

type Mode = 'followers' | 'following'

export function FollowList() {
  const { userId, mode } = useParams<{ userId: string; mode: Mode }>()
  const kind: Mode = mode === 'following' ? 'following' : 'followers'
  const { motionClass, dismiss } = useNavMotion('push')
  const navigate = useNavigate()
  const showToast = useStore((s) => s.showToast)
  const users = useStore((s) => s.users)
  const followingIds = useStore((s) => s.followingIds)
  const currentUserId = useStore((s) => s.currentUserId)

  const [items, setItems] = useState<ApiFollowUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        if (isApiMode()) {
          const data =
            kind === 'followers'
              ? await apiListFollowers(userId)
              : await apiListFollowingOf(userId)
          if (!cancelled) setItems(data.items ?? [])
        } else {
          // Local: approximate from store
          if (kind === 'following') {
            const list = followingIds
              .map((id) => users.find((u) => u.id === id))
              .filter(Boolean)
              .map((u) => ({
                id: u!.id,
                username: u!.username,
                display_name: u!.name,
                avatar_url: u!.avatar,
              }))
            if (!cancelled) setItems(list)
          } else {
            // Seed has no reverse graph — show other users as stub followers
            const list = users
              .filter((u) => u.id !== userId)
              .slice(0, 8)
              .map((u) => ({
                id: u.id,
                username: u.username,
                display_name: u.name,
                avatar_url: u.avatar,
              }))
            if (!cancelled) setItems(list)
          }
        }
      } catch (e) {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : 'Не удалось загрузить список')
          setItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, kind, showToast, followingIds, users])

  const title = kind === 'followers' ? 'Подписчики' : 'Подписки'

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-2 pb-2.5 pt-2">
        <button
          type="button"
          className="pressable flex h-11 w-11 items-center justify-center text-white"
          aria-label="Назад"
          onClick={() => dismiss(-1)}
        >
          <span className="text-[28px] font-light leading-none">‹</span>
        </button>
        <h1 className="flex-1 text-center text-[16px] font-bold text-white">{title}</h1>
        <span className="h-11 w-11" aria-hidden />
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8 pt-1">
        {loading && (
          <p className="py-10 text-center text-[15px] text-[#777]">Загрузка…</p>
        )}
        {!loading &&
          items.map((u) => (
            <button
              key={u.id}
              type="button"
              className="flex w-full items-center gap-3 py-3 text-left active:bg-white/[0.03]"
              onClick={() => {
                if (u.id === currentUserId) navigate('/app/profile')
                else navigate(`/app/profile/${u.id}`)
              }}
            >
              <Avatar
                name={u.display_name || u.username}
                id={u.id}
                src={u.avatar_url || undefined}
                size={44}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-white">
                  {u.display_name || u.username}
                </p>
                <p className="truncate text-[13px] text-[#8e8e93]">@{u.username}</p>
              </div>
            </button>
          ))}
        {!loading && !items.length && (
          <p className="py-10 text-center text-[15px] text-[#777]">Пока пусто</p>
        )}
      </div>
    </div>
  )
}
