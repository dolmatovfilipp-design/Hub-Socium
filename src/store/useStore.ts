import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  User,
  Post,
  Conversation,
  Message,
  MarketItem,
  Activity,
  AppSettings,
} from '../types'
import {
  seedUsers,
  seedPosts,
  seedConversations,
  seedMessages,
  seedMarket,
  seedActivities,
  defaultSettings,
  STORAGE_KEY,
} from '../data/seed'
import {
  isApiMode,
  apiLogin,
  apiRegister,
  apiLogout,
  apiFeed,
  apiCreatePost,
  apiLike,
  apiUnlike,
  apiAddComment,
  apiListComments,
  apiMe,
  apiGetUser,
  apiUpdateMe,
  clearTokens,
  getAccessToken,
  ApiError,
  type ApiUser,
  type ApiFeedItem,
  type ApiComment,
} from '../lib/api'

interface Toast {
  id: string
  text: string
}

interface HubState {
  users: User[]
  posts: Post[]
  conversations: Conversation[]
  messages: Message[]
  market: MarketItem[]
  activities: Activity[]
  settings: AppSettings
  savedPostIds: string[]
  currentUserId: string | null
  resetCode: string | null
  resetContact: string | null
  toasts: Toast[]
  authReady: boolean
  feedCursor: string | null
  feedLoading: boolean

  bootstrapAuth: () => Promise<void>
  upsertCurrentUser: (apiUser: ApiUser) => void
  login: (login: string, password: string) => Promise<{ ok: boolean; error?: string }>
  register: (data: {
    name: string
    username: string
    contact: string
    password: string
  }) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  requestReset: (contact: string) => string
  confirmReset: (code: string, newPassword: string) => { ok: boolean; error?: string }
  clearReset: () => void

  createPost: (text: string, replyToId?: string, imageUrl?: string) => Promise<boolean>
  toggleLike: (postId: string) => Promise<void>
  toggleRepost: (postId: string) => void
  toggleSave: (postId: string) => void
  loadComments: (postId: string) => Promise<void>
  loadProfile: (usernameOrId: string) => Promise<User | null>

  sendMessage: (conversationId: string, text: string) => void
  ensureConversation: (otherUserId: string) => string
  markConversationRead: (conversationId: string) => void

  updateProfile: (
    patch: Partial<Pick<User, 'name' | 'bio' | 'avatar' | 'username'>>,
  ) => Promise<{ ok: boolean; error?: string }>
  updateSettings: (patch: Partial<AppSettings>) => void
  markActivitiesRead: () => void

  addToCartToast: (title: string) => void
  showToast: (text: string) => void
  dismissToast: (id: string) => void

  refreshFeed: (opts?: { silent?: boolean }) => Promise<void>
  loadMoreFeed: () => Promise<void>

  getUser: (id: string) => User | undefined
  getCurrentUser: () => User | null
}

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Fallback cap for tiny data-URL avatars; prefer /v1/media upload. */
const AVATAR_DATA_URL_MAX = 100 * 1024

function matchesLogin(user: User, login: string): boolean {
  const q = login.trim().toLowerCase()
  return (
    user.username.toLowerCase() === q ||
    user.email.toLowerCase() === q ||
    (user.phone ?? '').replace(/\D/g, '') === login.replace(/\D/g, '') ||
    user.name.toLowerCase() === q
  )
}

function mapApiUser(u: ApiUser): User {
  return {
    id: u.id,
    name: u.display_name || u.username,
    username: u.username,
    email: u.email ?? `${u.username}@hub.app`,
    phone: u.phone ?? undefined,
    password: '',
    avatar: u.avatar_url || undefined,
    bio: u.bio ?? '',
    followers: u.followers ?? 0,
    following: u.following ?? 0,
  }
}

function mapFeedItem(item: ApiFeedItem, viewerId: string | null): Post {
  const count = Math.max(0, item.likes | 0)
  const likeIds: string[] = []
  for (let i = 0; i < count; i++) likeIds.push(`anon_${item.id}_${i}`)
  if (item.liked_by_me && viewerId) {
    if (likeIds.length === 0) likeIds.push(viewerId)
    else likeIds[0] = viewerId
  } else if (viewerId) {
    const idx = likeIds.indexOf(viewerId)
    if (idx >= 0) likeIds.splice(idx, 1)
  }
  const commentCount = Math.max(0, item.comments | 0)
  const replies = Array.from({ length: commentCount }, (_, i) => `cmeta_${item.id}_${i}`)
  return {
    id: item.id,
    authorId: item.author_id,
    text: item.body,
    image: item.image_url || undefined,
    createdAt: item.created_at,
    likes: likeIds,
    reposts: [],
    replies,
  }
}

function mapComment(c: ApiComment, parentId: string): Post {
  return {
    id: c.id,
    authorId: c.author_id,
    text: c.body,
    createdAt: c.created_at,
    likes: [],
    reposts: [],
    replyToId: parentId,
    replies: [],
  }
}

function ensureAuthorStub(users: User[], authorId: string): User[] {
  if (users.some((u) => u.id === authorId)) return users
  const short = authorId.replace(/-/g, '').slice(0, 8)
  return [
    ...users,
    {
      id: authorId,
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

let bootstrapInFlight: Promise<void> | null = null

function apiSessionReset() {
  return {
    posts: [] as Post[],
    activities: [] as Activity[],
    conversations: [] as Conversation[],
    messages: [] as Message[],
    savedPostIds: [] as string[],
    feedCursor: null as string | null,
  }
}

export const useStore = create<HubState>()(
  persist(
    (set, get) => ({
      users: seedUsers,
      posts: seedPosts,
      conversations: seedConversations,
      messages: seedMessages,
      market: seedMarket,
      activities: seedActivities,
      settings: defaultSettings,
      savedPostIds: ['p2', 'p4'],
      currentUserId: null,
      resetCode: null,
      resetContact: null,
      toasts: [],
      authReady: !isApiMode(),
      feedCursor: null,
      feedLoading: false,

      bootstrapAuth: async () => {
        if (bootstrapInFlight) return bootstrapInFlight
        bootstrapInFlight = (async () => {
          if (!isApiMode()) {
            set({ authReady: true })
            return
          }
          const tok = getAccessToken()
          if (!tok) {
            set({
              authReady: true,
              currentUserId: null,
              ...apiSessionReset(),
            })
            return
          }
          try {
            const me = await apiMe()
            const user = mapApiUser(me)
            set((s) => ({
              currentUserId: user.id,
              users: [...s.users.filter((u) => u.id !== user.id), user],
              ...apiSessionReset(),
              authReady: true,
            }))
            await get().refreshFeed({ silent: true })
          } catch (e) {
            clearTokens()
            set({
              authReady: true,
              currentUserId: null,
              ...apiSessionReset(),
            })
            if (e instanceof ApiError && e.status !== 401) {
              get().showToast(e.message || 'Сессия недоступна')
            }
          }
        })()
        try {
          await bootstrapInFlight
        } finally {
          bootstrapInFlight = null
        }
      },

      upsertCurrentUser: (apiUser) => {
        const user = mapApiUser(apiUser)
        set((s) => ({
          currentUserId: user.id,
          users: [...s.users.filter((u) => u.id !== user.id), user],
        }))
      },

      login: async (login, password) => {
        if (isApiMode()) {
          try {
            const data = await apiLogin(login, password)
            if (!data.user) return { ok: false, error: 'Нет данных пользователя' }
            const user = mapApiUser(data.user)
            set((s) => ({
              currentUserId: user.id,
              users: [...s.users.filter((u) => u.id !== user.id), user],
              ...apiSessionReset(),
            }))
            await get().refreshFeed({ silent: true })
            return { ok: true }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Ошибка входа'
            return { ok: false, error: msg }
          }
        }

        const user = get().users.find((u) => matchesLogin(u, login))
        if (!user) {
          if (login.trim().length >= 3 && password.length >= 4) {
            set({ currentUserId: 'u1' })
            return { ok: true }
          }
          return { ok: false, error: 'Неверный логин или пароль' }
        }
        if (user.password !== password && password.length < 4) {
          return { ok: false, error: 'Неверный логин или пароль' }
        }
        if (user.password === password || password.length >= 4) {
          set({ currentUserId: user.id })
          return { ok: true }
        }
        return { ok: false, error: 'Неверный логин или пароль' }
      },

      register: async ({ name, username, contact, password }) => {
        if (isApiMode()) {
          try {
            const isEmail = contact.includes('@')
            const data = await apiRegister({
              username: username.trim(),
              display_name: name.trim(),
              email: isEmail ? contact.trim() : undefined,
              phone: isEmail ? undefined : contact.trim(),
              password,
            })
            if (!data.user) return { ok: false, error: 'Нет данных пользователя' }
            const user = mapApiUser(data.user)
            set((s) => ({
              currentUserId: user.id,
              users: [...s.users.filter((u) => u.id !== user.id), user],
              ...apiSessionReset(),
            }))
            await get().refreshFeed({ silent: true })
            return { ok: true }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Ошибка'
            return { ok: false, error: msg }
          }
        }

        const exists = get().users.some(
          (u) =>
            u.username.toLowerCase() === username.toLowerCase() ||
            u.email.toLowerCase() === contact.toLowerCase(),
        )
        if (exists) return { ok: false, error: 'Пользователь уже существует' }
        const id = genId('u')
        const isEmail = contact.includes('@')
        const user: User = {
          id,
          name: name.trim(),
          username: username.trim(),
          email: isEmail ? contact.trim() : `${username}@hub.app`,
          phone: isEmail ? undefined : contact.trim(),
          password,
          bio: '',
          followers: 0,
          following: 0,
        }
        set((s) => ({ users: [...s.users, user], currentUserId: id }))
        return { ok: true }
      },

      logout: async () => {
        if (isApiMode()) {
          await apiLogout()
          set({ currentUserId: null, ...apiSessionReset() })
        } else {
          clearTokens()
          set({ currentUserId: null })
        }
      },

      requestReset: (contact) => {
        const code = String(Math.floor(100000 + Math.random() * 900000))
        set({ resetCode: code, resetContact: contact.trim() })
        return code
      },

      confirmReset: (code, newPassword) => {
        const { resetCode, resetContact, users } = get()
        if (!resetCode || code !== resetCode) {
          return { ok: false, error: 'Неверный код' }
        }
        if (newPassword.length < 4) {
          return { ok: false, error: 'Пароль слишком короткий' }
        }
        const updated = users.map((u) => {
          if (
            matchesLogin(u, resetContact ?? '') ||
            u.email.toLowerCase() === (resetContact ?? '').toLowerCase()
          ) {
            return { ...u, password: newPassword }
          }
          return u
        })
        set({ users: updated, resetCode: null, resetContact: null })
        return { ok: true }
      },

      clearReset: () => set({ resetCode: null, resetContact: null }),

      createPost: async (text, replyToId, imageUrl) => {
        const uid = get().currentUserId
        if (!uid || !text.trim()) return false

        if (isApiMode()) {
          try {
            if (replyToId) {
              const created = await apiAddComment(replyToId, text.trim())
              const post = mapComment(created, replyToId)
              set((s) => {
                let users = ensureAuthorStub(s.users, created.author_id)
                const withoutMeta = s.posts.filter(
                  (p) => !(p.replyToId === replyToId && p.id.startsWith('cmeta_')),
                )
                let posts = [post, ...withoutMeta]
                posts = posts.map((p) => {
                  if (p.id !== replyToId) return p
                  const replies = [...p.replies.filter((id) => !id.startsWith('cmeta_')), created.id]
                  return { ...p, replies }
                })
                return { posts, users }
              })
            } else {
              const created = await apiCreatePost(text.trim(), imageUrl)
              const post = mapFeedItem(created, uid)
              set((s) => ({
                posts: [post, ...s.posts],
                users: ensureAuthorStub(s.users, created.author_id),
              }))
              // Ensure feed stays in sync with server (and other clients)
              await get().refreshFeed({ silent: true })
            }
            return true
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Не удалось опубликовать'
            get().showToast(msg)
            return false
          }
        }

        const id = genId('p')
        const post: Post = {
          id,
          authorId: uid,
          text: text.trim(),
          image: imageUrl,
          createdAt: new Date().toISOString(),
          likes: [],
          reposts: [],
          replyToId,
          replies: [],
        }
        set((s) => {
          let posts = [post, ...s.posts]
          if (replyToId) {
            posts = posts.map((p) =>
              p.id === replyToId ? { ...p, replies: [...p.replies, id] } : p,
            )
          }
          return { posts }
        })
        return true
      },

      toggleLike: async (postId) => {
        const uid = get().currentUserId
        if (!uid) return

        if (isApiMode()) {
          const post = get().posts.find((p) => p.id === postId)
          if (!post) return
          const viewerLiked = post.likes.includes(uid)
          // optimistic
          set((s) => ({
            posts: s.posts.map((p) => {
              if (p.id !== postId) return p
              return {
                ...p,
                likes: viewerLiked
                  ? p.likes.filter((id) => id !== uid)
                  : [...p.likes, uid],
              }
            }),
          }))
          try {
            if (viewerLiked) await apiUnlike(postId)
            else await apiLike(postId)
          } catch (e) {
            // rollback
            set((s) => ({
              posts: s.posts.map((p) => {
                if (p.id !== postId) return p
                return {
                  ...p,
                  likes: viewerLiked
                    ? [...p.likes, uid]
                    : p.likes.filter((id) => id !== uid),
                }
              }),
            }))
            const msg = e instanceof Error ? e.message : 'Ошибка лайка'
            get().showToast(msg)
          }
          return
        }

        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId) return p
            const liked = p.likes.includes(uid)
            return {
              ...p,
              likes: liked ? p.likes.filter((id) => id !== uid) : [...p.likes, uid],
            }
          }),
        }))
      },

      toggleRepost: (postId) => {
        const uid = get().currentUserId
        if (!uid) return
        if (isApiMode()) {
          get().showToast('Репосты на сервере скоро')
          return
        }
        const was = get().posts.find((p) => p.id === postId)?.reposts.includes(uid)
        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId) return p
            const done = p.reposts.includes(uid)
            return {
              ...p,
              reposts: done ? p.reposts.filter((id) => id !== uid) : [...p.reposts, uid],
            }
          }),
        }))
        get().showToast(was ? 'Репост отменён' : 'Репостнуто')
      },

      toggleSave: (postId) => {
        set((s) => {
          const has = s.savedPostIds.includes(postId)
          return {
            savedPostIds: has
              ? s.savedPostIds.filter((id) => id !== postId)
              : [...s.savedPostIds, postId],
          }
        })
      },

      loadComments: async (postId) => {
        if (!isApiMode()) return
        try {
          const data = await apiListComments(postId)
          set((s) => {
            let users = s.users
            const mapped = data.items.map((c) => {
              users = ensureAuthorStub(users, c.author_id)
              return mapComment(c, postId)
            })
            const keep = s.posts.filter(
              (p) =>
                !(p.replyToId === postId) &&
                !(p.id.startsWith(`cmeta_${postId}_`)),
            )
            const parent = keep.find((p) => p.id === postId)
            const posts = keep.map((p) =>
              p.id === postId
                ? { ...p, replies: mapped.map((m) => m.id) }
                : p,
            )
            void parent
            return { posts: [...mapped, ...posts], users }
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Не удалось загрузить комментарии'
          get().showToast(msg)
        }
      },

      loadProfile: async (usernameOrId) => {
        if (!isApiMode()) {
          return (
            get().users.find(
              (u) => u.id === usernameOrId || u.username === usernameOrId,
            ) ?? null
          )
        }
        try {
          const raw = await apiGetUser(usernameOrId)
          const user = mapApiUser(raw)
          set((s) => ({
            users: [...s.users.filter((u) => u.id !== user.id), user],
          }))
          return user
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null
          const msg = e instanceof Error ? e.message : 'Профиль недоступен'
          get().showToast(msg)
          return null
        }
      },

      sendMessage: (conversationId, text) => {
        if (isApiMode()) {
          get().showToast('Сообщения на сервере скоро')
          return
        }
        const uid = get().currentUserId
        if (!uid || !text.trim()) return
        const msg: Message = {
          id: genId('m'),
          conversationId,
          senderId: uid,
          text: text.trim(),
          createdAt: new Date().toISOString(),
          read: true,
        }
        set((s) => ({
          messages: [...s.messages, msg],
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, lastMessageAt: msg.createdAt } : c,
          ),
        }))
      },

      ensureConversation: (otherUserId) => {
        if (isApiMode()) {
          get().showToast('Сообщения на сервере скоро')
          return ''
        }
        const uid = get().currentUserId!
        const existing = get().conversations.find(
          (c) =>
            c.participantIds.includes(uid) && c.participantIds.includes(otherUserId),
        )
        if (existing) return existing.id
        const id = genId('c')
        set((s) => ({
          conversations: [
            {
              id,
              participantIds: [uid, otherUserId],
              lastMessageAt: new Date().toISOString(),
            },
            ...s.conversations,
          ],
        }))
        return id
      },

      markConversationRead: (conversationId) => {
        const uid = get().currentUserId
        if (!uid) return
        set((s) => ({
          messages: s.messages.map((m) =>
            m.conversationId === conversationId && m.senderId !== uid
              ? { ...m, read: true }
              : m,
          ),
        }))
      },

      updateProfile: async (patch) => {
        const uid = get().currentUserId
        if (!uid) return { ok: false, error: 'Нет сессии' }

        if (isApiMode()) {
          try {
            const body: {
              display_name?: string
              username?: string
              bio?: string
              avatar_url?: string
            } = {}
            if (patch.name !== undefined) body.display_name = patch.name
            if (patch.username !== undefined) body.username = patch.username
            if (patch.bio !== undefined) body.bio = patch.bio
            if (patch.avatar !== undefined) {
              const av = patch.avatar ?? ''
              if (av.startsWith('data:') && av.length > AVATAR_DATA_URL_MAX) {
                return {
                  ok: false,
                  error: 'Фото слишком большое для data:URL (макс. ~100 КБ). Загрузите через медиа.',
                }
              }
              body.avatar_url = av
            }
            const updated = await apiUpdateMe(body)
            const user = mapApiUser(updated)
            set((s) => {
              const prev = s.users.find((u) => u.id === user.id)
              const merged = prev ? { ...prev, ...user } : user
              return {
                users: [...s.users.filter((u) => u.id !== user.id), merged],
              }
            })
            return { ok: true }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Не удалось сохранить'
            return { ok: false, error: msg }
          }
        }

        set((s) => {
          const exists = s.users.some((u) => u.id === uid)
          if (!exists) return s
          return {
            users: s.users.map((u) => (u.id === uid ? { ...u, ...patch } : u)),
          }
        })
        return { ok: true }
      },

      updateSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
      },

      markActivitiesRead: () => {
        set((s) => ({
          activities: s.activities.map((a) => ({ ...a, read: true })),
        }))
      },

      addToCartToast: (title) => {
        get().showToast(`«${title}» в корзине · оплата демо, без эквайринга`)
      },

      showToast: (text) => {
        const id = genId('t')
        set((s) => ({ toasts: [...s.toasts, { id, text }] }))
        setTimeout(() => get().dismissToast(id), 2800)
      },

      dismissToast: (id) => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      },

      refreshFeed: async (opts) => {
        if (isApiMode()) {
          set({ feedLoading: true })
          try {
            const data = await apiFeed(40)
            const uid = get().currentUserId
            let users = get().users
            const posts = data.items.map((item) => {
              users = ensureAuthorStub(users, item.author_id)
              return mapFeedItem(item, uid)
            })
            // Keep locally loaded reply posts that still match parents
            const parentIds = new Set(posts.map((p) => p.id))
            const replies = get().posts.filter(
              (p) => p.replyToId && parentIds.has(p.replyToId) && !p.id.startsWith('cmeta_'),
            )
            set({
              posts: [...posts, ...replies],
              users,
              feedCursor: data.next_cursor ?? null,
              feedLoading: false,
            })
            if (!opts?.silent) get().showToast('Лента обновлена')
          } catch (e) {
            set({ feedLoading: false })
            const msg = e instanceof Error ? e.message : 'Не удалось обновить ленту'
            get().showToast(msg)
          }
          return
        }

        set((s) => {
          const roots = s.posts.filter((p) => !p.replyToId)
          const replies = s.posts.filter((p) => p.replyToId)
          const shuffled = [...roots].sort(() => Math.random() - 0.5)
          return { posts: [...shuffled, ...replies] }
        })
        if (!opts?.silent) get().showToast('Лента обновлена')
      },

      loadMoreFeed: async () => {
        if (!isApiMode()) return
        const cursor = get().feedCursor
        if (!cursor || get().feedLoading) return
        set({ feedLoading: true })
        try {
          const data = await apiFeed(40, cursor)
          const uid = get().currentUserId
          let users = get().users
          const more = data.items.map((item) => {
            users = ensureAuthorStub(users, item.author_id)
            return mapFeedItem(item, uid)
          })
          set((s) => {
            const existing = new Set(s.posts.map((p) => p.id))
            const unique = more.filter((p) => !existing.has(p.id))
            return {
              posts: [...s.posts.filter((p) => !p.replyToId), ...unique, ...s.posts.filter((p) => p.replyToId)],
              users,
              feedCursor: data.next_cursor ?? null,
              feedLoading: false,
            }
          })
        } catch (e) {
          set({ feedLoading: false })
          const msg = e instanceof Error ? e.message : 'Не удалось подгрузить ленту'
          get().showToast(msg)
        }
      },

      getUser: (id) => get().users.find((u) => u.id === id),
      getCurrentUser: () => {
        const id = get().currentUserId
        return id ? get().users.find((u) => u.id === id) ?? null : null
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        users: s.users,
        posts: isApiMode() ? [] : s.posts,
        conversations: isApiMode() ? [] : s.conversations,
        messages: isApiMode() ? [] : s.messages,
        market: s.market,
        activities: isApiMode() ? [] : s.activities,
        settings: s.settings,
        savedPostIds: s.savedPostIds,
        // Never persist session id in API mode — token in sessionStorage is source of truth
        currentUserId: isApiMode() ? null : s.currentUserId,
      }),
    },
  ),
)
