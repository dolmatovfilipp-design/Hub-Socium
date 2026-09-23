import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent,
  type UIEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { PostCard } from '../components/PostCard'
import { Avatar } from '../components/Avatar'
import { Market } from './Market'
import { FeedsDrawer, type FeedsDrawerItemId } from '../components/FeedsDrawer'
import { HubEmptyState } from '../components/HubEmptyState'
import { IconMenu } from '../components/Icons'
import { isApiMode } from '../lib/api'

/** Match CSS `--feeds-panel-width: min(85vw, 340px)` */
function getPanelWidth(): number {
  return Math.min(window.innerWidth * 0.85, 340)
}

const EDGE_OPEN_PX = 24
const NEAR_LEFT_PX = 80
const CLAIM_PX = 8
const VELOCITY_OPEN = 0.5 // px/ms toward open
const VELOCITY_CLOSE = -0.5
const THRESH_FROM_CLOSED = 0.25
const THRESH_FROM_OPEN = 0.75
const SPRING_K = 300
const SPRING_D = 36 // ~critically damped for k=300; no bounce
const SETTLE_EPS = 0.002
const SETTLE_V = 0.02

type Sample = { t: number; x: number }

type GestureState = {
  active: boolean
  claimed: boolean
  startX: number
  startY: number
  originProgress: number
  wasOpen: boolean
  samples: Sample[]
}

export function Feed() {
  const [tab, setTab] = useState<'feed' | 'market' | 'shell'>('feed')
  const [shellTitle, setShellTitle] = useState('')
  const [feedTag, setFeedTag] = useState('')
  const [drawerSettledOpen, setDrawerSettledOpen] = useState(false)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [drawerInteractive, setDrawerInteractive] = useState(false)
  const allPosts = useStore((s) => s.posts)
  const hiddenPostIds = useStore((s) => s.hiddenPostIds)
  const hiddenAuthorIds = useStore((s) => s.hiddenAuthorIds)
  const restrictedAuthorIds = useStore((s) => s.restrictedAuthorIds)
  const blockedAuthorIds = useStore((s) => s.blockedAuthorIds)
  const interestedAuthorIds = useStore((s) => s.interestedAuthorIds)
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const progressRef = useRef(0)
  const settledOpenRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const springVelRef = useRef(0)
  const gestureRef = useRef<GestureState>({
    active: false,
    claimed: false,
    startX: 0,
    startY: 0,
    originProgress: 0,
    wasOpen: false,
    samples: [],
  })

  const syncDrawerUi = useCallback((p: number, settled: boolean) => {
    const visible = p > 0.01
    const interactive = p > 0.5 || settled
    setDrawerVisible((v) => (v === visible ? v : visible))
    setDrawerInteractive((v) => (v === interactive ? v : interactive))
    setDrawerSettledOpen((v) => (v === settled ? v : settled))
  }, [])

  const applyProgress = useCallback(
    (p: number) => {
      const clamped = Math.max(0, Math.min(1, p))
      progressRef.current = clamped
      const el = stageRef.current
      if (el) {
        el.style.setProperty('--feeds-p', String(clamped))
        if (clamped > 0.01) el.dataset.feedsOpen = 'true'
        else delete el.dataset.feedsOpen
      }
      syncDrawerUi(clamped, settledOpenRef.current)
    },
    [syncDrawerUi],
  )

  const stopSpring = useCallback(() => {
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
  }, [])

  const springTo = useCallback(
    (target: 0 | 1) => {
      stopSpring()
      springVelRef.current = 0
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        settledOpenRef.current = target === 1
        applyProgress(target)
        syncDrawerUi(target, target === 1)
        return
      }

      let last = performance.now()
      const tick = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000)
        last = now
        let pos = progressRef.current
        let vel = springVelRef.current
        const force = -SPRING_K * (pos - target) - SPRING_D * vel
        vel += force * dt
        pos += vel * dt
        if ((target === 1 && pos >= 1) || (target === 0 && pos <= 0)) {
          pos = target
          vel = 0
        }
        springVelRef.current = vel
        applyProgress(pos)

        if (Math.abs(pos - target) < SETTLE_EPS && Math.abs(vel) < SETTLE_V) {
          animFrameRef.current = null
          springVelRef.current = 0
          settledOpenRef.current = target === 1
          applyProgress(target)
          syncDrawerUi(target, target === 1)
          return
        }
        animFrameRef.current = requestAnimationFrame(tick)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    },
    [applyProgress, stopSpring, syncDrawerUi],
  )

  const closeDrawer = useCallback(() => springTo(0), [springTo])
  const toggleDrawer = useCallback(() => {
    stopSpring()
    const toClose = settledOpenRef.current || progressRef.current > 0.5
    springTo(toClose ? 0 : 1)
  }, [springTo, stopSpring])

  useEffect(() => {
    if (isApiMode()) void refreshFeed({ silent: true })
  }, [refreshFeed])

  useEffect(() => {
    if (!drawerVisible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerVisible])

  useEffect(() => () => stopSpring(), [stopSpring])

  // Non-passive touchmove so we can preventDefault once the drawer gesture is claimed
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const pushSample = (samples: Sample[], x: number, t: number) => {
      samples.push({ x, t })
      while (samples.length > 6) samples.shift()
      while (samples.length > 2 && t - samples[0].t > 100) samples.shift()
    }

    const velocityFromSamples = (samples: Sample[]): number => {
      if (samples.length < 2) return 0
      const a = samples[0]
      const b = samples[samples.length - 1]
      const dt = b.t - a.t
      if (dt <= 0) return 0
      return (b.x - a.x) / dt
    }

    const onTouchStart = (e: globalThis.TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const target = e.target as Node | null
      const stageEl = stageRef.current
      if (!stageEl) return

      const rect = stageEl.getBoundingClientRect()
      const localX = t.clientX - rect.left
      const p = progressRef.current
      const openish = settledOpenRef.current || p > 0.5

      let allow = false
      if (openish) {
        // Close: drag on stage strip or dim
        if (stageEl.contains(target)) allow = true
      } else {
        // Open: edge ~20px or near-left on stage
        if (localX <= EDGE_OPEN_PX || localX <= NEAR_LEFT_PX) allow = true
      }
      if (!allow) return

      // Don't steal from menu button / interactive controls at start
      const el = target as HTMLElement | null
      if (el?.closest('button, a, input, textarea, [role="button"]') && !el.closest('.feeds-stage-dim')) {
        // Still allow dim button; skip real controls
        if (!openish) return
        // When open, dim is the close control — allow; header menu handled separately
        if (el.closest('header')) return
      }

      stopSpring()
      gestureRef.current = {
        active: true,
        claimed: false,
        startX: t.clientX,
        startY: t.clientY,
        originProgress: p,
        wasOpen: openish,
        samples: [{ t: performance.now(), x: t.clientX }],
      }
    }

    const onTouchMove = (e: globalThis.TouchEvent) => {
      const g = gestureRef.current
      if (!g.active || e.touches.length !== 1) return
      const t = e.touches[0]
      const dx = t.clientX - g.startX
      const dy = t.clientY - g.startY
      pushSample(g.samples, t.clientX, performance.now())

      if (!g.claimed) {
        if (Math.abs(dx) < CLAIM_PX && Math.abs(dy) < CLAIM_PX) return
        if (Math.abs(dx) <= Math.abs(dy)) {
          g.active = false
          g.claimed = false
          return
        }
        g.claimed = true
        startY.current = 0 // cancel pull-to-refresh
      }

      if (e.cancelable) e.preventDefault()

      const panelW = getPanelWidth()
      const next = (g.originProgress * panelW + dx) / panelW
      if (settledOpenRef.current && next < 0.99) {
        settledOpenRef.current = false
      }
      applyProgress(next)
    }

    const endGesture = () => {
      const g = gestureRef.current
      if (!g.active) return
      const claimed = g.claimed
      const vel = velocityFromSamples(g.samples)
      const p = progressRef.current
      const wasOpen = g.wasOpen
      g.active = false
      g.claimed = false
      if (!claimed) return

      let target: 0 | 1
      if (wasOpen) {
        target = vel < VELOCITY_CLOSE || p < THRESH_FROM_OPEN ? 0 : 1
      } else {
        target = vel > VELOCITY_OPEN || p > THRESH_FROM_CLOSED ? 1 : 0
      }
      springTo(target)
    }

    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false })
    stage.addEventListener('touchend', endGesture)
    stage.addEventListener('touchcancel', endGesture)
    return () => {
      stage.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove)
      stage.removeEventListener('touchend', endGesture)
      stage.removeEventListener('touchcancel', endGesture)
    }
  }, [applyProgress, springTo, stopSpring])

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
    if (drawerSettledOpen || progressRef.current > 0.01 || gestureRef.current.claimed) {
      startY.current = 0
      return
    }
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY
    } else {
      startY.current = 0
    }
  }

  const onScrollTouchEnd = (e: TouchEvent) => {
    if (
      !startY.current ||
      drawerSettledOpen ||
      progressRef.current > 0.01 ||
      gestureRef.current.claimed
    ) {
      startY.current = 0
      return
    }
    const dy = e.changedTouches[0].clientY - startY.current
    if (dy > 70 && tab === 'feed') {
      setPulling(true)
      refreshFeed()
      setTimeout(() => setPulling(false), 600)
    }
    startY.current = 0
  }

  const onSelectFeed = useCallback(
    (id: FeedsDrawerItemId) => {
      if (id === 'feed') {
        setTab('feed')
        setFeedTag('')
        setShellTitle('')
        closeDrawer()
        return
      }
      if (id === 'market') {
        setTab('market')
        setShellTitle('')
        closeDrawer()
        return
      }
      if (id === 'travel' || id === 'hobby') {
        setTab('feed')
        setFeedTag(id === 'travel' ? 'путешествия' : 'хобби')
        setShellTitle('')
        closeDrawer()
        return
      }
      // Non-market tabs → empty shell (not silent close)
      const labels: Partial<Record<FeedsDrawerItemId, string>> = {
        communities: 'Сообщества',
        video: 'Видео',
        news: 'Новости',
        library: 'Библиотека',
        entertainment: 'Развлечения',
        music: 'Музыка',
        ads: 'Реклама',
      }
      setShellTitle(labels[id] ?? id)
      setTab('shell')
      closeDrawer()
    },
    [closeDrawer],
  )

  const activeId: FeedsDrawerItemId | null =
    tab === 'market' ? 'market' : tab === 'feed' && !feedTag ? 'feed' : feedTag === 'путешествия' ? 'travel' : feedTag === 'хобби' ? 'hobby' : null

  const stageStyle = {
    ['--feeds-p' as string]: '0',
    transform:
      'translateX(calc(var(--feeds-p) * var(--feeds-panel-width))) scale(calc(1 - var(--feeds-p) * 0.1))',
    borderRadius: 'calc(var(--feeds-p) * 32px)',
  } as CSSProperties

  return (
    <div className="relative h-full overflow-hidden bg-black">
      <FeedsDrawer
        open={drawerVisible}
        interactive={drawerInteractive}
        activeId={activeId}
        onClose={closeDrawer}
        onSelect={onSelectFeed}
      />

      <div ref={stageRef} className="feeds-stage relative z-[1] flex h-full flex-col bg-black" style={stageStyle}>
        <header className="safe-top relative z-30 shrink-0 border-b border-white/[0.06] bg-black/95 px-4 pb-0.5 backdrop-blur-md">
          <div className="relative flex h-11 items-center justify-between">
            <button
              type="button"
              aria-label={drawerSettledOpen ? 'Закрыть меню' : 'Меню'}
              aria-expanded={drawerSettledOpen}
              className="pressable flex h-10 w-10 items-center justify-center text-white"
              onClick={toggleDrawer}
            >
              <IconMenu size={22} strokeWidth={1.35} />
            </button>
            <div className="h-10 w-10" aria-hidden />
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
                  className="composer-row hub-row-divider flex items-center gap-3 px-4 py-3"
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
              {pulling && (
                <div className="py-3 text-center text-xs text-[#777]">Обновление…</div>
              )}
              {posts.map((p) => (
                <PostCard key={p.id} postId={p.id} />
              ))}
              {!posts.length && !feedLoading && (
                <p className="px-4 py-12 text-center text-[#777]">Пока нет публикаций</p>
              )}
              {isApiMode() && feedLoading && posts.length === 0 && (
                <div className="space-y-3 px-4 py-4" aria-label="Загрузка ленты">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="animate-pulse rounded-2xl bg-white/[0.06] p-4">
                      <div className="flex gap-3">
                        <div className="h-9 w-9 rounded-full bg-white/10" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-1/3 rounded bg-white/10" />
                          <div className="h-3 w-full rounded bg-white/10" />
                          <div className="h-3 w-2/3 rounded bg-white/10" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {isApiMode() && feedCursor && !feedLoading && (
                <p className="px-4 py-4 text-center text-xs text-[#555]">Прокрутите ниже для ещё</p>
              )}
            </>
          ) : tab === 'shell' ? (
            <HubEmptyState
              title={shellTitle || 'Раздел'}
              subtitle="Пока пусто — раздел появится в следующих итерациях Hub."
            />
          ) : (
            <Market embedded />
          )}
        </div>

        <button
          type="button"
          className="feeds-stage-dim absolute inset-0 z-20"
          aria-label="Закрыть"
          tabIndex={drawerInteractive ? 0 : -1}
          onClick={() => {
            if (progressRef.current > 0.4) closeDrawer()
          }}
          style={{ pointerEvents: drawerVisible ? 'auto' : 'none' }}
        />
      </div>
    </div>
  )
}
