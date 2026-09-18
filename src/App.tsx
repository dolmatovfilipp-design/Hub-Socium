import { useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { PhoneShell } from './components/PhoneShell'
import { BottomNav } from './components/BottomNav'
import { ComposeSheet } from './components/ComposeSheet'
import { useStore } from './store/useStore'
import { isApiMode } from './lib/api'
import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { PasswordReset } from './pages/PasswordReset'
import { Feed } from './pages/Feed'
import { Messages } from './pages/Messages'
import { Chat } from './pages/Chat'
import { Activity } from './pages/Activity'
import { Profile } from './pages/Profile'
import { EditProfile } from './pages/EditProfile'
import { Settings } from './pages/Settings'

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const bootstrapAuth = useStore((s) => s.bootstrapAuth)
  const authReady = useStore((s) => s.authReady)

  useEffect(() => {
    // Fallback if persist finished before subscribe, or local mode
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

function GuestOnly() {
  const uid = useStore((s) => s.currentUserId)
  if (uid) return <Navigate to="/app" replace />
  return <Outlet />
}

function AppShell() {
  const location = useLocation()
  const isCompose =
    location.pathname === '/app/compose' || location.pathname.startsWith('/app/compose/')
  const hideNav =
    location.pathname.startsWith('/app/messages/') ||
    isCompose ||
    location.pathname === '/app/profile/edit' ||
    location.pathname === '/app/settings'

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
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
              <Route path="/" element={<Welcome />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/reset" element={<PasswordReset />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route path="/app" element={<AppShell />}>
                <Route index element={<Feed />} />
                <Route path="messages" element={<Messages />} />
                <Route path="messages/:id" element={<Chat />} />
                <Route path="activity" element={<Activity />} />
                <Route path="profile" element={<Profile />} />
                <Route path="profile/edit" element={<EditProfile />} />
                <Route path="profile/:userId" element={<Profile />} />
                <Route path="settings" element={<Settings />} />
                <Route path="compose" element={<ComposeSheet />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthBootstrap>
      </PhoneShell>
    </BrowserRouter>
  )
}
