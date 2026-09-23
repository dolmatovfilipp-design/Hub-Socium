import { Link, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { ShareSheet } from '../components/ShareSheet'
import { Avatar } from '../components/Avatar'
import { PostCard } from '../components/PostCard'
import {
  IconPin,
  IconSettings, IconVerified } from '../components/Icons'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavMotion } from '../components/NavMotion'
import { apiListUserReposts, apiListWidgets, isApiMode } from '../lib/api'
import { FeedSkeleton } from '../components/Skeleton'
import type { Post } from '../types'

type ProfileTab = 'posts' | 'replies' | 'media' | 'reposts'


export function Profile() {
  const { userId, username } = useParams<{ userId?: string; username?: string }>()
  // Drill-down when opening someone else's profile; own tab stays instant
  const { motionClass, dismiss } = useNavMotion('push')
  const currentId = useStore((s) => s.currentUserId)!
  const targetId = userId ?? username ?? currentId
  const loadProfile = useStore((s) => s.loadProfile)
  const allUsers = useStore((s) => s.users)
  const user = useMemo(() => {
    const byId = allUsers.find((u) => u.id === targetId)
    if (byId) return byId
    const byName = allUsers.filter((u) => u.username === targetId)
    // Prefer API UUID users over local seed stubs (u1/u2…) with the same username
    const uuidLike = byName.find((u) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u.id),
    )
    return uuidLike ?? byName[0]
  }, [allUsers, targetId])
  const currentUser = useMemo(
    () => allUsers.find((u) => u.id === currentId),
    [allUsers, currentId],
  )
  const isMe =
    (!userId && !username) ||
    targetId === currentId ||
    (!!currentUser &&
      (currentUser.username === targetId || currentUser.id === targetId))
  const resolvedId = user?.id ?? (isMe ? currentId : targetId)
  const allPosts = useStore((s) => s.posts)
  const showToast = useStore((s) => s.showToast)
  const followUser = useStore((s) => s.followUser)
  const unfollowUser = useStore((s) => s.unfollowUser)
  const followingIds = useStore((s) => s.followingIds)
  const posts = useMemo(
    () => allPosts.filter((p) => p.authorId === resolvedId && !p.replyToId),
    [allPosts, resolvedId],
  )
  const replies = useMemo(
    () => allPosts.filter((p) => p.authorId === resolvedId && !!p.replyToId),
    [allPosts, resolvedId],
  )
  const mediaPosts = useMemo(
    () => posts.filter((p) => !!p.image),
    [posts],
  )
  const [tab, setTab] = useState<ProfileTab>('posts')
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [loading, setLoading] = useState(isApiMode())
  const [followBusy, setFollowBusy] = useState(false)
  const [repostPosts, setRepostPosts] = useState<Post[]>([])
  const [widgets, setWidgets] = useState<any[]>([])
  const [verified, setVerified] = useState(false)
  const isFollowing = followingIds.includes(resolvedId)

  const mutuals = useMemo(
    () => allUsers.filter((u) => u.id !== resolvedId).slice(0, 3),
    [allUsers, resolvedId],
  )

  useEffect(() => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const key = isMe ? currentId : targetId
      await loadProfile(key)
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [targetId, currentId, isMe, loadProfile])

  useEffect(() => {
    if (!isApiMode() || !resolvedId) {
      setWidgets([])
      return
    }
    let cancelled = false
    void apiListWidgets(resolvedId)
      .then((d) => {
        if (cancelled) return
        setWidgets(d.items ?? [])
        setVerified(!!d.is_verified)
      })
      .catch(() => {
        if (!cancelled) setWidgets([])
      })
    return () => {
      cancelled = true
    }
  }, [resolvedId])


  useEffect(() => {
    if (tab !== 'reposts') return
    if (!isApiMode()) {
      setRepostPosts(allPosts.filter((p) => p.reposts.includes(resolvedId)))
      return
    }
    let cancelled = false
    void apiListUserReposts(resolvedId)
      .then((data) => {
        if (cancelled) return
        const viewer = currentId
        const mapped = (data.items ?? []).map((item) => {
          const count = Math.max(0, (item.reposts as number) | 0)
          const repostIds: string[] = []
          for (let i = 0; i < count; i++) repostIds.push(`ranon_${item.id}_${i}`)
          if (item.reposted_by_me && viewer) {
            if (!repostIds.length) repostIds.push(viewer)
            else repostIds[0] = viewer
          }
          const likeCount = Math.max(0, item.likes | 0)
          const likeIds: string[] = []
          for (let i = 0; i < likeCount; i++) likeIds.push(`anon_${item.id}_${i}`)
          if (item.liked_by_me && viewer) {
            if (!likeIds.length) likeIds.push(viewer)
            else likeIds[0] = viewer
          }
          return {
            id: item.id,
            authorId: item.author_id,
            text: item.body,
            image: item.image_url || undefined,
            createdAt: item.created_at,
            likes: likeIds,
            reposts: repostIds,
            replies: [],
          } as Post
        })
        setRepostPosts(mapped)
        // merge into store so PostCard can resolve
        useStore.setState((st) => {
          const ids = new Set(mapped.map((m) => m.id))
          const keep = st.posts.filter((p) => !ids.has(p.id))
          let users = st.users
          for (const m of mapped) {
            if (!users.some((u) => u.id === m.authorId)) {
              users = [
                ...users,
                {
                  id: m.authorId,
                  name: 'User',
                  username: m.authorId.slice(0, 8),
                  email: '',
                  password: '',
                  followers: 0,
                  following: 0,
                },
              ]
            }
          }
          return { posts: [...mapped, ...keep], users }
        })
      })
      .catch(() => {
        if (!cancelled) setRepostPosts([])
      })
    return () => {
      cancelled = true
    }
  }, [tab, resolvedId, allPosts, currentId])

  if (loading && !user) {
    return (
      <div className={`flex h-full flex-col bg-black ${motionClass}`}>
        <FeedSkeleton count={2} />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-[#8e8e93]">
        Пользователь не найден
      </div>
    )
  }

  const list =
    tab === 'posts'
      ? posts
      : tab === 'replies'
        ? replies
        : tab === 'media'
          ? mediaPosts
          : repostPosts

  const bioLines = (user.bio || '').split(/\n|\s*\|\s*/).filter(Boolean)
  const pinned = posts[0]

  return (
    <div className={`flex h-full flex-col bg-black ${userId ? motionClass : ''}`}>
      <header className="safe-top z-10 flex shrink-0 items-center justify-between bg-black px-2 pb-1 pt-2">
        {userId ? (
          <button
            type="button"
            className="pressable flex h-11 w-11 items-center justify-center text-white"
            aria-label="Назад"
            onClick={() => dismiss(-1)}
          >
            <span className="text-[28px] leading-none font-light">‹</span>
          </button>
        ) : (
          <div className="h-11 w-11" aria-hidden />
        )}
        <div className="flex items-center">
          {isMe && (
            <Link
              to="/app/settings"
              className="pressable flex h-11 w-11 items-center justify-center text-white"
              aria-label="Настройки"
            >
              <IconSettings size={22} />
            </Link>
          )}
        </div>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto scroll-pad-nav">
        <div className="px-4 pt-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-[24px] font-bold leading-tight tracking-[-0.02em] text-white">
                <span className="min-w-0 truncate">{user.name}</span>
                {verified ? <IconVerified size={18} className="shrink-0" /> : null}
              </h2>
              <p className="mt-0.5 text-[15px] text-[#8e8e93]">{user.username}</p>
            </div>
            <button
              type="button"
              aria-label="Открыть аватар"
              className="relative shrink-0 rounded-full pressable"
              onClick={() => setAvatarOpen(true)}
            >
              <Avatar
                name={user.name}
                id={user.id}
                src={user.avatar}
                size={64}
                className="avatar-ring pointer-events-none"
              />
            </button>
          </div>

          {bioLines.length > 0 && (
            <div className="mt-3 space-y-0.5 text-[15px] leading-snug text-white">
              {bioLines.map((line, i) => (
                <p key={i}>{line}{i < bioLines.length - 1 && line.length < 40 ? ' |' : ''}</p>
              ))}
            </div>
          )}

          {(user.about || user.services || (user.links && user.links.length > 0) || (user.sellerReviews && user.sellerReviews > 0)) && (
            <div className="mt-3 space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              {user.about ? (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8e8e93]">О себе</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-white">{user.about}</p>
                </div>
              ) : null}
              {user.services ? (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8e8e93]">Услуги</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-[#e5e5ea]">{user.services}</p>
                </div>
              ) : null}
              {user.links && user.links.length > 0 ? (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8e8e93]">Ссылки</p>
                  <ul className="mt-1 space-y-1">
                    {user.links.map((url) => (
                      <li key={url}>
                        <a href={url.startsWith('http') ? url : `https://${url}`} target="_blank" rel="noreferrer" className="break-all text-[14px] text-[#7aa2ff]">
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {user.sellerReviews && user.sellerReviews > 0 ? (
                <p className="text-[13px] text-[#c7c7cc]">
                  ★ {user.sellerRating ?? '—'} · {user.sellerReviews}{' '}
                  {user.sellerReviews === 1 ? 'отзыв' : user.sellerReviews < 5 ? 'отзыва' : 'отзывов'} продавца
                </p>
              ) : null}
            </div>
          )}


          {(widgets.length > 0 || (isMe && !widgets.length)) && (
            <div className="mt-3 space-y-2">

              {widgets.map((w) => (
                <div key={w.id} className="hub-card p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8e8e93]">
                    {w.kind === 'price_list' ? 'Прайс' : 'Портфолио'} · {w.title}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {(Array.isArray(w.payload) ? w.payload : []).slice(0, 12).map((row: any, i: number) => (
                      <li key={i} className="flex justify-between gap-3 text-[14px] text-[#e5e5ea]">
                        <span className="min-w-0 truncate">{typeof row === 'string' ? row : row?.label || row?.url || JSON.stringify(row)}</span>
                        {row?.price != null ? <span className="shrink-0 text-white">{row.price}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {isMe && widgets.length === 0 ? (
                <p className="text-[12px] text-[#555]">Виджеты прайса/портфолио — в «Редактировать профиль».</p>
              ) : null}
            </div>
          )}

          <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center pl-0.5">
              {mutuals.map((m, i) => (
                <span
                  key={m.id}
                  className="relative inline-block"
                  style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i }}
                >
                  <Avatar name={m.name} id={m.id} src={m.avatar} size={18} />
                </span>
              ))}
            </div>
            <Link
              to={`/app/profile/${resolvedId}/followers`}
              className="text-[14px] text-[#8e8e93] active:opacity-70"
            >
              <span className="font-semibold text-white">{user.followers}</span> подписчиков
            </Link>
            <Link
              to={`/app/profile/${resolvedId}/following`}
              className="text-[14px] text-[#8e8e93] active:opacity-70"
            >
              <span className="font-semibold text-white">{user.following}</span> подписок
            </Link>
          </div>

          {isMe ? (
            <div className="mt-4 flex gap-2">
              <Link
                to="/app/profile/edit"
                className="edit-profile-btn flex h-9 flex-1 items-center justify-center rounded-xl bg-[#1c1c1e] text-[14px] font-semibold text-white"
              >
                Редактировать профиль
              </Link>
              <button
                type="button"
                className="edit-profile-btn flex h-9 flex-1 items-center justify-center rounded-xl bg-[#1c1c1e] text-[14px] font-semibold text-white"
                onClick={() => setShareOpen(true)}
              >
                Поделиться профилем
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={followBusy}
              className={`mt-4 flex h-9 w-full items-center justify-center rounded-xl text-[14px] font-semibold disabled:opacity-50 ${
                isFollowing
                  ? 'bg-[#1c1c1e] text-white'
                  : 'bg-white text-black'
              }`}
              onClick={() => {
                void (async () => {
                  setFollowBusy(true)
                  const wasFollowing = isFollowing
                  try {
                    const res = wasFollowing
                      ? await unfollowUser(user.id)
                      : await followUser(user.id)
                    if (!res.ok) {
                      showToast(res.error ?? 'Ошибка')
                      return
                    }
                    await loadProfile(user.id)
                    showToast(
                      wasFollowing
                        ? `Отписка от @${user.username}`
                        : user.followRequested || (res as { requested?: boolean }).requested
                          ? 'Запрос на подписку отправлен'
                          : `Подписка на @${user.username}`,
                    )
                  } finally {
                    setFollowBusy(false)
                  }
                })()
              }}
            >
              {followBusy
                ? '…'
                : isFollowing
                  ? 'Вы подписаны'
                  : user.followRequested
                    ? 'Запрос отправлен'
                    : 'Подписаться'}
            </button>
          )}
        </div>


          {user.postsLocked && (
            <p className="mt-4 rounded-xl border border-white/10 bg-[#1c1c1e] px-3 py-3 text-center text-[13px] text-[#8e8e93]">
              Закрытый профиль — публикации видны после одобрения подписки
            </p>
          )}

        <div className="mt-4 flex border-b border-white/[0.08]">
          {(
            [
              ['posts', 'Посты'],
              ['replies', 'Ответы'],
              ['media', 'Медиа'],
              ['reposts', 'Репосты'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`relative flex-1 py-3 text-[14px] font-semibold transition ${
                tab === id ? 'text-white' : 'text-[#8e8e93]'
              }`}
            >
              {label}
              {tab === id && (
                <span className="absolute inset-x-0 bottom-0 h-[1.5px] bg-white" />
              )}
            </button>
          ))}
        </div>

        {isMe && tab === 'posts' && (
          <Link
            to="/app/compose"
            className="composer-row flex items-center gap-3 px-4 py-3"
          >
            <Avatar name={user.name} id={user.id} src={user.avatar} size={36} />
            <span className="text-[15px] text-[#8e8e93]">Что нового?</span>
          </Link>
        )}

        {tab === 'posts' && pinned && (
          <div className="px-4 pb-1 pt-2">
            <div className="mb-1 flex items-center gap-1.5 text-[13px] text-[#8e8e93]">
              <IconPin size={14} />
              <span>Прикреплено</span>
            </div>
          </div>
        )}

        {list.map((p) => (
          <PostCard key={p.id} postId={p.id} showFollowPlus={false} />
        ))}
        {!list.length && (
          <p className="px-4 py-10 text-center text-[#8e8e93]">
            {tab === 'posts'
              ? 'Нет публикаций'
              : tab === 'replies'
                ? 'Нет ответов'
                : tab === 'media'
                  ? 'Нет медиа'
                  : 'Нет репостов'}
          </p>
        )}
      </div>

      {avatarOpen &&
        createPortal(
          <button
            type="button"
            aria-label="Закрыть аватар"
            className="avatar-lightbox pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center border-0 bg-black/40 p-0"
            onClick={() => setAvatarOpen(false)}
          >
            <span
              className="avatar-lightbox-zoom block rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
              onClick={(e) => {
                e.stopPropagation()
                setAvatarOpen(false)
              }}
            >
              <Avatar
                name={user.name}
                id={user.id}
                src={user.avatar}
                size={168}
                className="avatar-ring pointer-events-none"
              />
            </span>
          </button>,
          document.getElementById('hub-overlay-root') ?? document.body,
        )}

      {shareOpen && user && (
        <ShareSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title="Поделиться профилем"
          path={`/app/u/${encodeURIComponent(user.username)}`}
        />
      )}

    </div>
  )
}
