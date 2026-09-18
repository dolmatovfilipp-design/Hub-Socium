import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Bookmark, Bell, Shield, LogOut } from 'lucide-react'
import { useStore } from '../store/useStore'
import { PostCard } from '../components/PostCard'
import { useState, type ReactNode } from 'react'

export function Settings() {
  const navigate = useNavigate()
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const logout = useStore((s) => s.logout)
  const savedIds = useStore((s) => s.savedPostIds)
  const [section, setSection] = useState<'main' | 'saved' | 'notifications' | 'privacy'>('main')

  if (section === 'saved') {
    return (
      <SubPage title="Сохранённое" onBack={() => setSection('main')}>
        {savedIds.map((id) => (
          <PostCard key={id} postId={id} />
        ))}
        {!savedIds.length && (
          <p className="px-4 py-10 text-center text-hub-muted">Нет сохранённых</p>
        )}
      </SubPage>
    )
  }

  if (section === 'notifications') {
    return (
      <SubPage title="Уведомления" onBack={() => setSection('main')}>
        <div className="space-y-1 px-2 py-2">
          <Toggle
            label="Лайки"
            checked={settings.notificationsLikes}
            onChange={(v) => updateSettings({ notificationsLikes: v })}
          />
          <Toggle
            label="Подписки"
            checked={settings.notificationsFollows}
            onChange={(v) => updateSettings({ notificationsFollows: v })}
          />
          <Toggle
            label="Сообщения"
            checked={settings.notificationsMessages}
            onChange={(v) => updateSettings({ notificationsMessages: v })}
          />
          <Toggle
            label="Упоминания"
            checked={settings.notificationsMentions}
            onChange={(v) => updateSettings({ notificationsMentions: v })}
          />
        </div>
      </SubPage>
    )
  }

  if (section === 'privacy') {
    return (
      <SubPage title="Конфиденциальность" onBack={() => setSection('main')}>
        <div className="space-y-1 px-2 py-2">
          <Toggle
            label="Закрытый аккаунт"
            checked={settings.privacyPrivateAccount}
            onChange={(v) => updateSettings({ privacyPrivateAccount: v })}
          />
          <Toggle
            label="Показывать активность"
            checked={settings.privacyShowActivity}
            onChange={(v) => updateSettings({ privacyShowActivity: v })}
          />
          <Toggle
            label="Разрешить сообщения"
            checked={settings.privacyAllowMessages}
            onChange={(v) => updateSettings({ privacyAllowMessages: v })}
          />
        </div>
      </SubPage>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top glass-strong flex shrink-0 items-center gap-2 border-b border-white/5 px-2 pb-3 pt-2">
        <Link
          to="/app/profile"
          className="flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold text-hub-text">Настройки</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-3">
        <MenuItem icon={Bookmark} label="Сохранённое" onClick={() => setSection('saved')} />
        <MenuItem icon={Bell} label="Уведомления" onClick={() => setSection('notifications')} />
        <MenuItem icon={Shield} label="Конфиденциальность" onClick={() => setSection('privacy')} />
        <button
          type="button"
          onClick={() => {
            void logout().then(() => navigate('/', { replace: true }))
          }}
          className="mt-4 flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-red-400/90 active:bg-white/[0.03]"
        >
          <LogOut className="h-5 w-5" />
          <span className="font-medium">Выйти</span>
        </button>
      </div>
    </div>
  )
}

function SubPage({
  title,
  onBack,
  children,
}: {
  title: string
  onBack: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="safe-top glass-strong flex shrink-0 items-center gap-2 border-b border-white/5 px-2 pb-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold text-hub-text">{title}</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bookmark
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left active:bg-white/[0.03]"
    >
      <Icon className="h-5 w-5 text-hub-muted" />
      <span className="font-medium text-hub-text">{label}</span>
    </button>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between rounded-2xl px-3 py-3.5">
      <span className="text-hub-text">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition ${
          checked ? 'bg-hub-silver/80' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-hub-bg shadow transition ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  )
}
