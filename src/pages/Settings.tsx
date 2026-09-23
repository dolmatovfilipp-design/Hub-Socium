import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { PostCard } from '../components/PostCard'
import { Avatar } from '../components/Avatar'
import { useEffect, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { useNavMotion } from '../components/NavMotion'
import {
  apiSubscribePush,
  apiListBookmarks,
  apiListMyLikes,
  apiUnblock,
  apiUnsubscribePush,
  apiGetChatPrefs,
  apiUpdateChatPrefs,
  apiListCloseFriends,
  apiRemoveCloseFriend,
  apiGetNotifPrefs,
  apiUpdateNotifPrefs,
  isApiMode,
} from '../lib/api'
import {
  IconBell,
  IconBlock,
  IconBookmark,
  IconChevron,
  IconHeart,
  IconHelp,
  IconInfo,
  IconLock,
  IconPlane,
} from '../components/Icons'

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number; filled?: boolean }>

type Section =
  | 'main'
  | 'saved'
  | 'likes'
  | 'notifications'
  | 'privacy'
  | 'help'
  | 'info'
  | 'blocks'
  | 'following'
  | 'appearance'
  | 'close_friends'

export function Settings() {
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('push')
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const logout = useStore((s) => s.logout)
  const savedIdsLocal = useStore((s) => s.savedPostIds)
  const [apiSavedIds, setApiSavedIds] = useState<string[] | null>(null)
  const [apiLikedIds, setApiLikedIds] = useState<string[] | null>(null)
  const savedIds = apiSavedIds ?? savedIdsLocal
  const posts = useStore((s) => s.posts)
  const uid = useStore((s) => s.currentUserId)
  const isAdmin = useStore((s) => {
    const u = s.users.find((x) => x.id === s.currentUserId)
    return !!u?.isAdmin
  })
  const users = useStore((s) => s.users)
  const blockedAuthorIds = useStore((s) => s.blockedAuthorIds)
  const followingIds = useStore((s) => s.followingIds)
  const showToast = useStore((s) => s.showToast)
  const [section, setSection] = useState<Section>('main')
  const [pauseAll, setPauseAll] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushHint, setPushHint] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const [unblockBusy, setUnblockBusy] = useState<string | null>(null)
  const [chatThemes, setChatThemes] = useState<{ id: string; name: string; gradient: string[] }[]>([])
  const [themeId, setThemeId] = useState('default')
  const [appearance, setAppearance] = useState('dark')
  const [closeFriends, setCloseFriends] = useState<{ id: string; username: string; display_name: string }[]>([])
  const [notifPrefs, setNotifPrefs] = useState<any>({
    likes: true, comments: true, follows: true, messages: true, mentions: true, digest_hours: 0,
  })

  const likedIdsLocal = useMemo(() => {
    if (!uid) return [] as string[]
    return posts.filter((p) => p.likes.includes(uid)).map((p) => p.id)
  }, [posts, uid])
  const likedIds = apiLikedIds ?? likedIdsLocal

  useEffect(() => {
    if (!isApiMode() || (section !== 'saved' && section !== 'likes')) return
    let cancelled = false
    void (async () => {
      try {
        if (section === 'saved') {
          const data = await apiListBookmarks()
          if (cancelled) return
          const items = data.items ?? []
          useStore.setState((s) => {
            const ids = new Set(items.map((i) => i.id))
            const keep = s.posts.filter((p) => !ids.has(p.id))
            const mapped = items.map((item) => ({
              id: item.id,
              authorId: item.author_id,
              text: item.body,
              image: item.image_url || undefined,
              createdAt: item.created_at,
              likes: [],
              reposts: [],
              replies: [],
            }))
            return { posts: [...mapped, ...keep] }
          })
          setApiSavedIds(items.map((i) => i.id))
        } else {
          const data = await apiListMyLikes()
          if (cancelled) return
          const items = data.items ?? []
          useStore.setState((s) => {
            const ids = new Set(items.map((i) => i.id))
            const keep = s.posts.filter((p) => !ids.has(p.id))
            const mapped = items.map((item) => ({
              id: item.id,
              authorId: item.author_id,
              text: item.body,
              image: item.image_url || undefined,
              createdAt: item.created_at,
              likes: uid ? [uid] : [],
              reposts: [],
              replies: [],
            }))
            return { posts: [...mapped, ...keep] }
          })
          setApiLikedIds(items.map((i) => i.id))
        }
      } catch {
        /* keep local */
      }
    })()
    return () => { cancelled = true }
  }, [section, uid])

  const blockedUsers = useMemo(
    () =>
      blockedAuthorIds.map((id) => users.find((u) => u.id === id)).filter(Boolean) as typeof users,
    [blockedAuthorIds, users],
  )

  const followingUsers = useMemo(
    () => followingIds.map((id) => users.find((u) => u.id === id)).filter(Boolean) as typeof users,
    [followingIds, users],
  )

  const unblock = async (authorId: string) => {
    if (unblockBusy) return
    setUnblockBusy(authorId)
    try {
      if (isApiMode()) {
        await apiUnblock(authorId)
      }
      useStore.setState((s) => ({
        blockedAuthorIds: s.blockedAuthorIds.filter((id) => id !== authorId),
      }))
      showToast('Разблокировано')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось разблокировать')
    } finally {
      setUnblockBusy(null)
    }
  }

  if (section === 'saved') {
    return (
      <SubPage title="Сохранено" onBack={() => setSection('main')}>
        {savedIds.map((id) => (
          <PostCard key={id} postId={id} />
        ))}
        {!savedIds.length && (
          <p className="px-4 py-10 text-center text-[15px] text-[#777]">Нет сохранённых</p>
        )}
      </SubPage>
    )
  }

  if (section === 'likes') {
    return (
      <SubPage title="Нравится" onBack={() => setSection('main')}>
        {likedIds.map((id) => (
          <PostCard key={id} postId={id} />
        ))}
        {!likedIds.length && (
          <p className="px-4 py-10 text-center text-[15px] text-[#777]">Пока нет отметок</p>
        )}
      </SubPage>
    )
  }

  const togglePush = async (next: boolean) => {
    if (pushBusy) return
    setPushBusy(true)
    setPushHint('')
    try {
      if (!next) {
        // Best-effort unsubscribe current endpoint if we have one stored.
        const endpoint = sessionStorage.getItem('hub_push_endpoint')
        if (endpoint && isApiMode()) {
          try {
            await apiUnsubscribePush(endpoint)
          } catch {
            /* ignore */
          }
        }
        sessionStorage.removeItem('hub_push_endpoint')
        setPushEnabled(false)
        setPushHint('Push выключен')
        return
      }
      const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
      if (!vapid || !String(vapid).trim()) {
        setPushHint('нужен VAPID')
        setPushEnabled(false)
        return
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        setPushHint('Браузер не поддерживает Web Push')
        setPushEnabled(false)
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setPushHint('Разрешение на уведомления не выдано')
        setPushEnabled(false)
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(String(vapid).trim()) as BufferSource,
      })
      const json = sub.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setPushHint('Не удалось получить subscription')
        setPushEnabled(false)
        return
      }
      if (isApiMode()) {
        await apiSubscribePush({
          endpoint: json.endpoint,
          expirationTime: json.expirationTime ?? null,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        })
      }
      sessionStorage.setItem('hub_push_endpoint', json.endpoint)
      setPushEnabled(true)
      setPushHint('Подписка сохранена (scaffold)')
    } catch (e) {
      setPushHint(e instanceof Error ? e.message : 'Ошибка push')
      setPushEnabled(false)
    } finally {
      setPushBusy(false)
    }
  }

  if (section === 'notifications') {
    return (
      <SubPage title="Уведомления" onBack={() => setSection('main')}>
        <div className="px-4 pt-2 pb-8">
          <h2 className="pb-1 pt-1 text-[16px] font-bold text-white">Push</h2>
          <ToggleRow label="Push" checked={pushEnabled} onChange={(v) => { void togglePush(v) }} />
          {pushHint ? <p className="pt-2 text-[13px] text-[#777]">{pushHint}</p> : null}
          <ToggleRow label="Приостановить все" checked={pauseAll} onChange={setPauseAll} />
          <h2 className="pb-1 pt-5 text-[16px] font-bold text-white">Типы</h2>
          {([
            ['likes', 'Лайки'],
            ['comments', 'Комментарии'],
            ['follows', 'Подписки'],
            ['messages', 'Сообщения'],
            ['mentions', 'Упоминания'],
          ] as const).map(([key, label]) => (
            <ToggleRow
              key={key}
              label={label}
              checked={!!notifPrefs[key]}
              onChange={(v) => {
                const next = { ...notifPrefs, [key]: v }
                setNotifPrefs(next)
                if (isApiMode()) void apiUpdateNotifPrefs({ [key]: v }).then(() => showToast('Сохранено'))
              }}
            />
          ))}
          <h2 className="pb-1 pt-5 text-[16px] font-bold text-white">Дайджест</h2>
          <p className="pb-2 text-[13px] text-[#777]">Сводка раз в N часов (0 = выкл)</p>
          <div className="flex flex-wrap gap-2">
            {[0, 6, 12, 24].map((h) => (
              <button key={h} type="button"
                className={`rounded-full px-3 py-1.5 text-[13px] ${notifPrefs.digest_hours===h?'bg-white text-black':'bg-white/10 text-white'}`}
                onClick={() => {
                  const next = { ...notifPrefs, digest_hours: h }
                  setNotifPrefs(next)
                  if (isApiMode()) void apiUpdateNotifPrefs({ digest_hours: h }).then(() => showToast('Сохранено'))
                }}>{h === 0 ? 'Выкл' : `каждые ${h} ч`}</button>
            ))}
          </div>
          <h2 className="pb-1 pt-5 text-[16px] font-bold text-white">Тихие часы</h2>
          <p className="text-[13px] text-[#777]">Часы начала/конца (0–23). Пусто = без ограничений.</p>
          <div className="mt-2 flex gap-2">
            <input type="number" min={0} max={23} placeholder="с"
              className="w-20 rounded-xl bg-[#1c1c1e] px-3 py-2 text-white"
              value={notifPrefs.quiet_start ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                setNotifPrefs({ ...notifPrefs, quiet_start: v })
              }}
              onBlur={() => {
                if (isApiMode()) void apiUpdateNotifPrefs({ quiet_start: notifPrefs.quiet_start }).then(() => showToast('Сохранено'))
              }}
            />
            <input type="number" min={0} max={23} placeholder="до"
              className="w-20 rounded-xl bg-[#1c1c1e] px-3 py-2 text-white"
              value={notifPrefs.quiet_end ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                setNotifPrefs({ ...notifPrefs, quiet_end: v })
              }}
              onBlur={() => {
                if (isApiMode()) void apiUpdateNotifPrefs({ quiet_end: notifPrefs.quiet_end }).then(() => showToast('Сохранено'))
              }}
            />
          </div>
        </div>
      </SubPage>
    )
  }

  if (section === 'blocks') {
    return (
      <SubPage title="Заблокированные" onBack={() => setSection('privacy')}>
        <div className="px-4 pb-8 pt-1">
          {blockedUsers.map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-3">
              <Avatar name={u.name} id={u.id} src={u.avatar} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-white">{u.username}</p>
                <p className="truncate text-[13px] text-[#777]">{u.name}</p>
              </div>
              <button
                type="button"
                disabled={unblockBusy === u.id}
                onClick={() => void unblock(u.id)}
                className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[13px] text-white active:opacity-70 disabled:opacity-50"
              >
                Разблок.
              </button>
            </div>
          ))}
          {blockedAuthorIds.length > 0 && blockedUsers.length < blockedAuthorIds.length && (
            <p className="py-2 text-[13px] text-[#777]">
              Ещё {blockedAuthorIds.length - blockedUsers.length} без профиля в кэше
            </p>
          )}
          {!blockedAuthorIds.length && (
            <p className="px-2 py-10 text-center text-[15px] text-[#777]">Пока пусто</p>
          )}
        </div>
      </SubPage>
    )
  }

  if (section === 'following') {
    return (
      <SubPage title="Подписки" onBack={() => setSection('privacy')}>
        <div className="px-4 pb-8 pt-1">
          {followingUsers.map((u) => (
            <button
              key={u.id}
              type="button"
              className="flex w-full items-center gap-3 py-3 text-left active:bg-white/[0.03]"
              onClick={() => navigate(`/app/profile/${u.id}`)}
            >
              <Avatar name={u.name} id={u.id} src={u.avatar} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-white">{u.username}</p>
                <p className="truncate text-[13px] text-[#777]">{u.name}</p>
              </div>
              <IconChevron size={18} className="shrink-0 text-[#777]" />
            </button>
          ))}
          {!followingIds.length && (
            <p className="px-2 py-10 text-center text-[15px] text-[#777]">Пока пусто</p>
          )}
        </div>
      </SubPage>
    )
  }

  if (section === 'privacy') {
    const privacyLabel = settings.privacyPrivateAccount ? 'Закрытый' : 'Общедоступный'
    return (
      <SubPage title="Конфиденциальность" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-1">
          <IconChevronRow
            icon={IconLock}
            label="Конфиденциальность профиля"
            trailing={privacyLabel}
            onClick={() =>
              updateSettings({ privacyPrivateAccount: !settings.privacyPrivateAccount })
            }
          />
          <IconChevronRow
            icon={IconPlane}
            label="Сообщения"
            onClick={() => navigate('/app/messages')}
          />
          <IconChevronRow
            icon={IconBlock}
            label="Заблокированные профили"
            onClick={() => setSection('blocks')}
          />
          <IconChevronRow
            icon={IconHeart}
            label="Профили, на которые вы подписаны"
            onClick={() => setSection('following')}
          />
        </div>
      </SubPage>
    )
  }

  if (section === 'help') {
    return (
      <SubPage title="Справка" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-1">
          <ChevronRow
            label="Конфиденциальность и безопасность"
            onClick={() => navigate('/legal/privacy')}
          />
          <p className="pt-4 text-[13px] leading-snug text-[#777]">
            Справочный центр и запросы поддержки недоступны в beta.
          </p>
        </div>
      </SubPage>
    )
  }

  if (section === 'info') {
    return (
      <SubPage title="Информация" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-1">
          <ChevronRow
            label="Политика конфиденциальности Hub"
            onClick={() => navigate('/legal/privacy')}
          />
          <ChevronRow
            label="Условия использования Hub"
            onClick={() => navigate('/legal/terms')}
          />
          <ChevronRow
            label="Дополнительная политика конфиденциальности Hub"
            onClick={() => navigate('/legal/privacy')}
          />
        </div>
      </SubPage>
    )
  }

    if (section === 'appearance') {
    return (
      <SubPage title="Оформление" onBack={() => setSection('main')}>
        <p className="mb-3 text-[13px] text-[#8e8e93]">Тема приложения и градиент чатов</p>
        <div className="mb-4 flex gap-2">
          {(['dark', 'light'] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={`rounded-full px-3 py-1.5 text-[13px] ${appearance === a ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              onClick={() => {
                setAppearance(a)
                document.documentElement.dataset.theme = a
                document.documentElement.classList.toggle('light', a === 'light')
                if (isApiMode()) void apiUpdateChatPrefs(themeId, a).then(() => showToast('Сохранено'))
              }}
            >
              {a === 'dark' ? 'Тёмная' : 'Светлая'}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {(chatThemes.length ? chatThemes : [
            { id: 'default', name: 'Классика', gradient: ['#000', '#1c1c1e'] },
            { id: 'ocean', name: 'Океан', gradient: ['#0a1628', '#1a4a6e'] },
            { id: 'sunset', name: 'Закат', gradient: ['#1a0a0a', '#6e2a1a'] },
            { id: 'forest', name: 'Лес', gradient: ['#0a1a0e', '#1a4a2e'] },
            { id: 'violet', name: 'Фиолет', gradient: ['#120a1a', '#3a1a6e'] },
          ]).map((th) => (
            <button
              key={th.id}
              type="button"
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 ${themeId === th.id ? 'ring-1 ring-white' : 'bg-white/[0.04]'}`}
              style={{ background: `linear-gradient(90deg, ${th.gradient[0]}, ${th.gradient[1]})` }}
              onClick={() => {
                setThemeId(th.id)
                if (isApiMode()) void apiUpdateChatPrefs(th.id, appearance).then(() => showToast('Тема чата: ' + th.name))
              }}
            >
              <span className="font-semibold text-white">{th.name}</span>
            </button>
          ))}
        </div>
      </SubPage>
    )
  }

  if (section === 'close_friends') {
    return (
      <SubPage title="Близкие друзья" onBack={() => setSection('main')}>
        <p className="mb-3 text-[13px] text-[#8e8e93]">
          Истории «для близких» видят только люди из этого списка. Добавляйте друзей из профиля (пока — список здесь).
        </p>
        {!closeFriends.length ? (
          <p className="text-[#777]">Список пуст. Добавить можно через API / профиль в следующей итерации.</p>
        ) : (
          <ul className="space-y-2">
            {closeFriends.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                <span className="text-white">@{f.username}</span>
                <button
                  type="button"
                  className="text-[13px] text-[#8e8e93]"
                  onClick={() => {
                    void apiRemoveCloseFriend(f.id).then(() => {
                      setCloseFriends((prev) => prev.filter((x) => x.id !== f.id))
                      showToast('Удалён')
                    })
                  }}
                >
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        )}
      </SubPage>
    )
  }

return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top relative flex shrink-0 items-center justify-center bg-black px-2 pb-3 pt-2">
        <button
          type="button"
          onClick={() => dismiss('/app/profile')}
          className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
          aria-label="Назад"
        >
          <IconChevron size={22} className="-scale-x-100" />
        </button>
        <h1 className="text-[17px] font-bold text-white">Настройки</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8">
        <div>
          <MenuItem
            icon={IconBell}
            label="Уведомления"
            onClick={() => {
              setSection('notifications')
              if (isApiMode()) void apiGetNotifPrefs().then(setNotifPrefs).catch(() => {})
            }}
          />
          <MenuItem icon={IconBookmark} label="Сохранено" onClick={() => setSection('saved')} />
          <MenuItem icon={IconHeart} label="Нравится" onClick={() => setSection('likes')} />
          <MenuItem
            icon={IconLock}
            label="Конфиденциальность"
            onClick={() => setSection('privacy')}
          />
          <MenuItem icon={IconHelp} label="Справка" onClick={() => setSection('help')} />
          <MenuItem icon={IconInfo} label="Информация" onClick={() => setSection('info')} />
          <MenuItem
            icon={IconPlane}
            label="Оформление чата"
            onClick={() => {
              setSection('appearance')
              if (isApiMode()) {
                void apiGetChatPrefs().then((p) => {
                  setChatThemes(p.themes ?? [])
                  setThemeId(p.theme_id)
                  setAppearance(p.appearance)
                  document.documentElement.dataset.theme = p.appearance === 'light' ? 'light' : 'dark'
                })
              }
            }}
          />
          <MenuItem
            icon={IconLock}
            label="Близкие друзья"
            onClick={() => {
              setSection('close_friends')
              if (isApiMode()) {
                void apiListCloseFriends().then((r) => setCloseFriends(r.items ?? []))
              }
            }}
          />
          {isAdmin ? (
            <MenuItem
              icon={IconLock}
              label="Модерация (жалобы)"
              onClick={() => navigate('/app/mod/reports')}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            void logout().then(() => navigate('/', { replace: true }))
          }}
          className="mt-6 flex w-full items-center py-3.5 text-left text-[16px] font-medium text-[#ff3b30] active:opacity-70"
        >
          Выйти
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
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top relative flex shrink-0 items-center justify-center bg-black px-2 pb-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
          aria-label="Назад"
        >
          <IconChevron size={22} className="-scale-x-100" />
        </button>
        <h1 className="text-[17px] font-bold text-white">{title}</h1>
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
  icon: IconComp
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 py-[14px] text-left active:bg-white/[0.03]"
    >
      <Icon size={22} className="shrink-0 text-white" />
      <span className="text-[16px] font-normal text-white">{label}</span>
    </button>
  )
}

function ChevronRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 py-[14px] text-left active:bg-white/[0.03]"
    >
      <span className="text-[16px] font-normal text-white">{label}</span>
      <IconChevron size={18} className="shrink-0 text-[#777]" />
    </button>
  )
}

function IconChevronRow({
  icon: Icon,
  label,
  trailing,
  onClick,
}: {
  icon: IconComp
  label: string
  trailing?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 py-[14px] text-left active:bg-white/[0.03]"
    >
      <Icon size={22} className="shrink-0 text-white" />
      <span className="min-w-0 flex-1 text-[16px] font-normal leading-snug text-white">{label}</span>
      {trailing ? (
        <span className="shrink-0 text-[15px] text-[#777]">{trailing}</span>
      ) : null}
      <IconChevron size={18} className="shrink-0 text-[#777]" />
    </button>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3 py-[14px]">
      <span className="text-[16px] font-normal text-white">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[#34c759]' : 'bg-[#39393d]'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-[left] ${
            checked ? 'left-[22px]' : 'left-[2px]'
          }`}
        />
      </button>
    </div>
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
