import { applyAppTheme } from '../lib/theme'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { PostCard } from '../components/PostCard'
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
  apiUnsubscribePush,
  apiGetChatPrefs,
  apiUpdateChatPrefs,
  apiListCloseFriends,
  apiRemoveCloseFriend,
  apiGetNotifPrefs,
  apiUpdateNotifPrefs,
  apiUpdatePresence,
  apiRevokeGuestLink,
  apiListGuestLinks,
  apiCreateGuestLink,
  apiMatchContacts,
  apiListSessions,
  apiRevokeSession,
  apiLogoutEverywhere,
  apiExportMyData,
  isApiMode,
} from '../lib/api'
import {
  IconBell,
  IconBlock,
  IconBookmark,
  IconDraft,
  IconChevron,
  IconHeart,
  IconHelp,
  IconInfo,
  IconLock,
  IconPlane,
  IconUser,
} from '../components/Icons'

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number; filled?: boolean }>

type Section =
  | 'main'
  | 'saved'
  | 'likes'
  | 'notifications'
  | 'presence'
  | 'contacts'
  | 'guest'
  | 'privacy'
  | 'help'
  | 'info'
  | 'blocks'
  | 'following'
  | 'appearance'
  | 'close_friends'
  | 'security'

export function Settings() {
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('push')
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const logout = useStore((s) => s.logout)
  const savedIdsLocal = useStore((s) => s.savedPostIds)
  const [apiSavedIds, setApiSavedIds] = useState<string[] | null>(null)
  const [bookmarkFolders, setBookmarkFolders] = useState<{ id: string; name: string; count: number }[]>([])
  const [activeFolder, setActiveFolder] = useState<string | 'all' | 'unfiled'>('all')
  const [unfiledCount, setUnfiledCount] = useState(0)
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
  const [presenceStatus, setPresenceStatus] = useState('available')
  const [presenceText, setPresenceText] = useState('')
  const [contactPhones, setContactPhones] = useState('')
  const [contactHits, setContactHits] = useState<any[]>([])
  const [guestLinks, setGuestLinks] = useState<{ id: string; path: string; label: string; token: string }[]>([])
  const [closeFriends, setCloseFriends] = useState<{ id: string; username: string; display_name: string }[]>([])
  const [notifPrefs, setNotifPrefs] = useState<any>({
    likes: true, comments: true, follows: true, messages: true, mentions: true, digest_hours: 0,
  })
  const [sessions, setSessions] = useState<any[]>([])
  const [widgetsBusy, setWidgetsBusy] = useState(false)

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
          const [data, folders] = await Promise.all([apiListBookmarks(), apiListBookmarkFolders()])
          if (cancelled) return
          setBookmarkFolders(folders.items ?? [])
          setUnfiledCount(folders.unfiled ?? 0)
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
        {savedIds.map((id) => (
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



  if (section === 'contacts') {
    return (
      <SubPage title="Контакты" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-2">
          <p className="text-[13px] leading-snug text-[#777]">
            Сверим номера с теми, кто уже в Hub. Рассылок и SMS нет.
          </p>
          <textarea
            className="mt-3 min-h-[120px] w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-[14px] text-white outline-none"
            placeholder="Номера через запятую или с новой строки"
            value={contactPhones}
            onChange={(e) => setContactPhones(e.target.value)}
          />
          <button
            type="button"
            className="mt-3 w-full rounded-full bg-white py-2.5 text-[14px] font-semibold text-black"
            onClick={() => {
              const phones = contactPhones.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
              if (!phones.length) {
                showToast('Добавьте номера')
                return
              }
              void apiMatchContacts(phones)
                .then((r) => {
                  setContactHits(r.items || [])
                  showToast(r.matched ? `Найдено: ${r.matched}` : 'Никого из Hub')
                })
                .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
            }}
          >
            Найти в Hub
          </button>
          <div className="mt-4 space-y-2">
            {contactHits.map((u) => (
              <button
                key={u.id}
                type="button"
                className="hub-card flex w-full items-center gap-3 p-3 text-left"
                onClick={() => navigate(`/app/profile/${u.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-white">{u.display_name || u.username}</p>
                  <p className="text-[13px] text-[#8e8e93]">@{u.username}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </SubPage>
    )
  }

  if (section === 'guest') {
    return (
      <SubPage title="Семья" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-2">
          <p className="text-[13px] leading-snug text-[#777]">
            Гостевая ссылка: лента и профиль без аккаунта. Только просмотр.
          </p>
          <button
            type="button"
            className="mt-3 w-full rounded-full bg-white py-2.5 text-[14px] font-semibold text-black"
            onClick={() => {
              void apiCreateGuestLink('Семья')
                .then((l) => {
                  setGuestLinks((prev) => [l as any, ...prev])
                  const url = `${window.location.origin}${l.path}`
                  void navigator.clipboard?.writeText(url)
                  showToast('Ссылка скопирована')
                })
                .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
            }}
          >
            Создать ссылку
          </button>
          <div className="mt-4 space-y-2">
            {guestLinks.map((l) => (
              <div key={l.id || l.token} className="hub-card p-3">
                <p className="text-[14px] font-medium text-white">{l.label || 'Семья'}</p>
                <p className="mt-1 break-all text-[12px] text-[#8e8e93]">{l.path}</p>
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    className="text-[12px] text-white"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${window.location.origin}${l.path}`)
                      showToast('Скопировано')
                    }}
                  >
                    Копировать
                  </button>
                  {l.id ? (
                    <button
                      type="button"
                      className="text-[12px] text-[#8e8e93]"
                      onClick={() => {
                        void apiRevokeGuestLink(l.id).then(() => {
                          setGuestLinks((prev) => prev.filter((x) => x.id !== l.id))
                          showToast('Отозвано')
                        })
                      }}
                    >
                      Отозвать
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SubPage>
    )
  }

  if (section === 'presence') {
    const opts: { id: string; label: string }[] = [
      { id: 'available', label: 'На связи' },
      { id: 'busy', label: 'Занят' },
      { id: 'meeting', label: 'На встрече' },
    ]
    return (
      <SubPage title="Статус" onBack={() => setSection('main')}>
        <div className="px-4 pb-8 pt-2">
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                  presenceStatus === o.id ? 'bg-white text-black' : 'bg-white/[0.06] text-[#c7c7cc]'
                }`}
                onClick={() => {
                  setPresenceStatus(o.id)
                  if (isApiMode()) {
                    void apiUpdatePresence(o.id, presenceText).then(() => showToast('Статус обновлён'))
                  }
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-[#777]">Короткий текст (необязательно)</p>
          <input
            className="mt-2 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-[15px] text-white outline-none"
            placeholder="Например: скоро отвечу"
            maxLength={80}
            value={presenceText}
            onChange={(e) => setPresenceText(e.target.value)}
            onBlur={() => {
              if (isApiMode()) void apiUpdatePresence(presenceStatus, presenceText.trim()).then(() => showToast('Сохранено'))
            }}
          />
        </div>
      </SubPage>
    )
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
                applyAppTheme(a)
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
          <p className="text-[13px] text-[#8e8e93]">Экспорт профиля, постов и объявлений в JSON (MVP).</p>
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
          <p className="pt-2 text-[12px] text-[#555]">
            Секретный чат: при создании диалога можно передать is_secret (заглушка, не E2EE).
          </p>
        </div>
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
            icon={IconUser}
            label="Статус"
            onClick={() => setSection('presence')}
          />
          <MenuItem
            icon={IconUser}
            label="Контакты"
            onClick={() => setSection('contacts')}
          />
          <MenuItem
            icon={IconLock}
            label="Семья"
            onClick={() => {
              setSection('guest')
              if (isApiMode()) void apiListGuestLinks().then((r) => setGuestLinks(r.items || [])).catch(() => {})
            }}
          />
          <MenuItem
            icon={IconBell}
            label="Уведомления"
            onClick={() => {
              setSection('notifications')
              if (isApiMode()) void apiGetNotifPrefs().then(setNotifPrefs).catch(() => {})
            }}
          />
          <MenuItem icon={IconDraft} label="Черновики" onClick={() => navigate('/app/drafts')} />
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
                  applyAppTheme(p.appearance || 'dark')
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
          className="hub-btn hub-btn-danger mt-6 w-full"
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
