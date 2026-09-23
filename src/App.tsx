import { useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { PhoneShell } from './components/PhoneShell'
import { BottomNav } from './components/BottomNav'
import { ComposeSheet } from './components/ComposeSheet'
import { useStore } from './store/useStore'
import { isApiMode } from './lib/api'
import { getLocalConsent152 } from './lib/consent'
import { Landing } from './pages/Landing'
import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { PasswordReset } from './pages/PasswordReset'
import { Consent } from './pages/Consent'
import { LegalPrivacy, LegalTerms } from './pages/Legal'
import { Feed } from './pages/Feed'
import { Explore } from './pages/Explore'
import { PostDetail } from './pages/PostDetail'
import { Drafts } from './pages/Drafts'
import { Messages } from './pages/Messages'
import { NewMessage } from './pages/NewMessage'
import { Chat } from './pages/Chat'
import { Activity } from './pages/Activity'
import { Profile } from './pages/Profile'
import { EditProfile } from './pages/EditProfile'
import { FollowList } from './pages/FollowList'
import { Settings } from './pages/Settings'
import { ModReports } from './pages/ModReports'
import { Clips } from './pages/Clips'
import { Channels } from './pages/Channels'
import { ChannelDetail } from './pages/ChannelDetail'
import { VoiceRooms, VoiceRoomDetail } from './pages/VoiceRooms'
import { Meetups, MeetupDetail } from './pages/Meetups'
import { Nearby } from './pages/Nearby'
import { OfflineBadge } from './components/OfflineBadge'

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
    location.pathname === '/app/drafts' ||
    location.pathname.startsWith('/app/channels') ||
    location.pathname === '/app/clips' ||
    location.pathname.startsWith('/app/voice') ||
    location.pathname.startsWith('/app/meetups') ||
    location.pathname === '/app/nearby'

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
      <OfflineBadge />
      {!hideNav && <BottomNav />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <PhoneShell>
        <AuthBootstrap>
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="/" element={<Landing />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/reset" element={<PasswordReset />} />
            </Route>

            <Route path="/legal/privacy" element={<LegalPrivacy />} />
            <Route path="/legal/terms" element={<LegalTerms />} />

            <Route element={<RequireAuth />}>
              <Route path="/consent" element={<ConsentRoute />} />
              <Route element={<RequireConsent />}>
                <Route path="/app" element={<AppShell />}>
                  <Route index element={<Feed />} />
                  <Route path="explore" element={<Explore />} />
                  <Route path="p/:id" element={<PostDetail />} />
                  <Route path="drafts" element={<Drafts />} />
                  <Route path="messages" element={<Messages />} />
                  <Route path="search" element={<Navigate to="/app/explore" replace />} />
                  <Route path="messages/new" element={<NewMessage />} />
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
                  <Route path="channels" element={<Channels />} />
                  <Route path="channels/:id" element={<ChannelDetail />} />
                  <Route path="voice" element={<VoiceRooms />} />
                  <Route path="voice/:id" element={<VoiceRoomDetail />} />
                  <Route path="meetups" element={<Meetups />} />
                  <Route path="meetups/:id" element={<MeetupDetail />} />
                  <Route path="nearby" element={<Nearby />} />
                  <Route path="compose" element={<ComposeSheet />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthBootstrap>
      </PhoneShell>
    </BrowserRouter>
  )
}
