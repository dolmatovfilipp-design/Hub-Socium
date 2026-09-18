import { NavLink, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import {
  IconHome,
  IconPlane,
  IconPlus,
  IconHeart,
  IconUser,
} from './Icons'

const items = [
  { to: '/app', end: true, label: 'Главная', kind: 'home' as const },
  { to: '/app/messages', end: false, label: 'Сообщения', kind: 'messages' as const },
  { to: '__compose__', end: false, label: 'Создать', kind: 'compose' as const },
  { to: '/app/activity', end: false, label: 'Действия', kind: 'activity' as const },
  { to: '/app/profile', end: false, label: 'Профиль', kind: 'profile' as const },
]

export function BottomNav() {
  const navigate = useNavigate()
  const activities = useStore((s) => s.activities)
  const messages = useStore((s) => s.messages)
  const uid = useStore((s) => s.currentUserId)

  const unread = useMemo(
    () => activities.reduce((n, a) => n + (a.read ? 0 : 1), 0),
    [activities]
  )
  const unreadMsgs = useMemo(
    () => messages.reduce((n, m) => n + (!m.read && m.senderId !== uid ? 1 : 0), 0),
    [messages, uid]
  )

  return (
    <nav
      className="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex justify-center"
      style={{
        paddingLeft: 'var(--hub-nav-inset-x)',
        paddingRight: 'var(--hub-nav-inset-x)',
        paddingBottom: 'calc(var(--hub-nav-inset-b) + var(--hub-safe-bottom))',
      }}
    >
      <div className="pointer-events-auto glass-pill flex h-14 w-full max-w-[400px] items-center justify-around rounded-full px-2">
        {items.map(({ to, end, label, kind }) => {
          if (kind === 'compose') {
            return (
              <button
                key={to}
                type="button"
                aria-label={label}
                onClick={() => navigate('/app/compose', { state: { from: 'nav' } })}
                className="pressable flex h-12 w-12 items-center justify-center text-white"
              >
                <IconPlus size={26} />
              </button>
            )
          }

          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className="relative flex h-12 w-12 items-center justify-center text-white"
            >
              {({ isActive }) => (
                <>
                  <span className={`nav-icon-wrap ${isActive ? 'active' : ''}`}>
                    {kind === 'home' && <IconHome size={24} filled={isActive} />}
                    {kind === 'messages' && <IconPlane size={23} filled={isActive} />}
                    {kind === 'activity' && <IconHeart size={24} filled={isActive} />}
                    {kind === 'profile' && <IconUser size={24} filled={isActive} />}
                  </span>
                  {kind === 'activity' && unread > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#ff3040]" />
                  )}
                  {kind === 'messages' && unreadMsgs > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#ff3040]" />
                  )}
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
