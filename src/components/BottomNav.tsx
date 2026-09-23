import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  IconHome,
  IconPlane,
  IconPlus,
  IconHeart,
  IconUser,
} from './Icons'
import { apiListActivity, apiListConversations, isApiMode } from '../lib/api'

function formatBadge(n: number): string {
  return n > 99 ? '99+' : String(n)
}

export function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const activities = useStore((s) => s.activities)
  const messages = useStore((s) => s.messages)
  const uid = useStore((s) => s.currentUserId)
  const api = isApiMode()

  const [apiUnreadMsgs, setApiUnreadMsgs] = useState(0)
  const [apiUnreadAct, setApiUnreadAct] = useState(0)

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

  const items = [
    { to: '/app', end: true, label: 'Главная', kind: 'home' as const },
    { to: '/app/messages', end: false, label: 'Сообщения', kind: 'messages' as const },
    { to: '__compose__', end: false, label: 'Создать', kind: 'compose' as const },
    { to: '/app/activity', end: false, label: 'Действия', kind: 'activity' as const },
    { to: '/app/profile', end: false, label: 'Профиль', kind: 'profile' as const },
  ]

  return (
    <nav
      className="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex justify-center"
      style={{
        paddingLeft: 'var(--hub-nav-inset-x)',
        paddingRight: 'var(--hub-nav-inset-x)',
        paddingBottom: 'calc(var(--hub-nav-inset-b) + var(--hub-safe-bottom))',
      }}
    >
      <div className="pointer-events-auto glass-pill flex h-[56px] w-full max-w-[400px] items-stretch justify-around overflow-hidden rounded-full px-1">
        {items.map(({ to, end, label, kind }) => {
          if (kind === 'compose') {
            return (
              <button
                key={to}
                type="button"
                aria-label={label}
                onClick={() => navigate('/app/compose', { state: { from: 'nav' } })}
                className="pressable flex h-full min-w-[56px] flex-1 items-center justify-center text-white"
              >
                <IconPlus size={26} strokeWidth={1.35} />
              </button>
            )
          }

          const badge =
            kind === 'messages' ? unreadMsgs : kind === 'activity' ? unread : 0

          return (
            <NavLink
              key={`${kind}-${to}`}
              to={to}
              end={end}
              aria-label={badge > 0 ? `${label}, ${badge}` : label}
              className="relative flex h-full min-w-0 flex-1 items-center justify-center"
            >
              {({ isActive }) => {
                const active = kind === 'messages' ? onMessages || isActive : isActive
                return (
                  <>
                    <span className={`nav-icon-wrap ${active ? 'active' : ''}`}>
                      {kind === 'home' && (
                        <IconHome size={24} filled={active} strokeWidth={1.35} />
                      )}
                      {kind === 'messages' && (
                        <IconPlane size={23} filled={active} strokeWidth={1.35} />
                      )}
                      {kind === 'activity' && (
                        <IconHeart size={24} filled={active} strokeWidth={1.35} />
                      )}
                      {kind === 'profile' && (
                        <IconUser size={24} filled={active} strokeWidth={1.35} />
                      )}
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
    </nav>
  )
}
