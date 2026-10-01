import { NavLink, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
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
  type NavItemId,
  type NavPrefs,
} from '../lib/navPrefs'

function formatBadge(n: number): string {
  return n > 99 ? '99+' : String(n)
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

  const onMessages =
    location.pathname === '/app/messages' || location.pathname.startsWith('/app/messages/')

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

  const itemIds: NavItemId[] = [
    'home',
    'messages',
    ...(prefs.enableSearch ? ['search' as const] : []),
    ...(prefs.enableVideo ? ['video' as const] : []),
    ...(prefs.enableMusic ? ['music' as const] : []),
    'activity',
    'profile',
  ]

  const items = itemIds
    .map((id) => {
      const meta = NAV_CATALOG[id]
      if (!meta) return null
      return { id, ...meta }
    })
    .filter(Boolean) as { id: NavItemId; label: string; to: string; end?: boolean }[]

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
          className={`pointer-events-auto glass-pill nav-pill flex w-full items-stretch justify-around overflow-hidden rounded-full px-1 ${prefs.collapsed ? 'nav-pill-collapsed' : ''}`}
          style={{ height: 'var(--hub-nav-pill-h, 56px)' }}
          data-nav-theme={prefs.theme}
          data-nav-collapsed={prefs.collapsed ? 'true' : 'false'}
        >
        {items.map(({ id, to, end, label }) => {
          const badge =
            id === 'messages' ? unreadMsgs : id === 'activity' ? unread : 0

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
              onClick={id === 'home' ? handleHomeClick : undefined}
              aria-expanded={id === 'home' ? !prefs.collapsed : undefined}
              className={`nav-item relative flex h-full min-w-0 flex-1 items-center justify-center ${id === 'home' ? 'nav-item-home' : ''}`}
            >
              {({ isActive }) => {
                const active =
                  id === 'messages'
                    ? onMessages || isActive
                    : id === 'video'
                      ? location.pathname.startsWith('/app/clips') || isActive
                      : id === 'music'
                        ? location.pathname.startsWith('/app/music') || isActive
                        : isActive
                return (
                  <>
                    <span className={`nav-icon-wrap ${active ? 'active' : ''}`}>
                      <NavGlyph kind={id} active={active} />
                    </span>
                    {badge > 0 && (
                      <span className="nav-unread-badge" aria-hidden>
                        {formatBadge(badge)}
                      </span>
                    )}
                  </>
                )
              }}
            </NavLink>
          )
        })}
        </div>
      </div>
    </nav>
  )
}
