import { applyAppTheme } from '../lib/theme'
import {
  DEFAULT_NAV_PREFS,
  loadNavPrefs,
  NAV_CATALOG,
  NAV_THEME_META,
  saveNavPrefs,
  type NavPrefs,
  type NavThemeId,
} from '../lib/navPrefs'
import { clearOnboardingSeen } from '../lib/onboarding'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { PostCard } from '../components/PostCard'
import { FeedSkeleton } from '../components/Skeleton'
import { SegmentedControl } from '../components/SegmentedControl'
import { SelectDropdown } from '../components/SelectDropdown'
import { Avatar } from '../components/Avatar'
import { useEffect, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { useNavMotion } from '../components/NavMotion'
import {
  apiSubscribePush,
  apiListBookmarks,
  apiListBookmarkFolders,
  apiCreateBookmarkFolder,
  apiMoveBookmark,
  apiListBookmarksInFolder,
  apiListMyLikes,
  apiUnblock,
  apiListBlocks,
  apiUnsubscribePush,
  apiTestPush,
  apiGetChatPrefs,
  apiUpdateChatPrefs,
  apiListCloseFriends,
  apiRemoveCloseFriend,
  apiGetNotifPrefs,
  apiUpdateNotifPrefs,
  apiListSessions,
  apiRevokeSession,
  apiLogoutEverywhere,
  apiExportMyData,
  apiMyReferral,
  apiListArchive,
  apiRemoveArchive,
  isApiMode,
  type ArchiveItem,
} from '../lib/api'
import {
  REFERRAL_INVITE_TEXT,
  copyText,
  buildInviteShareText,
  shareInvite,
  smsInviteHref,
} from '../lib/contactsInvite'
import { loadParentalPrefs, saveParentalPrefs, type ParentalPrefs } from '../lib/parental'
import { publicAppUrl } from '../components/ShareSheet'
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
  IconNavGrid,
  IconPersonPlus,
  IconLink,
  IconStar,
  IconPencil,
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
  | 'security'
  | 'nav_bar'
  | 'stories'
  | 'archive'
  | 'contacts'
  | 'parental'

export function Settings() {
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('sheet')
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const logout = useStore((s) => s.logout)
  const savedIdsLocal = useStore((s) => s.savedPostIds)
  const [apiSavedIds, setApiSavedIds] = useState<string[] | null>(null)
  const [bookmarkFolders, setBookmarkFolders] = useState<{ id: string; name: string; count: number }[]>([])
  const [activeFolder, setActiveFolder] = useState<string | 'all' | 'unfiled'>('all')
  const [unfiledCount, setUnfiledCount] = useState(0)
  const [apiLikedIds, setApiLikedIds] = useState<string[] | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const savedIds = apiSavedIds ?? savedIdsLocal
  const posts = useStore((s) => s.posts)
  const uid = useStore((s) => s.currentUserId)
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
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [referralPath, setReferralPath] = useState('/invite')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [parental, setParental] = useState<ParentalPrefs>(() => loadParentalPrefs())
  const [closeFriends, setCloseFriends] = useState<{ id: string; username: string; display_name: string }[]>([])
  const [notifPrefs, setNotifPrefs] = useState<any>({
    likes: true, comments: true, follows: true, messages: true, mentions: true, digest_hours: 0,
  })
  const [sessions, setSessions] = useState<any[]>([])
  const [widgetsBusy, setWidgetsBusy] = useState(false)
  const [navPrefs, setNavPrefs] = useState<NavPrefs>(() => loadNavPrefs())

  const likedIdsLocal = useMemo(() => {
    if (!uid) return [] as string[]
    return posts.filter((p) => p.likes.includes(uid)).map((p) => p.id)
  }, [posts, uid])
  const likedIds = apiLikedIds ?? likedIdsLocal

  useEffect(() => {
    if (section !== 'saved' && section !== 'likes') return
    if (!isApiMode()) {
      setListLoading(false)
      setListError(null)
      return
    }
    let cancelled = false
    setListLoading(true)
    setListError(null)
    void (async () => {
      try {
        if (section === 'saved') {
          const [data, folders] = await Promise.all([apiListBookmarks(), apiListBookmarkFolders()])
          if (cancelled) return
          setBookmarkFolders(folders.items ?? [])
          setUnfiledCount(folders.unfiled ?? 0)
          const items = data.items ?? []
          useStore.setState((st) => {
            const ids = new Set(items.map((i) => i.id))
            const keep = st.posts.filter((p) => !ids.has(p.id))
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
            let users = st.users
            for (const item of items) {
              if (!users.some((u) => u.id === item.author_id)) {
                const short = item.author_id.replace(/-/g, '').slice(0, 8)
                users = [
                  ...users,
                  {
                    id: item.author_id,
                    name: `user_${short}`,
                    username: `user_${short}`,
                    email: `${short}@hub.app`,
                    password: '',
                    bio: '',
                    followers: 0,
                    following: 0,
                  },
                ]
              }
            }
            return { posts: [...mapped, ...keep], users }
          })
          setApiSavedIds(items.map((i) => i.id))
        } else {
          const data = await apiListMyLikes()
          if (cancelled) return
          const items = data.items ?? []
          useStore.setState((st) => {
            const ids = new Set(items.map((i) => i.id))
            const keep = st.posts.filter((p) => !ids.has(p.id))
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
            let users = st.users
            for (const item of items) {
              if (!users.some((u) => u.id === item.author_id)) {
                const short = item.author_id.replace(/-/g, '').slice(0, 8)
                users = [
                  ...users,
                  {
                    id: item.author_id,
                    name: `user_${short}`,
                    username: `user_${short}`,
                    email: `${short}@hub.app`,
                    password: '',
                    bio: '',
                    followers: 0,
                    following: 0,
                  },
                ]
              }
            }
            return { posts: [...mapped, ...keep], users }
          })
          setApiLikedIds(items.map((i) => i.id))
        }
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : 'Не удалось загрузить')
      } finally {
        if (!cancelled) setListLoading(false)
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
        <div className="flex gap-2 overflow-x-auto px-4 py-2 scrollbar-none">
          <button type="button" className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${activeFolder==='all'?'bg-white text-black':'bg-white/[0.06] text-[#c7c7cc]'}`} onClick={() => setActiveFolder('all')}>Все</button>
          <button type="button" className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${activeFolder==='unfiled'?'bg-white text-black':'bg-white/[0.06] text-[#c7c7cc]'}`} onClick={() => {
            setActiveFolder('unfiled')
            void apiListBookmarksInFolder(null).then((d) => setApiSavedIds((d.items??[]).map(i=>i.id)))
          }}>Без папки · {unfiledCount}</button>
          {bookmarkFolders.map((f) => (
            <button key={f.id} type="button" className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${activeFolder===f.id?'bg-white text-black':'bg-white/[0.06] text-[#c7c7cc]'}`} onClick={() => {
              setActiveFolder(f.id)
              void apiListBookmarksInFolder(f.id).then((d) => setApiSavedIds((d.items??[]).map(i=>i.id)))
            }}>{f.name} · {f.count}</button>
          ))}
          <button type="button" className="shrink-0 rounded-full border border-white/[0.12] px-3.5 py-1.5 text-[13px] font-medium text-[#a8a8a8]" onClick={() => {
            const name = window.prompt('Название папки')
            if (!name?.trim()) return
            void apiCreateBookmarkFolder(name.trim()).then((f) => {
              setBookmarkFolders((prev) => [...prev, { id: f.id, name: f.name, count: 0 }])
              showToast('Папка создана')
            }).catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
          }}>Новая</button>
        </div>
        {listLoading && <FeedSkeleton count={4} />}
        {!listLoading && listError && (
          <div className="px-4 py-10 text-center">
            <p className="text-[15px] text-[#777]">{listError}</p>
            <button
              type="button"
              className="mt-3 text-[14px] text-white underline"
              onClick={() => {
                setApiSavedIds(null)
                setSection('main')
                window.setTimeout(() => setSection('saved'), 0)
              }}
            >
              Повторить
            </button>
          </div>
        )}
        {!listLoading && !listError && savedIds.map((id) => (
          <div key={id}>
            <PostCard postId={id} />
            {bookmarkFolders.length > 0 && (
              <div className="mb-3 flex items-center gap-2 overflow-x-auto px-4 scrollbar-none">
                <span className="shrink-0 text-[12px] text-[#777]">В папку</span>
                {bookmarkFolders.map((f) => (
                  <button key={f.id} type="button" className="pressable shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] text-[#c7c7cc]" onClick={() => {
                    void apiMoveBookmark(id, f.id).then(() => showToast('Перемещено')).catch((e)=>showToast(e instanceof Error?e.message:'Ошибка'))
                  }}>{f.name}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {!listLoading && !listError && !savedIds.length && (
          <p className="px-4 py-10 text-center text-[15px] text-[#777]">Нет сохранённых</p>
        )}
      </SubPage>
    )
  }

  if (section === 'likes') {
    return (
      <SubPage title="Нравится" onBack={() => setSection('main')}>
        {listLoading && <FeedSkeleton count={4} />}
        {!listLoading && listError && (
          <div className="px-4 py-10 text-center">
            <p className="text-[15px] text-[#777]">{listError}</p>
            <button
              type="button"
              className="mt-3 text-[14px] text-white underline"
              onClick={() => {
                setApiLikedIds(null)
                setSection('main')
                window.setTimeout(() => setSection('likes'), 0)
              }}
            >
              Повторить
            </button>
          </div>
        )}
        {!listLoading && !listError && likedIds.map((id) => (
          <PostCard key={id} postId={id} />
        ))}
        {!listLoading && !listError && !likedIds.length && (
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
      setPushHint('Подписка сохранена')
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
          <h2 className="hub-section-title pb-1 pt-1">Push</h2>
          <ToggleRow label="Push" checked={pushEnabled} onChange={(v) => { void togglePush(v) }} />
          {pushHint ? <p className="pt-2 text-[13px] text-hub-muted">{pushHint}</p> : null}
          {pushEnabled && isApiMode() ? (
            <button
              type="button"
              className="mt-3 w-full rounded-2xl border border-[color:var(--hub-app-border,rgba(255,255,255,0.12))] bg-[color:var(--hub-app-card,#1c1c1e)] px-4 py-3 text-[15px] font-semibold text-hub-text"
              disabled={pushBusy}
              onClick={() => {
                void (async () => {
                  setPushBusy(true)
                  setPushHint('')
                  try {
                    const res = await apiTestPush()
                    setPushHint(`Тест отправлен · подписок: ${res.subscriptions ?? '—'}`)
                    showToast('Тест push отправлен')
                  } catch (e) {
                    setPushHint(e instanceof Error ? e.message : 'Тест не удался')
                  } finally {
                    setPushBusy(false)
                  }
                })()
              }}
            >
              Отправить тест
            </button>
          ) : null}
          <ToggleRow label="Приостановить все" checked={pauseAll} onChange={setPauseAll} />
          <h2 className="pb-1 pt-5 hub-section-title">Типы</h2>
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
          <h2 className="pb-1 pt-5 hub-section-title">Дайджест</h2>
          <p className="pb-2 text-[13px] text-hub-muted">Сводка раз в N часов (0 = выкл)</p>
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
          <p className="text-[13px] text-[#777]">Часы начала/конца (0–23, МСК). Пусто = без ограничений.</p>
          <div className="mt-2 flex gap-2">
            <input type="number" min={0} max={23} placeholder="с"
              className="w-20 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-white"
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
              className="w-20 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-white"
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
          <div className="mt-4">
            <ToggleRow
              label="Важные всё равно"
              checked={notifPrefs.quiet_allow_favorites !== false}
              onChange={(v) => {
                const next = { ...notifPrefs, quiet_allow_favorites: v }
                setNotifPrefs(next)
                if (isApiMode()) void apiUpdateNotifPrefs({ quiet_allow_favorites: v }).then(() => showToast('Сохранено'))
              }}
            />
            <p className="pt-1 text-[12px] leading-snug text-[#777]">
              В тихие часы сообщения из чатов «Важные» и от близких друзей всё равно приходят.
            </p>
          </div>
        </div>
      </SubPage>
    )
  }

  if (section === 'blocks') {
    return (
      <SubPage title="Чёрный список" onBack={() => setSection('main')}>
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

  if (section === 'stories') {
    return (
      <SubPage title="Истории" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-1">
          <div className="settings-list-card px-4">
            <ToggleRow
              label="Скрыть все истории"
              checked={!!settings.hideStories}
              onChange={(v) => updateSettings({ hideStories: v })}
            />
          </div>
          <p className="mt-3 px-1 text-[13px] leading-snug text-[#777]">
            Когда включено, лента не показывает истории (свои и чужие). Вкладки «Подписчики /
            Интересное» заменяются компактным переключателем у шестерёнки.
          </p>
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
            Справка и поддержка пока недоступны.
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
            label="Политика конфиденциальности Get Hub"
            onClick={() => navigate('/legal/privacy')}
          />
          <ChevronRow
            label="Условия использования Get Hub"
            onClick={() => navigate('/legal/terms')}
          />
        </div>
      </SubPage>
    )
  }

    if (section === 'appearance') {
    const themes = chatThemes.length ? chatThemes : [
      { id: 'default', name: 'Классика', gradient: ['#000', '#1c1c1e'] },
      { id: 'ocean', name: 'Океан', gradient: ['#0a1628', '#1a4a6e'] },
      { id: 'sunset', name: 'Закат', gradient: ['#1a0a0a', '#6e2a1a'] },
      { id: 'forest', name: 'Лес', gradient: ['#0a1a0e', '#1a4a2e'] },
      { id: 'violet', name: 'Фиолет', gradient: ['#120a1a', '#3a1a6e'] },
      { id: 'cream', name: 'Кремовый', gradient: ['#fff7e6', '#ead7b7'] },
      { id: 'sand', name: 'Песочный', gradient: ['#e7d3b5', '#b8956a'] },
      { id: 'peach', name: 'Персиковый', gradient: ['#ffd1b8', '#e9967a'] },
      { id: 'honey', name: 'Медовый', gradient: ['#ffe08a', '#d59b2b'] },
      { id: 'terracotta', name: 'Терракотовый', gradient: ['#d98268', '#8f4536'] },
      { id: 'rose', name: 'Розовый', gradient: ['#f2b6c6', '#b96782'] },
      { id: 'latte', name: 'Латте', gradient: ['#d8b08c', '#8c6748'] },
      { id: 'amber', name: 'Янтарный', gradient: ['#f6c453', '#b56b12'] },
      { id: 'warm-gray', name: 'Тёплый серый', gradient: ['#d9d1ca', '#8f8781'] },
      { id: 'ivory', name: 'Слоновая кость', gradient: ['#fffff0', '#d8d2b4'] },
    ]

    return (
      <SubPage title="Оформление" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-2">
          <section>
            <h2 className="text-[16px] font-bold text-white">Тема приложения</h2>
            <p className="mb-3 mt-1 text-[13px] text-[#8e8e93]">Выберите светлое или тёмное оформление Get Hub.</p>
            <SegmentedControl
              ariaLabel="Тема приложения"
              value={appearance}
              options={[
                { value: 'dark', label: 'Тёмная' },
                { value: 'light', label: 'Светлая' },
              ]}
              onChange={(next) => {
                setAppearance(next)
                applyAppTheme(next)
                document.documentElement.classList.toggle('light', next === 'light')
                if (isApiMode()) void apiUpdateChatPrefs(themeId, next).then(() => showToast('Сохранено'))
              }}
            />
          </section>

          <section className="mt-7 border-t border-white/[0.08] pt-5">
            <h2 className="text-[16px] font-bold text-white">Градиент чатов</h2>
            <p className="mb-3 mt-1 text-[13px] text-[#8e8e93]">Выберите оформление фона сообщений.</p>
            <SelectDropdown
              ariaLabel="Градиент чатов"
              value={themeId}
              options={themes.map((th) => ({
                value: th.id,
                label: th.name,
                preview: `linear-gradient(90deg, ${th.gradient[0]}, ${th.gradient[1] || th.gradient[0]})`,
              }))}
              onChange={(next) => {
                const selected = themes.find((th) => th.id === next)
                setThemeId(next)
                if (isApiMode()) void apiUpdateChatPrefs(next, appearance).then(() => showToast('Тема чата: ' + (selected?.name || next)))
              }}
            />
          </section>
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
          <p className="text-[#777]">Список пуст. Добавить друзей можно из их профиля.</p>
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

  if (section === 'security') {
    return (
      <SubPage title="Безопасность" onBack={() => setSection('main')}>
        <div className="space-y-4 px-4 pb-8 pt-2">
          <p className="hub-section-title">Сессии и устройства</p>
          {sessions.length === 0 ? (
            <p className="text-[14px] text-[#8e8e93]">Нет активных сессий или загрузите список.</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="hub-card flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-white">{s.device_name || 'Устройство'}</p>
                    <p className="truncate text-[12px] text-[#8e8e93]">{s.ip || '—'} · {s.user_agent?.slice?.(0, 40) || ''}</p>
                  </div>
                  <button
                    type="button"
                    className="hub-btn hub-btn-ghost shrink-0 !min-h-0 px-2 py-1 text-[13px] text-[#ff3b30]"
                    onClick={() => {
                      if (!isApiMode()) return
                      void apiRevokeSession(s.id).then(() => {
                        setSessions((prev) => prev.filter((x) => x.id !== s.id))
                        showToast('Сессия завершена')
                      })
                    }}
                  >
                    Выйти
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="hub-btn hub-btn-danger w-full"
            onClick={() => {
              if (!isApiMode()) return
              void apiLogoutEverywhere().then(() => {
                showToast('Вышли везде')
                void logout().then(() => navigate('/', { replace: true }))
              })
            }}
          >
            Выйти везде
          </button>
          <p className="hub-section-title pt-4">Мои данные</p>
          <p className="text-[13px] text-[#8e8e93]">Скачать профиль, посты и объявления одним файлом.</p>
          <button
            type="button"
            className="hub-btn hub-btn-secondary w-full"
            disabled={widgetsBusy}
            onClick={() => {
              if (!isApiMode()) {
                showToast('Только в API-режиме')
                return
              }
              setWidgetsBusy(true)
              void apiExportMyData()
                .then((data) => {
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'hub-export.json'
                  a.click()
                  URL.revokeObjectURL(url)
                  showToast('Скачано hub-export.json')
                })
                .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка экспорта'))
                .finally(() => setWidgetsBusy(false))
            }}
          >
            Экспорт «мои данные»
          </button>

        </div>
      </SubPage>
    )
  }


  if (section === 'nav_bar') {
    const updateNav = (next: NavPrefs) => {
      setNavPrefs(next)
      saveNavPrefs(next)
    }
    return (
      <SubPage title="Панель навигации" onBack={() => setSection('main')}>
        <div className="px-4 pb-10 pt-2">
          <p className="mb-4 text-[13px] leading-snug text-[#8e8e93]">
            Настройте нижнюю панель: дополнительные вкладки, размер и мягкую тему. Создать пост — из ленты («Что нового?»).
          </p>

          <h2 className="pb-2 text-[15px] font-bold text-white">Центральные вкладки</h2>
          <p className="mb-2 text-[12px] text-[#777]">Поиск, Видео и Музыка появляются посередине панели, если включены.</p>
          {(['search', 'video'] as const).map((id) => {
            const prefKey = `enable${id[0].toUpperCase()}${id.slice(1)}` as 'enableSearch' | 'enableVideo'
            return (
              <ToggleRow
                key={id}
                label={NAV_CATALOG[id].label}
                checked={navPrefs[prefKey]}
                onChange={() => updateNav({ ...navPrefs, [prefKey]: !navPrefs[prefKey] })}
              />
            )
          })}
          <div className="flex items-center justify-between py-3 opacity-55">
            <div>
              <p className="text-[15px] text-white">Музыка</p>
              <p className="text-[12px] text-[#8e8e93]">Скоро</p>
            </div>
            <span className="rounded-full bg-[#2c2c2e] px-2.5 py-1 text-[11px] font-semibold text-[#8e8e93]">выкл</span>
          </div>

          <ToggleRow
            label="Рамка и индикатор"
            checked={navPrefs.showFrameAndIndicator}
            onChange={(showFrameAndIndicator) => updateNav({ ...navPrefs, showFrameAndIndicator })}
          />

          <h2 className="pb-2 pt-5 text-[15px] font-bold text-white">Размер панели</h2>
          <input
            type="range"
            min={85}
            max={120}
            step={5}
            value={Math.round(navPrefs.scale * 100)}
            aria-label="Масштаб панели"
            className="w-full accent-white"
            onChange={(e) => {
              const scale = Number(e.target.value) / 100
              updateNav({ ...navPrefs, scale })
            }}
          />
          <p className="mt-1 text-[12px] text-[#777]">{Math.round(navPrefs.scale * 100)}%</p>

          <h2 className="pb-2 pt-5 text-[15px] font-bold text-white">Тема панели</h2>
          <SelectDropdown<NavThemeId>
            ariaLabel="Тема панели"
            value={navPrefs.theme}
            options={(Object.keys(NAV_THEME_META) as NavThemeId[]).map((th) => ({
              value: th,
              label: NAV_THEME_META[th].label,
              preview: NAV_THEME_META[th].preview,
            }))}
            onChange={(theme) => updateNav({ ...navPrefs, theme })}
          />

          <button
            type="button"
            className="hub-btn hub-btn-secondary mt-6 w-full"
            onClick={() => {
              const reset = {
                ...DEFAULT_NAV_PREFS,
              }
              updateNav(reset)
              showToast('Сброшено')
            }}
          >
            Сбросить по умолчанию
          </button>
        </div>
      </SubPage>
    )
  }

  const inviteUrl = publicAppUrl(referralPath)
  const inviteBody = buildInviteShareText(inviteUrl)

  const loadArchive = () => {
    if (!isApiMode()) {
      setArchiveItems([])
      return
    }
    setArchiveLoading(true)
    void apiListArchive()
      .then((r) => setArchiveItems(r.items ?? []))
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось загрузить архив'))
      .finally(() => setArchiveLoading(false))
  }

  const loadReferral = () => {
    if (!isApiMode()) return
    void apiMyReferral()
      .then((r) => setReferralPath(r.path || '/invite'))
      .catch(() => {})
  }

  const typeLabel = (t: string) => {
    switch (t) {
      case 'post': return 'Пост'
      case 'message': return 'Сообщение'
      case 'contact': return 'Контакт'
      case 'listing': return 'Объявление'
      case 'photo': return 'Фото'
      case 'video': return 'Видео'
      default: return t
    }
  }

  if (section === 'archive') {
    return (
      <SubPage title="Архив" onBack={() => setSection('main')}>
        <div className="px-1 pb-8 pt-1">
          <p className="mb-3 px-1 text-[13px] leading-snug text-[#8e8e93]">
            Сюда попадают посты, сообщения, контакты, объявления и медиа, которые вы сами сохранили в архив.
          </p>
          {archiveLoading ? (
            <p className="py-10 text-center text-[14px] text-[#777]">Загрузка…</p>
          ) : null}
          {!archiveLoading && !archiveItems.length ? (
            <p className="py-10 text-center text-[15px] text-[#777]">Архив пуст</p>
          ) : null}
          <div className="space-y-2">
            {archiveItems.map((item) => (
              <div key={item.id} className="hub-card flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-[#8e8e93]">{typeLabel(item.type)}</p>
                  <p className="mt-0.5 truncate text-[15px] font-semibold text-white">{item.title || item.ref_id}</p>
                  {item.preview ? (
                    <p className="mt-1 line-clamp-2 text-[13px] text-[#8e8e93]">{item.preview}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-3">
                    {item.type === 'post' || item.type === 'photo' || item.type === 'video' ? (
                      <button type="button" className="text-[12px] text-white" onClick={() => navigate(`/app/p/${item.ref_id}`)}>Открыть</button>
                    ) : null}
                    {item.type === 'contact' ? (
                      <button type="button" className="text-[12px] text-white" onClick={() => navigate(`/app/profile/${item.ref_id}`)}>Профиль</button>
                    ) : null}
                    {item.type === 'message' && typeof item.meta?.conversation_id === 'string' ? (
                      <button type="button" className="text-[12px] text-white" onClick={() => navigate(`/app/messages/${item.meta?.conversation_id}`)}>Чат</button>
                    ) : null}
                    <button
                      type="button"
                      className="text-[12px] text-[#ff3b30]"
                      onClick={() => {
                        if (!isApiMode()) {
                          setArchiveItems((prev) => prev.filter((x) => x.id !== item.id))
                          return
                        }
                        void apiRemoveArchive(item.id)
                          .then(() => setArchiveItems((prev) => prev.filter((x) => x.id !== item.id)))
                          .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
                      }}
                    >
                      Убрать из архива
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SubPage>
    )
  }

  if (section === 'contacts') {
    return (
      <SubPage title="Контакты" onBack={() => setSection('main')}>
        <div className="px-1 pb-8 pt-1">
          <p className="mb-3 px-1 text-[13px] leading-snug text-[#8e8e93]">
            Пригласите друзей в Get Hub по своей реферальной ссылке.
          </p>
          <div className="settings-list-card mb-4">
            <MenuItem
              icon={IconPersonPlus}
              label="Пригласить друзей…"
              first
              onClick={() => {
                if (inviteBusy) return
                setInviteBusy(true)
                void shareInvite(REFERRAL_INVITE_TEXT, inviteUrl)
                  .then((result) => {
                    if (result === 'failed') showToast('Не удалось скопировать')
                    if (result === 'copied') {
                      setInviteCopied(true)
                      window.setTimeout(() => setInviteCopied(false), 1600)
                    }
                  })
                  .finally(() => setInviteBusy(false))
              }}
            />
            <MenuItem
              icon={IconPlane}
              label="Отправить в СМС"
              onClick={() => {
                window.location.href = smsInviteHref('', inviteBody)
              }}
            />
            <MenuItem
              icon={IconLink}
              label={inviteCopied ? 'Ссылка скопирована' : 'Копировать ссылку'}
              onClick={() => {
                void copyText(inviteBody).then((ok) => {
                  if (!ok) {
                    showToast('Не удалось скопировать')
                    return
                  }
                  setInviteCopied(true)
                  window.setTimeout(() => setInviteCopied(false), 1600)
                })
              }}
            />
          </div>
          <p className="px-1 text-[12px] leading-snug text-[#777] break-all">{inviteUrl}</p>
        </div>
      </SubPage>
    )
  }

  if (section === 'parental') {
    return (
      <SubPage title="Родительский контроль" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-2">
          <p className="mb-3 text-[13px] leading-snug text-[#8e8e93]">
            Базовая защита: PIN для смены настроек и напоминание о возрастных ограничениях.
            Полный семейный контроль появится позже.
          </p>
          <div className="settings-list-card px-4 mb-4">
            <ToggleRow
              label="Включить"
              checked={parental.enabled}
              onChange={(v) => {
                if (v && !parental.pin) {
                  const pin = window.prompt('Задайте PIN (4–8 цифр)')
                  if (!pin || !/^\d{4,8}$/.test(pin)) {
                    showToast('Нужен PIN из 4–8 цифр')
                    return
                  }
                  const next = { ...parental, enabled: true, pin }
                  setParental(next)
                  saveParentalPrefs(next)
                  return
                }
                if (!v && parental.pin) {
                  const check = window.prompt('Введите PIN, чтобы выключить')
                  if (check !== parental.pin) {
                    showToast('Неверный PIN')
                    return
                  }
                }
                const next = { ...parental, enabled: v }
                setParental(next)
                saveParentalPrefs(next)
              }}
            />
            <ToggleRow
              label="Показывать возрастной дисклеймер"
              checked={parental.ageGateNote}
              onChange={(v) => {
                if (parental.enabled && parental.pin) {
                  const check = window.prompt('Введите PIN')
                  if (check !== parental.pin) {
                    showToast('Неверный PIN')
                    return
                  }
                }
                const next = { ...parental, ageGateNote: v }
                setParental(next)
                saveParentalPrefs(next)
              }}
            />
          </div>
          <button
            type="button"
            className="hub-btn hub-btn-secondary w-full"
            onClick={() => {
              if (parental.enabled && parental.pin) {
                const check = window.prompt('Текущий PIN')
                if (check !== parental.pin) {
                  showToast('Неверный PIN')
                  return
                }
              }
              const pin = window.prompt('Новый PIN (4–8 цифр)')
              if (!pin || !/^\d{4,8}$/.test(pin)) {
                showToast('Нужен PIN из 4–8 цифр')
                return
              }
              const next = { ...parental, pin }
              setParental(next)
              saveParentalPrefs(next)
              showToast('PIN обновлён')
            }}
          >
            Сменить PIN
          </button>
          {parental.ageGateNote ? (
            <p className="mt-4 rounded-2xl bg-white/[0.04] px-3 py-3 text-[13px] leading-snug text-[#8e8e93]">
              Get Hub ориентирован на пользователей 16+. Родительский контроль ограничивает смену части настроек PIN-кодом.
            </p>
          ) : null}
        </div>
      </SubPage>
    )
  }


return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="hub-screen-header relative flex shrink-0 items-center justify-center px-3 pb-2">
        <button
          type="button"
          onClick={() => dismiss('/app')}
          className="hub-circle-btn absolute left-3"
          aria-label="Назад"
        >
          <IconChevron size={20} className="-scale-x-100" />
        </button>
        <h1 className="text-[17px] font-bold text-hub-text">Настройки</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-3 scroll-pad-safe">
        <div className="settings-list-card mb-5">
          <MenuItem
            icon={IconPencil}
            label="Профиль"
            first
            onClick={() => navigate('/app/profile/edit')}
          />
        </div>

        <p className="hub-section-title mb-2 px-1">Адаптация</p>
        <div className="settings-list-card mb-5">
          <MenuItem
            icon={IconHelp}
            label="Обучение"
            first
            onClick={() => {
              clearOnboardingSeen()
              window.dispatchEvent(new Event('hub:onboarding-replay'))
              dismiss('/app')
            }}
          />
          <MenuItem icon={IconInfo} label="Информация" onClick={() => setSection('info')} />
          <MenuItem icon={IconHelp} label="Справка" onClick={() => setSection('help')} />
          <MenuItem icon={IconLock} label="Политика" onClick={() => navigate('/legal/privacy')} />
          <MenuItem icon={IconLock} label="Оферта" onClick={() => navigate('/legal/offer')} />
          <MenuItem icon={IconLock} label="Модерация" onClick={() => navigate('/app/mod/reports')} />
          <MenuItem
            icon={IconLock}
            label="Родительский контроль"
            onClick={() => {
              setParental(loadParentalPrefs())
              setSection('parental')
            }}
          />
        </div>

        <div className="settings-list-card mb-5">
          <MenuItem
            icon={IconPlane}
            label="Оформление"
            first
            onClick={() => {
              setSection('appearance')
              if (isApiMode()) {
                void apiGetChatPrefs().then((p) => {
                  setChatThemes(p.themes ?? [])
                  setThemeId(p.theme_id)
                  setAppearance(p.appearance)
                  applyAppTheme(p.appearance || 'dark')
                })
              }
            }}
          />
          <MenuItem
            icon={IconNavGrid}
            label="Панель навигации"
            onClick={() => {
              setNavPrefs(loadNavPrefs())
              setSection('nav_bar')
            }}
          />
        </div>

        <p className="hub-section-title mb-2 px-1">Подписчики</p>
        <div className="settings-list-card mb-5">
          <MenuItem
            icon={IconPersonPlus}
            label="Контакты"
            first
            onClick={() => {
              loadReferral()
              setSection('contacts')
            }}
          />
          <MenuItem
            icon={IconHeart}
            label="Близкие друзья"
            onClick={() => {
              setSection('close_friends')
              if (isApiMode()) {
                void apiListCloseFriends().then((r) => setCloseFriends(r.items ?? []))
              }
            }}
          />
          <MenuItem
            icon={IconBlock}
            label="Чёрный список"
            onClick={() => {
              setSection('blocks')
              if (isApiMode()) {
                void apiListBlocks()
                  .then((r) => {
                    const ids = r.items ?? []
                    useStore.setState((s) => {
                      let users = s.users
                      for (const u of r.users ?? []) {
                        if (!users.some((x) => x.id === u.id)) {
                          users = [
                            ...users,
                            {
                              id: u.id,
                              name: u.display_name || u.username,
                              username: u.username,
                              email: '',
                              password: '',
                              bio: '',
                              avatar: u.avatar_url || undefined,
                              followers: 0,
                              following: 0,
                            },
                          ]
                        }
                      }
                      return { blockedAuthorIds: ids, users }
                    })
                  })
                  .catch(() => {})
              }
            }}
          />
        </div>

        <p className="hub-section-title mb-2 px-1">Лента</p>
        <div className="settings-list-card mb-5">
          <MenuItem
            icon={IconNavGrid}
            label="Истории"
            first
            onClick={() => setSection('stories')}
          />
          <MenuItem
            icon={IconNavGrid}
            label="Каналы"
            onClick={() => navigate('/app/channels')}
          />
        </div>

        <p className="hub-section-title mb-2 px-1">Активность</p>
        <div className="settings-list-card mb-5">
          <MenuItem
            icon={IconBell}
            label="Уведомления"
            first
            onClick={() => {
              setSection('notifications')
              if (isApiMode()) void apiGetNotifPrefs().then(setNotifPrefs).catch(() => {})
            }}
          />
          <MenuItem icon={IconBookmark} label="Сохранено" onClick={() => setSection('saved')} />
          <MenuItem icon={IconHeart} label="Нравится" onClick={() => setSection('likes')} />
          <MenuItem
            icon={IconStar}
            label="Архив"
            onClick={() => {
              setSection('archive')
              loadArchive()
            }}
          />
        </div>

        <p className="hub-section-title mb-2 px-1">Защита</p>
        <div className="settings-list-card mb-5">
          <MenuItem
            icon={IconLock}
            label="Конфиденциальность"
            first
            onClick={() => setSection('privacy')}
          />
          <MenuItem
            icon={IconLock}
            label="Безопасность"
            onClick={() => {
              setSection('security')
              if (isApiMode()) {
                void apiListSessions().then((r) => setSessions(r.items ?? [])).catch(() => setSessions([]))
              }
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            void logout().then(() => navigate('/', { replace: true }))
          }}
          className="hub-btn hub-btn-danger mt-2 mb-4 w-full"
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
      <header className="hub-screen-header relative flex shrink-0 items-center justify-center px-3 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="hub-circle-btn absolute left-3"
          aria-label="Назад"
        >
          <IconChevron size={20} className="-scale-x-100" />
        </button>
        <h1 className="text-[17px] font-bold text-hub-text">{title}</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-3 scroll-pad-safe">{children}</div>
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  first = false,
}: {
  icon: IconComp
  label: string
  onClick: () => void
  first?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="settings-list-row relative flex w-full items-center gap-3.5 text-left"
    >
      {!first ? <span className="settings-list-divider" aria-hidden /> : null}
      <Icon size={22} className="shrink-0 text-white" />
      <span className="settings-list-label flex-1 text-white">{label}</span>
      <IconChevron size={16} className="shrink-0 text-[#8e8e93]" />
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
        className={`hub-toggle ${checked ? 'is-on' : ''}`}
      >
        <span className="hub-toggle-knob" />
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
