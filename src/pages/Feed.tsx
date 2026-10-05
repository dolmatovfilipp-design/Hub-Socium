import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
  type UIEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { StoriesBar } from '../components/StoriesBar'
import { PostCard } from '../components/PostCard'
import { Avatar } from '../components/Avatar'
import { Market } from './Market'
import { HubEmptyState } from '../components/HubEmptyState'
import { FeedSkeleton } from '../components/Skeleton'
import { IconFeedCard, IconSearch } from '../components/Icons'
import { isApiMode } from '../lib/api'

function IconCart({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.7 5.35 7.2 8.05" />
      <path d="M7.2 8.05h12.05l-1.65 6.2a1.2 1.2 0 0 1-1.15.85H9.2a1.2 1.2 0 0 1-1.16-.88L7.2 8.05z" />
      <circle cx="10.2" cy="18.15" r="1.45" fill="currentColor" stroke="none" />
      <circle cx="16.15" cy="18.15" r="1.45" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function Feed() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'feed' | 'market'>('feed')
  const allPosts = useStore((s) => s.posts)
  const hiddenPostIds = useStore((s) => s.hiddenPostIds)
  const hiddenAuthorIds = useStore((s) => s.hiddenAuthorIds)
  const restrictedAuthorIds = useStore((s) => s.restrictedAuthorIds)
  const blockedAuthorIds = useStore((s) => s.blockedAuthorIds)
  const interestedAuthorIds = useStore((s) => s.interestedAuthorIds)
  const hideStories = useStore((s) => s.settings.hideStories)
  const posts = useMemo(() => {
    const muted = new Set([
      ...hiddenAuthorIds,
      ...restrictedAuthorIds,
      ...blockedAuthorIds,
    ])
    const hidden = new Set(hiddenPostIds)
    const interested = new Set(interestedAuthorIds)
    const roots = allPosts.filter(
      (p) =>
        !p.replyToId &&
        !hidden.has(p.id) &&
        !muted.has(p.authorId),
    )
    return [...roots].sort((a, b) => {
      const ai = interested.has(a.authorId) ? 1 : 0
      const bi = interested.has(b.authorId) ? 1 : 0
      return bi - ai
    })
  }, [
    allPosts,
    hiddenPostIds,
    hiddenAuthorIds,
    restrictedAuthorIds,
    blockedAuthorIds,
    interestedAuthorIds,
  ])
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
  const tabSwipeStart = useRef<{ x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const onScrollTouchStart = (e: TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY
    } else {
      startY.current = 0
    }
  }

  const onScrollTouchEnd = (e: TouchEvent) => {
    if (!startY.current) {
      startY.current = 0
      return
    }
    const dy = e.changedTouches[0].clientY - startY.current
    if (dy > 70 && tab === 'feed') {
      setPulling(true)
      void refreshFeed({ silent: false })
      setTimeout(() => setPulling(false), 600)
    }
    startY.current = 0
  }

  // Single morphing Лента/Маркет label — swipe right → Маркет, left → Лента.
  const onTabTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      tabSwipeStart.current = { x: touch.clientX, y: touch.clientY }
    }
  }

  const onTabTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const start = tabSwipeStart.current
    tabSwipeStart.current = null
    if (!start) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    setTab(dx > 0 ? 'market' : 'feed')
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-black">
      <header className="hub-screen-header relative z-30 shrink-0 px-3 pb-0.5">
        <div className="relative flex h-11 items-center justify-between">
          <div
            data-feed-switcher
            className="feed-tab-switcher flex h-10 items-center gap-0.5 rounded-full bg-[#2c2c2e] p-1"
            role="tablist"
            aria-label="Лента или Маркет"
            onTouchStart={onTabTouchStart}
            onTouchEnd={onTabTouchEnd}
            onTouchCancel={(e) => {
              e.stopPropagation()
              tabSwipeStart.current = null
            }}
          >
            <button
              type="button"
              role="tab"
              aria-label="Лента"
              aria-selected={tab === 'feed'}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                tab === 'feed' ? 'bg-white text-black' : 'text-[#aaa]'
              }`}
              onClick={() => setTab('feed')}
            >
              <IconFeedCard size={16} />
            </button>
            <button
              type="button"
              role="tab"
              aria-label="Маркет"
              aria-selected={tab === 'market'}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                tab === 'market' ? 'bg-white text-black' : 'text-[#aaa]'
              }`}
              onClick={() => setTab('market')}
            >
              <IconCart size={16} />
            </button>
          </div>
          <div
            data-feed-switcher
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-bold tracking-tight text-white"
          >
            {tab === 'feed' ? 'Лента' : 'Маркет'}
          </div>
          <button
            type="button"
            aria-label="Поиск"
            className="hub-circle-btn"
            onClick={() => navigate('/app/explore')}
          >
            <IconSearch size={20} strokeWidth={1.45} />
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="no-scrollbar scroll-pad-nav flex-1 overflow-y-auto"
        onTouchStart={onScrollTouchStart}
        onTouchEnd={onScrollTouchEnd}
        onScroll={onScroll}
      >
        {tab === 'feed' ? (
          <>
            {currentUserId && (
              <Link
                to="/app/compose"
                className="composer-row mx-3 mb-2 mt-1 flex items-center gap-3 rounded-[22px] bg-[#1c1c1e] px-4 py-3"
              >
                <Avatar
                  name={user?.name ?? '…'}
                  id={user?.id ?? currentUserId}
                  src={user?.avatar}
                  size={36}
                />
                <span className="text-[15px] leading-snug text-[#777]">Что нового?</span>
              </Link>
            )}
            {!hideStories && <StoriesBar />}
            {pulling && (
              <div className="py-3 text-center text-xs text-[#777]">Обновление…</div>
            )}
            {posts.map((p) => (
              <PostCard key={p.id} postId={p.id} />
            ))}
            {!posts.length && !feedLoading && (
              <HubEmptyState
                title="Лента пуста"
                subtitle="Подпишитесь на людей — их посты появятся здесь."
              />
            )}
            {isApiMode() && feedLoading && posts.length === 0 && <FeedSkeleton />}
            {isApiMode() && feedCursor && !feedLoading && (
              <p className="px-4 py-4 text-center text-xs text-[#8e8e93]">Прокрутите ниже для ещё</p>
            )}
          </>
        ) : (
          <Market embedded />
        )}
      </div>
    </div>
  )
}
