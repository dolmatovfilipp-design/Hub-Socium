import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent, type UIEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { PostCard } from '../components/PostCard'
import { Avatar } from '../components/Avatar'
import { Market } from './Market'
import { IconHubMark, IconMenu, IconSearch, IconClose } from '../components/Icons'
import { isApiMode } from '../lib/api'

export function Feed() {
  const [tab, setTab] = useState<'feed' | 'market'>('feed')
  const [menuOpen, setMenuOpen] = useState(false)
  const allPosts = useStore((s) => s.posts)
  const posts = useMemo(() => allPosts.filter((p) => !p.replyToId), [allPosts])
  const refreshFeed = useStore((s) => s.refreshFeed)
  const loadMoreFeed = useStore((s) => s.loadMoreFeed)
  const feedCursor = useStore((s) => s.feedCursor)
  const feedLoading = useStore((s) => s.feedLoading)
  const currentUserId = useStore((s) => s.currentUserId)
  const user = useStore((s) => {
    const id = s.currentUserId
    return id ? s.users.find((u) => u.id === id) : undefined
  })
  const [pulling, setPulling] = useState(false)
  const startY = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (isApiMode()) void refreshFeed({ silent: true })
  }, [refreshFeed])

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!isApiMode() || !feedCursor || feedLoading) return
      const el = e.currentTarget
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        void loadMoreFeed()
      }
    },
    [feedCursor, feedLoading, loadMoreFeed],
  )

  const onTouchStart = (e: TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY
    } else {
      startY.current = 0
    }
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (!startY.current) return
    const dy = e.changedTouches[0].clientY - startY.current
    if (dy > 70 && tab === 'feed') {
      setPulling(true)
      refreshFeed()
      setTimeout(() => setPulling(false), 600)
    }
    startY.current = 0
  }

  return (
    <div className="relative flex h-full flex-col bg-black">
      <header className="safe-top z-10 shrink-0 bg-black/90 px-4 pb-1 backdrop-blur-md">
        <div className="relative flex h-11 items-center justify-between">
          <button
            type="button"
            aria-label="Меню"
            className="pressable flex h-10 w-10 items-center justify-center text-white"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <IconClose size={22} /> : <IconMenu size={22} />}
          </button>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
            <IconHubMark size={28} />
          </span>
          <button
            type="button"
            aria-label="Поиск"
            className="pressable flex h-10 w-10 items-center justify-center text-white"
            onClick={() => navigate('/app/messages')}
          >
            <IconSearch size={22} />
          </button>
        </div>

        {menuOpen && (
          <div className="mb-2 animate-fade-in rounded-2xl border border-white/[0.08] bg-[#111] p-1">
            <button
              type="button"
              className={`flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                tab === 'feed' ? 'bg-white/[0.08] text-white' : 'text-[#a8a8a8]'
              }`}
              onClick={() => {
                setTab('feed')
                setMenuOpen(false)
              }}
            >
              Лента
            </button>
            <button
              type="button"
              className={`flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                tab === 'market' ? 'bg-white/[0.08] text-white' : 'text-[#a8a8a8]'
              }`}
              onClick={() => {
                setTab('market')
                setMenuOpen(false)
              }}
            >
              Маркет
            </button>
          </div>
        )}
      </header>

      <div
        ref={scrollRef}
        className="no-scrollbar scroll-pad-nav flex-1 overflow-y-auto"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onScroll={onScroll}
      >
        {tab === 'feed' ? (
          <>
            {currentUserId && (
              <Link
                to="/app/compose"
                className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 active:bg-white/[0.02]"
              >
                <Avatar
                  name={user?.name ?? '…'}
                  id={user?.id ?? currentUserId}
                  src={user?.avatar}
                  size={36}
                />
                <span className="text-[15px] text-[#777]">Что нового?</span>
              </Link>
            )}
            {pulling && (
              <div className="py-3 text-center text-xs text-[#777]">Обновление…</div>
            )}
            {posts.map((p) => (
              <PostCard key={p.id} postId={p.id} />
            ))}
            {!posts.length && !feedLoading && (
              <p className="px-4 py-12 text-center text-[#777]">Пока нет публикаций</p>
            )}
            {isApiMode() && feedLoading && (
              <p className="px-4 py-4 text-center text-xs text-[#777]">Загрузка…</p>
            )}
            {isApiMode() && feedCursor && !feedLoading && (
              <p className="px-4 py-4 text-center text-xs text-[#555]">Прокрутите ниже для ещё</p>
            )}
          </>
        ) : (
          <Market embedded />
        )}
      </div>
    </div>
  )
}
