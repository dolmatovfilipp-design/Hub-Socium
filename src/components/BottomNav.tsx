import { NavLink, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useStore } from '../store/useStore'
import {
  IconHome,
  IconPlane,
  IconHeart,
  IconUser,
  IconSearch,
  IconVideo,
  IconMusic,
} from './Icons'
import { apiListActivity, apiListConversations, isApiMode } from '../lib/api'
import {
  applyNavTheme,
  loadNavPrefs,
  saveNavPrefs,
  NAV_CATALOG,
  getVisibleNavItemIds,
  type NavItemId,
  type NavPrefs,
} from '../lib/navPrefs'
import { prefetchPath } from '../lib/routeWarmup'

function formatBadge(n: number): string {
  return n > 99 ? '99+' : String(n)
}

type PillTarget = { x: number; y: number; w: number; h: number }

function isNavItemActive(id: NavItemId, pathname: string): boolean {
  switch (id) {
    case 'home':
      return pathname === '/app'
    case 'messages':
      return pathname === '/app/messages' || pathname.startsWith('/app/messages/')
    case 'activity':
      return pathname.startsWith('/app/activity')
    case 'profile':
      return pathname === '/app/profile' || pathname.startsWith('/app/profile/') || pathname.startsWith('/app/u/')
    case 'search':
      return pathname.startsWith('/app/explore')
    case 'video':
      return pathname.startsWith('/app/clips')
    case 'music':
      return pathname.startsWith('/app/music')
    default:
      return false
  }
}

function NavGlyph({ kind, active }: { kind: NavItemId; active: boolean }) {
  const sw = 1.35
  switch (kind) {
    case 'home':
      return <IconHome size={24} filled={active} strokeWidth={sw} />
    case 'messages':
      return <IconPlane size={23} filled={active} strokeWidth={sw} />
    case 'activity':
      return <IconHeart size={24} filled={active} strokeWidth={sw} />
    case 'profile':
      return <IconUser size={24} filled={active} strokeWidth={sw} />
    case 'search':
      return <IconSearch size={23} filled={active} strokeWidth={sw} />
    case 'video':
      return <IconVideo size={23} filled={active} strokeWidth={sw} />
    case 'music':
      return <IconMusic size={23} filled={active} strokeWidth={sw} />
    default:
      return null
  }
}

export function BottomNav() {
  const location = useLocation()
  const activities = useStore((s) => s.activities)
  const messages = useStore((s) => s.messages)
  const uid = useStore((s) => s.currentUserId)
  const api = isApiMode()

  const [prefs, setPrefs] = useState<NavPrefs>(() => loadNavPrefs())
  const homeTapTimerRef = useRef<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<PillTarget | null>(null)
  const dragRef = useRef(0)
  const animRef = useRef({ x: 0, y: 0, w: 0, h: 0, ready: false })
  const rafRef = useRef(0)
  const [apiUnreadMsgs, setApiUnreadMsgs] = useState(0)
  const [apiUnreadAct, setApiUnreadAct] = useState(0)

  useEffect(() => {
    applyNavTheme(prefs)
  }, [prefs])

  useEffect(() => {
    return () => {
      if (homeTapTimerRef.current !== null) window.clearTimeout(homeTapTimerRef.current)
    }
  }, [])

  const toggleNavCollapsed = useCallback(() => {
    const next = { ...prefs, collapsed: !prefs.collapsed }
    setPrefs(next)
    saveNavPrefs(next)
  }, [prefs])

  const handleHomeClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (homeTapTimerRef.current !== null) {
        window.clearTimeout(homeTapTimerRef.current)
        homeTapTimerRef.current = null
        // The first click already performs the normal navigation; the second
        // click only changes the nav presentation.
        event.preventDefault()
        event.stopPropagation()
        toggleNavCollapsed()
        return
      }
      homeTapTimerRef.current = window.setTimeout(() => {
        homeTapTimerRef.current = null
      }, 300)
    },
    [toggleNavCollapsed],
  )

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent<NavPrefs>).detail
      if (detail) setPrefs(detail)
      else setPrefs(loadNavPrefs())
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'hub-nav-prefs-v1') setPrefs(loadNavPrefs())
    }
    window.addEventListener('hub-nav-prefs', onPrefs)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('hub-nav-prefs', onPrefs)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const localUnread = useMemo(
    () => activities.reduce((n, a) => n + (a.read ? 0 : 1), 0),
    [activities],
  )
  const localUnreadMsgs = useMemo(
    () => messages.reduce((n, m) => n + (!m.read && m.senderId !== uid ? 1 : 0), 0),
    [messages, uid],
  )

  const refreshBadges = useCallback(async () => {
    if (!isApiMode() || !uid) return
    try {
      const [convs, acts] = await Promise.all([
        apiListConversations(),
        apiListActivity('all', 30),
      ])
      setApiUnreadMsgs((convs.items ?? []).reduce((n, c) => n + (c.unread || 0), 0))
      setApiUnreadAct((acts.items ?? []).reduce((n, a) => n + (a.read ? 0 : 1), 0))
    } catch {
      // ignore transient errors
    }
  }, [uid])

  useEffect(() => {
    if (!api || !uid) return
    void refreshBadges()
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshBadges()
    }
    window.addEventListener('focus', refreshBadges)
    document.addEventListener('visibilitychange', onVis)
    const h = window.setInterval(() => void refreshBadges(), 12000)
    return () => {
      window.removeEventListener('focus', refreshBadges)
      document.removeEventListener('visibilitychange', onVis)
      window.clearInterval(h)
    }
  }, [api, uid, refreshBadges, location.pathname])

  const unread = api ? apiUnreadAct : localUnread
  const unreadMsgs = api ? apiUnreadMsgs : localUnreadMsgs

  const paintSlider = useCallback(() => {
    const el = sliderRef.current
    const target = targetRef.current
    const anim = animRef.current
    if (!el || !target) {
      if (el) el.style.opacity = '0'
      return false
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let left = target.x
    if (!anim.ready || reduce) {
      anim.x = target.x
      anim.y = target.y
      anim.w = target.w
      anim.h = target.h
      anim.ready = true
    } else {
      anim.x += (target.x - anim.x) * 0.2
      const gap = target.x - anim.x
      if (Math.abs(gap) < 0.8) {
        anim.y = target.y
        anim.h = target.h
      } else {
        anim.y += (target.y - anim.y) * 0.28
        anim.h += (target.h - anim.h) * 0.28
      }
      const stretch = Math.min(Math.abs(gap) * 0.16, target.w * 0.08)
      anim.w = target.w + stretch
      left = gap >= 0 ? anim.x : anim.x - stretch
    }
    el.style.opacity = '1'
    el.style.width = `${anim.w}px`
    el.style.height = `${anim.h}px`
    el.style.transform = `translate3d(${left}px, ${anim.y}px, 0)`
    const settled =
      reduce ||
      (Math.abs(target.x - anim.x) < 0.4 &&
        Math.abs(anim.w - target.w) < 0.4 &&
        Math.abs(target.y - anim.y) < 0.4 &&
        Math.abs(target.h - anim.h) < 0.4)
    if (!settled) return true
    anim.x = target.x
    anim.y = target.y
    anim.w = target.w
    anim.h = target.h
    el.style.width = `${target.w}px`
    el.style.height = `${target.h}px`
    el.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`
    return false
  }, [])

  const kickSlider = useCallback(() => {
    const more = paintSlider()
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (!more) return
    const loop = () => {
      rafRef.current = 0
      if (paintSlider()) rafRef.current = window.requestAnimationFrame(loop)
    }
    rafRef.current = window.requestAnimationFrame(loop)
  }, [paintSlider])

  const measureSlider = useCallback(() => {
    const bar = barRef.current
    if (!bar || !prefs.showFrameAndIndicator) {
      targetRef.current = null
      kickSlider()
      return
    }
    const active = bar.querySelector<HTMLElement>('.nav-item.is-active')
    if (!active) {
      targetRef.current = null
      kickSlider()
      return
    }
    const style = window.getComputedStyle(bar)
    const padTop = parseFloat(style.paddingTop) || 0
    const padBottom = parseFloat(style.paddingBottom) || 0
    const borderY = bar.offsetHeight - bar.clientHeight
    const borderTop = borderY / 2
    const borderBottom = borderY - borderTop
    const innerH = bar.clientHeight - padTop - padBottom
    const inset = Math.min(6, Math.max(4, Math.round(bar.offsetHeight * 0.09)))
    const y = Math.max(0, inset - borderTop - padTop)
    const bottomGap = Math.max(0, inset - borderBottom)
    const h = Math.max(22, innerH - y - bottomGap)
    const w = Math.max(28, active.offsetWidth - inset * 2)
    let x = active.offsetLeft + inset
    const drag = dragRef.current
    if (drag) {
      const slots = [...bar.querySelectorAll<HTMLElement>('.nav-item')]
      const index = slots.indexOf(active)
      const neighbor = slots[index + (drag < 0 ? 1 : -1)]
      if (neighbor) {
        const nx = neighbor.offsetLeft + (neighbor.offsetWidth - w) / 2
        const span = Math.max(36, Math.abs(nx - x))
        const t = Math.min(1, Math.abs(drag) / span)
        x += (nx - x) * t
      }
    }
    x = Math.max(2, Math.min(x, bar.clientWidth - w - 2))
    targetRef.current = { x, y, w, h }
    kickSlider()
  }, [kickSlider, prefs.showFrameAndIndicator])

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => {
    const onDrag = (event: Event) => {
      const detail = (event as CustomEvent<{ dx?: number; phase?: string }>).detail
      dragRef.current = detail?.phase === 'move' ? detail.dx || 0 : 0
      measureSlider()
    }
    window.addEventListener('hub:nav-drag', onDrag)
    return () => window.removeEventListener('hub:nav-drag', onDrag)
  }, [measureSlider])

  const itemIds: NavItemId[] = getVisibleNavItemIds(prefs)

  const items = itemIds
    .map((id) => {
      const meta = NAV_CATALOG[id]
      if (!meta) return null
      return { id, ...meta }
    })
    .filter(Boolean) as { id: NavItemId; label: string; to: string; end?: boolean }[]

  useLayoutEffect(() => {
    measureSlider()
    const bar = barRef.current
    if (!bar) return
    const observer = new ResizeObserver(() => measureSlider())
    observer.observe(bar)
    bar.querySelectorAll('.nav-item').forEach((node) => observer.observe(node))
    window.addEventListener('resize', measureSlider)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureSlider)
    }
  }, [measureSlider, location.pathname, prefs.collapsed, prefs.scale, prefs.theme, itemIds.join('|')])

  return (
    <nav
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[var(--hub-z-nav)] flex justify-center"
      style={{
        paddingLeft: 'var(--hub-nav-inset-x)',
        paddingRight: 'var(--hub-nav-inset-x)',
        paddingBottom: 'calc(var(--hub-nav-inset-b) + var(--hub-safe-bottom))',
      }}
    >
      <div className="w-full max-w-[400px]">
        <div
          ref={barRef}
          className={`pointer-events-auto nav-pill relative ${prefs.showFrameAndIndicator ? 'glass-pill' : 'nav-pill-bare'} flex w-full items-stretch justify-around overflow-hidden rounded-full px-1 ${prefs.collapsed ? 'nav-pill-collapsed' : ''}`}
          style={{ height: 'var(--hub-nav-pill-h, 56px)' }}
          data-nav-theme={prefs.theme}
          data-nav-collapsed={prefs.collapsed ? 'true' : 'false'}
          data-nav-decorations={prefs.showFrameAndIndicator ? 'visible' : 'hidden'}
        >
        {prefs.showFrameAndIndicator && <div ref={sliderRef} className="nav-slider" aria-hidden />}
        {items.map(({ id, to, end, label }) => {
          const badge =
            id === 'messages' ? unreadMsgs : id === 'activity' ? unread : 0
          const active = isNavItemActive(id, location.pathname)

          return (
            <NavLink
              key={`${id}-${to}`}
              to={to}
              end={!!end}
              aria-label={
                id === 'home'
                  ? prefs.collapsed
                    ? 'Главная · развернуть навигацию двойным нажатием'
                    : 'Главная · свернуть навигацию двойным нажатием'
                  : badge > 0
                    ? `${label}, ${badge}`
                    : label
              }
              onPointerDown={() => prefetchPath(to)}
              onClick={id === 'home' ? handleHomeClick : undefined}
              aria-expanded={id === 'home' ? !prefs.collapsed : undefined}
              className={`nav-item relative z-[1] flex h-full min-w-0 flex-1 items-center justify-center ${id === 'home' ? 'nav-item-home' : ''} ${active ? 'is-active' : ''}`}
            >
              <span className={`nav-icon-wrap ${active ? 'active' : ''}`}>
                <NavGlyph kind={id} active={active} />
              </span>
              {badge > 0 && (
                <span className="nav-unread-badge" aria-hidden>
                  {formatBadge(badge)}
                </span>
              )}
            </NavLink>
          )
        })}
        </div>
      </div>
    </nav>
  )
}
