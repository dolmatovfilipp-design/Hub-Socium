import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { PostCard } from '../components/PostCard'
import { IconSettings, IconClose } from '../components/Icons'
import { useEffect, useMemo, useState } from 'react'
import { isApiMode } from '../lib/api'

export function Profile() {
  const { userId } = useParams<{ userId?: string }>()
  const navigate = useNavigate()
  const currentId = useStore((s) => s.currentUserId)!
  const targetId = userId ?? currentId
  const loadProfile = useStore((s) => s.loadProfile)
  const user = useStore((s) => s.users.find((u) => u.id === targetId))
  const allPosts = useStore((s) => s.posts)
  const posts = useMemo(
    () => allPosts.filter((p) => p.authorId === targetId && !p.replyToId),
    [allPosts, targetId],
  )
  const replies = useMemo(
    () => allPosts.filter((p) => p.authorId === targetId && !!p.replyToId),
    [allPosts, targetId],
  )
  const logout = useStore((s) => s.logout)
  const [tab, setTab] = useState<'threads' | 'replies'>('threads')
  const [loading, setLoading] = useState(isApiMode())
  const isMe = targetId === currentId

  useEffect(() => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const key = isMe ? currentId : targetId
      await loadProfile(key)
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [targetId, currentId, isMe, loadProfile])

  if (loading && !user) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-[#777]">
        Загрузка профиля…
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-[#777]">
        Пользователь не найден
      </div>
    )
  }

  const list = tab === 'threads' ? posts : replies

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top z-10 flex shrink-0 items-center justify-between bg-black px-3 pb-2 pt-2">
        <span className="pl-2 text-[20px] font-bold text-white">
          {isMe ? 'Профиль' : `@${user.username}`}
        </span>
        {isMe && (
          <div className="flex items-center">
            <Link
              to="/app/settings"
              className="pressable flex h-11 w-11 items-center justify-center text-white"
              aria-label="Настройки"
            >
              <IconSettings size={22} />
            </Link>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/', { replace: true }))
              }}
              className="pressable flex h-11 w-11 items-center justify-center text-[#777]"
              aria-label="Выйти"
            >
              <IconClose size={20} />
            </button>
          </div>
        )}
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto scroll-pad-nav">
        <div className="px-4 pt-4">
          <div className="flex items-start gap-4">
            <Avatar name={user.name} id={user.id} src={user.avatar} size={74} />
            <div className="min-w-0 flex-1 pt-1">
              <h2 className="text-xl font-bold text-white">{user.name}</h2>
              <p className="text-sm text-[#777]">@{user.username}</p>
              <div className="mt-3 flex gap-4 text-sm">
                <span>
                  <strong className="text-white">{posts.length}</strong>{' '}
                  <span className="text-[#777]">веток</span>
                </span>
                <span>
                  <strong className="text-white">{user.followers}</strong>{' '}
                  <span className="text-[#777]">подп.</span>
                </span>
                <span>
                  <strong className="text-white">{user.following}</strong>{' '}
                  <span className="text-[#777]">подписки</span>
                </span>
              </div>
            </div>
          </div>
          {user.bio && (
            <p className="mt-4 text-[15px] leading-relaxed text-[#c8c8c8]">{user.bio}</p>
          )}
          {isMe && (
            <Link
              to="/app/profile/edit"
              className="mt-4 flex h-10 items-center justify-center rounded-xl border border-white/15 bg-transparent text-sm font-semibold text-white"
            >
              Редактировать профиль
            </Link>
          )}
          {isApiMode() && (
            <p className="mt-3 text-center text-[12px] text-[#555]">Профиль с сервера</p>
          )}
        </div>

        <div className="mt-5 flex border-b border-white/[0.06] px-4">
          <button
            type="button"
            onClick={() => setTab('threads')}
            className={`flex-1 border-b-2 py-3 text-sm font-semibold transition ${
              tab === 'threads'
                ? 'border-white text-white'
                : 'border-transparent text-[#777]'
            }`}
          >
            Ветки
          </button>
          <button
            type="button"
            onClick={() => setTab('replies')}
            className={`flex-1 border-b-2 py-3 text-sm font-semibold transition ${
              tab === 'replies'
                ? 'border-white text-white'
                : 'border-transparent text-[#777]'
            }`}
          >
            Ответы
          </button>
        </div>

        {list.map((p) => (
          <PostCard key={p.id} postId={p.id} showFollowPlus={false} />
        ))}
        {!list.length && (
          <p className="px-4 py-10 text-center text-[#777]">
            {tab === 'threads' ? 'Нет веток' : 'Нет ответов'}
          </p>
        )}
      </div>
    </div>
  )
}
