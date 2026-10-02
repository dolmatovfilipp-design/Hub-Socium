import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PhoneShell } from './components/PhoneShell'
import { BottomNav } from './components/BottomNav'
import { ComposeSheet } from './components/ComposeSheet'
import { useStore } from './store/useStore'
import { apiGetChatPrefs, isApiMode } from './lib/api'
import { getLocalConsent152 } from './lib/consent'
import { Landing, InviteLanding } from './pages/Landing'
import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { PasswordReset } from './pages/PasswordReset'
import { Consent } from './pages/Consent'
import { LegalPrivacy, LegalTerms, LegalOffer } from './pages/Legal'
import { Feed } from './pages/Feed'
import { Explore } from './pages/Explore'
import { PostDetail } from './pages/PostDetail'
import { Messages } from './pages/Messages'
import { MessageRequests, HiddenWordsPrefs } from './pages/MessageRequests'
import { NewMessage } from './pages/NewMessage'
import { NewGroup } from './pages/NewGroup'
import { GroupSettings } from './pages/GroupSettings'
import { Chat } from './pages/Chat'
import { Activity } from './pages/Activity'
import { Profile } from './pages/Profile'
import { EditProfile } from './pages/EditProfile'
import { FollowList } from './pages/FollowList'
import { Settings } from './pages/Settings'
import { ModReports } from './pages/ModReports'
import { Clips } from './pages/Clips'
import { Music } from './pages/Music'
import { Channels } from './pages/Channels'
import { ChannelDetail } from './pages/ChannelDetail'
import { Meetups, MeetupDetail } from './pages/Meetups'
import { OfflineBadge } from './components/OfflineBadge'
import { OnboardingStories } from './components/OnboardingStories'
import { FollowSuggestions, shouldShowFollowNudge } from './components/FollowSuggestions'
import { hasSeenOnboarding } from './lib/onboarding'


import { applyAppTheme } from './lib/theme'
import { applyNavTheme, getVisibleNavItemIds, loadNavPrefs, NAV_CATALOG, type NavPrefs } from './lib/navPrefs'

function ThemeBootstrap({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = localStorage.getItem('hub-theme-pref') || localStorage.getItem('hub-theme') || 'dark'
    applyAppTheme(stored)
    applyNavTheme(loadNavPrefs())
    if (isApiMode()) {
      void apiGetChatPrefs()
        .then((p) => applyAppTheme(p.appearance || stored))
        .catch(() => {})
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => {
      const pref = localStorage.getItem('hub-theme-pref') || 'dark'
      if (pref === 'system') applyAppTheme('system')
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return children
}

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const bootstrapAuth = useStore((s) => s.bootstrapAuth)
  const authReady = useStore((s) => s.authReady)

  useEffect(() => {
    const unsub = useStore.persist.onFinishHydration(() => {
      void bootstrapAuth()
    })
    if (useStore.persist.hasHydrated()) {
      void bootstrapAuth()
    }
    return unsub
  }, [bootstrapAuth])

  if (!authReady) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-sm text-[#777]">
        {isApiMode() ? 'Подключение…' : 'Загрузка…'}
      </div>
    )
  }
  return <>{children}</>
}

function RequireAuth() {
  const uid = useStore((s) => s.currentUserId)
  const location = useLocation()
  if (!uid) {
    return <Navigate to="/" replace state={{ from: location }} />
  }
  return <Outlet />
}

/** After auth, before any /app/* content — 152-FZ consent gate. */
function RequireConsent() {
  const uid = useStore((s) => s.currentUserId)
  const consent152 = useStore((s) => s.consent152)
  const location = useLocation()
  const hasConsent = consent152 || getLocalConsent152()

  if (!uid) {
    return <Navigate to="/" replace state={{ from: location }} />
  }
  if (!hasConsent) {
    return <Navigate to="/consent" replace />
  }
  return <Outlet />
}

function GuestOnly() {
  const uid = useStore((s) => s.currentUserId)
  const consent152 = useStore((s) => s.consent152)
  if (uid) {
    if (!consent152 && !getLocalConsent152()) {
      return <Navigate to="/consent" replace />
    }
    return <Navigate to="/app" replace />
  }
  return <Outlet />
}

function ConsentRoute() {
  const uid = useStore((s) => s.currentUserId)
  const consent152 = useStore((s) => s.consent152)
  if (!uid) return <Navigate to="/" replace />
  if (consent152 || getLocalConsent152()) {
    return <Navigate to="/app" replace />
  }
  return <Consent />
}

function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [navPrefs, setNavPrefs] = useState<NavPrefs>(() => loadNavPrefs())
  const swipeStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<NavPrefs>).detail
      setNavPrefs(detail || loadNavPrefs())
    }
    window.addEventListener('hub-nav-prefs', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('hub-nav-prefs', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const navIds = getVisibleNavItemIds(navPrefs)
  const activeNavIndex = navIds.findIndex((id) => {
    if (id === 'home') return location.pathname === '/app'
    if (id === 'messages') return location.pathname === '/app/messages' || location.pathname.startsWith('/app/messages/')
    if (id === 'activity') return location.pathname.startsWith('/app/activity')
    if (id === 'profile') return location.pathname === '/app/profile' || location.pathname.startsWith('/app/profile/') || location.pathname.startsWith('/app/u/')
    if (id === 'search') return location.pathname.startsWith('/app/explore')
    if (id === 'video') return location.pathname.startsWith('/app/clips')
    if (id === 'music') return location.pathname.startsWith('/app/music')
    return false
  })

  const isCompose =
    location.pathname === '/app/compose' || location.pathname.startsWith('/app/compose/')
  const hideNav =
    location.pathname.startsWith('/app/messages/') ||
    isCompose ||
    location.pathname === '/app/profile/edit' ||
    /\/app\/profile\/[^/]+\/(followers|following)$/.test(location.pathname) ||
    location.pathname === '/app/settings' ||
    location.pathname.startsWith('/app/mod') ||
    location.pathname.startsWith('/app/p/') ||
    location.pathname.startsWith('/app/channels') ||
    location.pathname.startsWith('/app/meetups')


  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding())
  const [showFollowNudge, setShowFollowNudge] = useState(() => hasSeenOnboarding() && shouldShowFollowNudge())
  useEffect(() => {
    const onReplay = () => setShowOnboarding(true)
    window.addEventListener('hub:onboarding-replay', onReplay)
    return () => window.removeEventListener('hub:onboarding-replay', onReplay)
  }, [])

  const onShellTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (hideNav || activeNavIndex < 0 || event.touches.length !== 1) return
    const target = event.target as Element | null
    if (target?.closest('[data-feed-switcher]')) return
    const touch = event.touches[0]
    swipeStart.current = { x: touch.clientX, y: touch.clientY }
  }

  const onShellTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || hideNav || activeNavIndex < 0) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    const nextIndex = activeNavIndex + (dx < 0 ? 1 : -1)
    const nextId = navIds[nextIndex]
    if (nextId) navigate(NAV_CATALOG[nextId].to)
  }
  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onTouchStart={onShellTouchStart}
      onTouchEnd={onShellTouchEnd}
      onTouchCancel={() => { swipeStart.current = null }}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
      <OfflineBadge />
      {!hideNav && <BottomNav />}
      <OnboardingStories
        open={showOnboarding}
        onClose={() => {
          setShowOnboarding(false)
          if (shouldShowFollowNudge()) setShowFollowNudge(true)
        }}
      />
      <FollowSuggestions open={showFollowNudge} onClose={() => setShowFollowNudge(false)} />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeBootstrap>
      <PhoneShell>
        <AuthBootstrap>
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="/" element={<Landing />} />
              <Route path="/invite" element={<InviteLanding />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/reset" element={<PasswordReset />} />
            </Route>

            <Route path="/legal/privacy" element={<LegalPrivacy />} />
            <Route path="/legal/terms" element={<LegalTerms />} />
            <Route path="/legal/offer" element={<LegalOffer />} />

            <Route element={<RequireAuth />}>
              <Route path="/consent" element={<ConsentRoute />} />
              <Route element={<RequireConsent />}>
                <Route path="/app" element={<AppShell />}>
                  <Route index element={<Feed />} />
                  <Route path="explore" element={<Explore />} />
                  <Route path="p/:id" element={<PostDetail />} />
                  <Route path="drafts" element={<Navigate to="/app/settings" replace />} />
                  <Route path="messages" element={<Messages />} />
                  <Route path="search" element={<Navigate to="/app/explore" replace />} />
                  <Route path="messages/new" element={<NewMessage />} />
                  <Route path="messages/new-group" element={<NewGroup />} />
                  <Route path="messages/requests" element={<MessageRequests />} />
                  <Route path="messages/hidden-words" element={<HiddenWordsPrefs />} />
                  <Route path="messages/:id/settings" element={<GroupSettings />} />
                  <Route path="messages/:id" element={<Chat />} />
                  <Route path="activity" element={<Activity />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="profile/edit" element={<EditProfile />} />
                  <Route path="profile/:userId/:mode" element={<FollowList />} />
                  <Route path="profile/:userId" element={<Profile />} />
                  <Route path="u/:username" element={<Profile />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="mod/reports" element={<ModReports />} />
                  <Route path="clips" element={<Clips />} />
                  <Route path="music" element={<Music />} />
                  <Route path="video" element={<Navigate to="/app/clips" replace />} />
                  <Route path="channels" element={<Channels />} />
                  <Route path="channels/:id" element={<ChannelDetail />} />
                  <Route path="voice" element={<Navigate to="/app/messages" replace />} />
                  <Route path="voice/:id" element={<Navigate to="/app/messages" replace />} />
                  <Route path="meetups" element={<Meetups />} />
                  <Route path="meetups/:id" element={<MeetupDetail />} />
                  <Route path="nearby" element={<Navigate to="/app" replace />} />
                  <Route path="compose" element={<ComposeSheet />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthBootstrap>
      </PhoneShell>
    </ThemeBootstrap>
    </BrowserRouter>
  )
}
