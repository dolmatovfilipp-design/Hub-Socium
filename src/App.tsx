import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type TouchEvent } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PhoneShell } from './components/PhoneShell'
import { BottomNav } from './components/BottomNav'
import { useStore } from './store/useStore'
import { apiGetChatPrefs, apiHeartbeat, getAccessToken, isApiMode } from './lib/api'
import { chatWsHold } from './lib/chatWs'
import { getLocalConsent152 } from './lib/consent'
import { OfflineBadge } from './components/OfflineBadge'
import { OnboardingStories } from './components/OnboardingStories'
import { FollowSuggestions, shouldShowFollowNudge } from './components/FollowSuggestions'
import { hasSeenOnboarding } from './lib/onboarding'
import { applyAppTheme } from './lib/theme'
import { applyNavTheme, getVisibleNavItemIds, loadNavPrefs, NAV_CATALOG, type NavPrefs } from './lib/navPrefs'
import { prefetchAppRoutes, routeLoaders } from './lib/routeWarmup'
import { TabVisibleContext } from './lib/tabVisible'

function lazyPage<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((mod) => ({ default: mod[name] as ComponentType<any> })))
}

const Landing = lazyPage(() => import('./pages/Landing'), 'Landing')
const InviteLanding = lazyPage(() => import('./pages/Landing'), 'InviteLanding')
const Welcome = lazyPage(() => import('./pages/Welcome'), 'Welcome')
const Login = lazyPage(() => import('./pages/Login'), 'Login')
const Register = lazyPage(() => import('./pages/Register'), 'Register')
const EmailVerify = lazyPage(() => import('./pages/Register'), 'EmailVerify')
const PasswordReset = lazyPage(() => import('./pages/PasswordReset'), 'PasswordReset')
const Consent = lazyPage(() => import('./pages/Consent'), 'Consent')
const LegalPrivacy = lazyPage(() => import('./pages/Legal'), 'LegalPrivacy')
const LegalTerms = lazyPage(() => import('./pages/Legal'), 'LegalTerms')
const LegalOffer = lazyPage(() => import('./pages/Legal'), 'LegalOffer')
const Feed = lazyPage(routeLoaders.feed, 'Feed')
const Explore = lazyPage(routeLoaders.explore, 'Explore')
const PostDetail = lazyPage(() => import('./pages/PostDetail'), 'PostDetail')
const Messages = lazyPage(routeLoaders.messages, 'Messages')
const MessageRequests = lazyPage(() => import('./pages/MessageRequests'), 'MessageRequests')
const HiddenWordsPrefs = lazyPage(() => import('./pages/MessageRequests'), 'HiddenWordsPrefs')
const NewMessage = lazyPage(routeLoaders.newMessage, 'NewMessage')
const NewGroup = lazyPage(() => import('./pages/NewGroup'), 'NewGroup')
const GroupSettings = lazyPage(() => import('./pages/GroupSettings'), 'GroupSettings')
const GroupJoin = lazyPage(() => import('./pages/GroupJoin'), 'GroupJoin')
const Chat = lazyPage(routeLoaders.chat, 'Chat')
const Activity = lazyPage(routeLoaders.activity, 'Activity')
const Profile = lazyPage(routeLoaders.profile, 'Profile')
const EditProfile = lazyPage(() => import('./pages/EditProfile'), 'EditProfile')
const FollowList = lazyPage(() => import('./pages/FollowList'), 'FollowList')
const Settings = lazyPage(routeLoaders.settings, 'Settings')
const ModReports = lazyPage(() => import('./pages/ModReports'), 'ModReports')
const Drafts = lazyPage(() => import('./pages/Drafts'), 'Drafts')
const VoiceRooms = lazyPage(() => import('./pages/VoiceRooms'), 'VoiceRooms')
const VoiceRoomDetail = lazyPage(() => import('./pages/VoiceRooms'), 'VoiceRoomDetail')
const Nearby = lazyPage(() => import('./pages/Nearby'), 'Nearby')
const Channels = lazyPage(() => import('./pages/Channels'), 'Channels')
const ChannelDetail = lazyPage(() => import('./pages/ChannelDetail'), 'ChannelDetail')
const SellerCabinet = lazyPage(() => import('./pages/SellerCabinet'), 'SellerCabinet')
const ComposeSheet = lazyPage(routeLoaders.compose, 'ComposeSheet')
const VoiceHost = lazyPage(() => import('./components/VoiceHost'), 'VoiceHost')
const CallHost = lazyPage(() => import('./components/CallHost'), 'CallHost')

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-black text-sm text-[#777]">Загрузка…</div>
  )
}

const TAB_PAGES = {
  feed: Feed,
  messages: Messages,
  activity: Activity,
  profile: Profile,
  explore: Explore,
} as const

type TabId = keyof typeof TAB_PAGES

const PRIMARY_TABS: TabId[] = ['feed', 'messages', 'activity', 'profile']

function tabIdFromPath(pathname: string): TabId | null {
  if (pathname === '/app') return 'feed'
  if (pathname === '/app/messages') return 'messages'
  if (pathname === '/app/activity') return 'activity'
  if (pathname === '/app/profile') return 'profile'
  if (pathname === '/app/explore') return 'explore'
  return null
}

function gestureBlocked(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return !!target.closest(
    'a, button, input, textarea, select, label, [role="button"], [role="tab"], [data-feed-switcher], [data-no-nav-swipe]',
  )
}

function CachedTabs({ active }: { active: TabId | null }) {
  const [mounted, setMounted] = useState<TabId[]>([])
  useEffect(() => {
    prefetchAppRoutes()
    const timer = window.setTimeout(() => {
      setMounted((prev) => {
        const next = new Set(prev)
        for (const id of PRIMARY_TABS) next.add(id)
        return [...next]
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!active) return
    setMounted((prev) => (prev.includes(active) ? prev : [...prev, active]))
  }, [active])
  return (
    <>
      {mounted.map((id) => {
        const Page = TAB_PAGES[id]
        const shown = active === id
        return (
          <div
            key={id}
            className={shown ? 'absolute inset-0' : 'pointer-events-none hidden'}
            inert={!shown ? true : undefined}
            aria-hidden={shown ? undefined : true}
          >
            <Suspense fallback={<PageFallback />}>
              <TabVisibleContext.Provider value={shown}>
                <Page />
              </TabVisibleContext.Provider>
            </Suspense>
          </div>
        )
      })}
    </>
  )
}


function ThemeBootstrap({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = localStorage.getItem('hub-theme-pref') || localStorage.getItem('hub-theme') || 'dark'
    applyAppTheme(stored)
    applyNavTheme(loadNavPrefs())
    if (isApiMode() && getAccessToken()) {
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
    try {
      if (sessionStorage.getItem('hub_pending_email_verify') === '1') {
        return <Navigate to="/verify-email" replace />
      }
    } catch {
      /* ignore */
    }
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
    location.pathname.startsWith('/app/settings/') ||
    location.pathname.startsWith('/app/mod') ||
    location.pathname.startsWith('/app/p/') ||
    location.pathname.startsWith('/app/channels')


  const shellUid = useStore((s) => s.currentUserId)
  useEffect(() => {
    if (!shellUid || !isApiMode() || !getAccessToken()) return
    const beat = () => {
      if (!getAccessToken()) return
      void apiHeartbeat().catch(() => {})
    }
    beat()
    const timer = window.setInterval(beat, 45_000)
    return () => window.clearInterval(timer)
  }, [shellUid])

  useEffect(() => {
    if (!shellUid || !isApiMode() || !getAccessToken()) return
    return chatWsHold()
  }, [shellUid])

  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding())
  const [showFollowNudge, setShowFollowNudge] = useState(() => hasSeenOnboarding() && shouldShowFollowNudge())
  useEffect(() => {
    const onReplay = () => setShowOnboarding(true)
    window.addEventListener('hub:onboarding-replay', onReplay)
    return () => window.removeEventListener('hub:onboarding-replay', onReplay)
  }, [])

  const emitNavDrag = (dx: number, phase: 'move' | 'end') => {
    window.dispatchEvent(new CustomEvent('hub:nav-drag', { detail: { dx, phase } }))
  }

  const onShellTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (hideNav || activeNavIndex < 0 || event.touches.length !== 1) return
    if (gestureBlocked(event.target)) return
    const touch = event.touches[0]
    swipeStart.current = { x: touch.clientX, y: touch.clientY }
  }

  const onShellTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    if (!start || hideNav || activeNavIndex < 0 || event.touches.length !== 1) return
    const touch = event.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
    if (Math.abs(dy) > Math.abs(dx)) return
    emitNavDrag(dx, 'move')
  }

  const onShellTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || hideNav || activeNavIndex < 0) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    emitNavDrag(0, 'end')
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    const nextIndex = activeNavIndex + (dx < 0 ? 1 : -1)
    const nextId = navIds[nextIndex]
    if (nextId) navigate(NAV_CATALOG[nextId].to)
  }
  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onTouchStart={onShellTouchStart}
      onTouchMove={onShellTouchMove}
      onTouchEnd={onShellTouchEnd}
      onTouchCancel={() => {
        swipeStart.current = null
        emitNavDrag(0, 'end')
      }}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <CachedTabs active={tabIdFromPath(location.pathname)} />
        {tabIdFromPath(location.pathname) ? null : (
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        )}
      </div>
      <Suspense fallback={null}>
        <CallHost />
      </Suspense>
      <OfflineBadge />
      <Suspense fallback={null}>
        <VoiceHost navVisible={!hideNav} />
      </Suspense>
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
          <Suspense fallback={<PageFallback />}>
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
              <Route path="/verify-email" element={<EmailVerify />} />
              <Route path="/consent" element={<ConsentRoute />} />
              <Route element={<RequireConsent />}>
                <Route path="/app" element={<AppShell />}>
                  <Route index element={null} />
                  <Route path="explore" element={null} />
                  <Route path="p/:id" element={<PostDetail />} />
                  <Route path="drafts" element={<Drafts />} />
                  <Route path="messages" element={null} />
                  <Route path="search" element={<Navigate to="/app/explore" replace />} />
                  <Route path="messages/new" element={<NewMessage />} />
                  <Route path="messages/new-group" element={<NewGroup />} />
                  <Route path="join/:token" element={<GroupJoin />} />
                  <Route path="messages/requests" element={<MessageRequests />} />
                  <Route path="messages/hidden-words" element={<HiddenWordsPrefs />} />
                  <Route path="messages/:id/settings" element={<GroupSettings />} />
                  <Route path="messages/:id" element={<Chat />} />
                  <Route path="activity" element={null} />
                  <Route path="business" element={<SellerCabinet />} />
                  <Route path="profile" element={null} />
                  <Route path="profile/edit" element={<EditProfile />} />
                  <Route path="profile/:userId/:mode" element={<FollowList />} />
                  <Route path="profile/:userId" element={<Profile />} />
                  <Route path="u/:username" element={<Profile />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="settings/:section" element={<Settings />} />
                  <Route path="mod/reports" element={<ModReports />} />
                  <Route path="clips" element={<Navigate to="/app" replace />} />
                  <Route path="music" element={<Navigate to="/app" replace />} />
                  <Route path="video" element={<Navigate to="/app" replace />} />
                  <Route path="channels" element={<Channels />} />
                  <Route path="channels/:id" element={<ChannelDetail />} />
                  <Route path="voice" element={<VoiceRooms />} />
                  <Route path="voice/:id" element={<VoiceRoomDetail />} />
                  <Route path="nearby" element={<Nearby />} />
                  <Route path="compose" element={<ComposeSheet />} />
                  <Route path="*" element={<Navigate to="/app" replace />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </AuthBootstrap>
      </PhoneShell>
    </ThemeBootstrap>
    </BrowserRouter>
  )
}
