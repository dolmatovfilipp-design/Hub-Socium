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
  apiDeletePost,
  apiLike,
  apiUnlike,
  apiAddComment,
  apiListComments,
  apiMe,
  apiGetUser,
  apiUpdateMe,
  apiRepost,
  apiUnrepost,
  apiBookmark,
  apiUnbookmark,
  apiAcceptConsent,
  apiFollow,
  apiUnfollow,
  apiBlock,
  apiReportPost,
  apiListFollowing,
  apiListBlocks,
  clearTokens,
  getAccessToken,
  ApiError,
  type ApiUser,
  type ApiFeedItem,
  type ApiComment,
} from '../lib/api'
import { getLocalConsent152, setLocalConsent152 } from '../lib/consent'

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
  hiddenPostIds: string[]
  hiddenAuthorIds: string[]
  restrictedAuthorIds: string[]
  blockedAuthorIds: string[]
  reportedPostIds: string[]
  interestedAuthorIds: string[]
  followingIds: string[]
  consent152: boolean
  currentUserId: string | null
  resetCode: string | null
  resetContact: string | null
  toasts: Toast[]
  authReady: boolean
  feedCursor: string | null
  feedFilterTag: string
  feedLoading: boolean

  bootstrapAuth: () => Promise<void>
  upsertCurrentUser: (apiUser: ApiUser) => void
  login: (login: string, password: string) => Promise<{ ok: boolean; error?: string }>
  register: (data: {
    name: string
    username?: string
    contact: string
    password: string
  }) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  requestReset: (contact: string) => string
  confirmReset: (code: string, newPassword: string) => { ok: boolean; error?: string }
  clearReset: () => void

  createPost: (text: string, replyToId?: string, imageUrl?: string, tags?: string[]) => Promise<boolean>
  toggleLike: (postId: string) => Promise<void>
  toggleRepost: (postId: string) => void
  toggleSave: (postId: string) => void
  markInterested: (authorId: string) => void
  hidePost: (postId: string) => void
  hideAuthor: (authorId: string) => void
  restrictAuthor: (authorId: string) => void
  blockAuthor: (authorId: string) => Promise<{ ok: boolean; error?: string }>
  reportPost: (postId: string, reason?: string) => Promise<{ ok: boolean; error?: string }>
  followUser: (userId: string) => Promise<{ ok: boolean; error?: string }>
  unfollowUser: (userId: string) => Promise<{ ok: boolean; error?: string }>
  acceptConsent152: () => Promise<{ ok: boolean; error?: string }>
  deletePost: (postId: string) => Promise<void>
  loadComments: (postId: string) => Promise<void>
  loadProfile: (usernameOrId: string) => Promise<User | null>

  sendMessage: (conversationId: string, text: string) => void
  ensureConversation: (otherUserId: string) => string
  markConversationRead: (conversationId: string) => void

  updateProfile: (
    patch: Partial<
      Pick<User, 'name' | 'bio' | 'avatar' | 'username' | 'birthDate' | 'gender' | 'city'>
    >,
  ) => Promise<{ ok: boolean; error?: string }>
  updateSettings: (patch: Partial<AppSettings>) => void
  markActivitiesRead: () => void
  removeActivity: (id: string) => void

  addToCartToast: (title: string) => void
  showToast: (text: string) => void
  dismissToast: (id: string) => void

  refreshFeed: (opts?: { silent?: boolean; tag?: string }) => Promise<void>
  loadMoreFeed: () => Promise<void>

  getUser: (id: string) => User | undefined
  getCurrentUser: () => User | null
}

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

/** Merge API user; drop seed stubs with the same username (u1/u2 vs UUID). */
function upsertUsers(users: User[], incoming: User): User[] {
  const uname = incoming.username.toLowerCase()
  return [
    ...users.filter(
      (u) => u.id !== incoming.id && u.username.toLowerCase() !== uname,
    ),
    incoming,
  ]
}

function slugFromName(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  let out = ''
  for (const ch of name.trim().toLowerCase()) {
    if (map[ch] !== undefined) out += map[ch]
    else if (/[a-z0-9]/.test(ch)) out += ch
    else if (ch === ' ' || ch === '-' || ch === '.' || ch === '_') out += '_'
  }
  out = out.replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 20)
  return out || 'user'
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
  const gender =
    u.gender === 'male' || u.gender === 'female' ? u.gender : u.gender ? '' : undefined
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
    isAdmin: !!u.is_admin,
    birthDate: u.birth_date || undefined,
    gender: gender as User['gender'],
    city: u.city || undefined,
    age: typeof u.age === 'number' ? u.age : undefined,
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
  const repostCount = Math.max(0, (item.reposts as number) | 0)
  const repostIds: string[] = []
  for (let i = 0; i < repostCount; i++) repostIds.push(`ranon_${item.id}_${i}`)
  if (item.reposted_by_me && viewerId) {
    if (repostIds.length === 0) repostIds.push(viewerId)
    else repostIds[0] = viewerId
  } else if (viewerId) {
    const ridx = repostIds.indexOf(viewerId)
    if (ridx >= 0) repostIds.splice(ridx, 1)
  }
  return {
    id: item.id,
    authorId: item.author_id,
    text: item.body,
    image: item.image_url || undefined,
    createdAt: item.created_at,
    likes: likeIds,
    reposts: repostIds,
    replies,
    tags: item.tags?.length ? item.tags : undefined,
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
    feedFilterTag: '',
  }
}

export const useStore = create<HubState>()(
  persist(
    (set, get) => ({
      users: isApiMode() ? [] : seedUsers,
      posts: seedPosts,
      conversations: seedConversations,
      messages: seedMessages,
      market: seedMarket,
      activities: seedActivities,
      settings: defaultSettings,
      savedPostIds: ['p2', 'p4'],
      hiddenPostIds: [],
      hiddenAuthorIds: [],
      restrictedAuthorIds: [],
      blockedAuthorIds: [],
      reportedPostIds: [],
      interestedAuthorIds: [],
      followingIds: [],
      consent152: getLocalConsent152(),
      currentUserId: null,
      resetCode: null,
      resetContact: null,
      toasts: [],
      authReady: !isApiMode(),
      feedCursor: null,
      feedFilterTag: '',
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
            const serverConsent = !!me.consent_152
            if (serverConsent) setLocalConsent152(true)
            const consent152 = serverConsent || getLocalConsent152()
            set(() => ({
              currentUserId: user.id,
              users: [user],
              ...apiSessionReset(),
              consent152,
              authReady: true,
              followingIds: [],
              blockedAuthorIds: [],
            }))
            try {
              const [following, blocks] = await Promise.all([
                apiListFollowing(),
                apiListBlocks(),
              ])
              set({
                followingIds: following.items ?? [],
                blockedAuthorIds: blocks.items ?? [],
              })
            } catch {
              /* optional social lists */
            }
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
          users: upsertUsers(s.users, user),
        }))
      },

      login: async (login, password) => {
        if (isApiMode()) {
          try {
            const data = await apiLogin(login, password)
            if (!data.user) return { ok: false, error: 'Нет данных пользователя' }
            let me = data.user
            try {
              me = await apiMe()
            } catch {
              /* use login payload */
            }
            const user = mapApiUser(me)
            const serverConsent = !!me.consent_152
            if (serverConsent) setLocalConsent152(true)
            set(() => ({
              currentUserId: user.id,
              users: [user],
              ...apiSessionReset(),
              consent152: serverConsent || getLocalConsent152(),
              followingIds: [],
              blockedAuthorIds: [],
            }))
            try {
              const [following, blocks] = await Promise.all([apiListFollowing(), apiListBlocks()])
              set({
                followingIds: following.items ?? [],
                blockedAuthorIds: blocks.items ?? [],
              })
            } catch {
              /* optional */
            }
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
            set({ currentUserId: 'u1', consent152: getLocalConsent152() })
            return { ok: true }
          }
          return { ok: false, error: 'Неверный логин или пароль' }
        }
        if (user.password !== password && password.length < 4) {
          return { ok: false, error: 'Неверный логин или пароль' }
        }
        if (user.password === password || password.length >= 4) {
          set({ currentUserId: user.id, consent152: getLocalConsent152() })
          return { ok: true }
        }
        return { ok: false, error: 'Неверный логин или пароль' }
      },

      register: async ({ name, username, contact, password }) => {
        if (isApiMode()) {
          try {
            const isEmail = contact.includes('@')
            const inviteCode =
              typeof sessionStorage !== 'undefined'
                ? sessionStorage.getItem('hub_invite_code')?.trim() || undefined
                : undefined
            const data = await apiRegister({
              ...(username?.trim() ? { username: username.trim() } : {}),
              display_name: name.trim(),
              email: isEmail ? contact.trim() : undefined,
              phone: isEmail ? undefined : contact.trim(),
              password,
              invite_code: inviteCode,
            })
            if (inviteCode && typeof sessionStorage !== 'undefined') {
              sessionStorage.removeItem('hub_invite_code')
            }
            if (!data.user) return { ok: false, error: 'Нет данных пользователя' }
            let me = data.user
            try {
              me = await apiMe()
            } catch {
              /* use register payload */
            }
            const user = mapApiUser(me)
            set(() => ({
              currentUserId: user.id,
              users: [user],
              ...apiSessionReset(),
              consent152: !!me.consent_152 || getLocalConsent152(),
              followingIds: [],
              blockedAuthorIds: [],
            }))
            await get().refreshFeed({ silent: true })
            return { ok: true }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Ошибка'
            return { ok: false, error: msg }
          }
        }

        const isEmail = contact.includes('@')
        let uname = (username?.trim() || slugFromName(name)).slice(0, 24)
        const taken = (u: string) =>
          get().users.some((x) => x.username.toLowerCase() === u.toLowerCase())
        if (taken(uname)) {
          let n = 2
          while (taken(`${uname}${n}`) && n < 999) n++
          uname = `${uname}${n}`.slice(0, 24)
        }
        if (
          get().users.some(
            (u) => u.email.toLowerCase() === contact.toLowerCase(),
          )
        ) {
          return { ok: false, error: 'Пользователь уже существует' }
        }
        const id = genId('u')
        const user: User = {
          id,
          name: name.trim(),
          username: uname,
          email: isEmail ? contact.trim() : `${uname}@hub.app`,
          phone: isEmail ? undefined : contact.trim(),
          password,
          bio: '',
          followers: 0,
          following: 0,
        }
        set((s) => ({
          users: [...s.users, user],
          currentUserId: id,
          consent152: getLocalConsent152(),
        }))
        return { ok: true }
      },

      logout: async () => {
        if (isApiMode()) {
          await apiLogout()
          set({
            currentUserId: null,
            ...apiSessionReset(),
            followingIds: [],
            consent152: getLocalConsent152(),
          })
        } else {
          clearTokens()
          set({ currentUserId: null, consent152: getLocalConsent152() })
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

      createPost: async (text, replyToId, imageUrl, tags) => {
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
              const created = await apiCreatePost(text.trim(), imageUrl, tags)
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
        const was = get().posts.find((p) => p.id === postId)?.reposts.includes(uid)
        set((st) => ({
          posts: st.posts.map((p) => {
            if (p.id !== postId) return p
            const done = p.reposts.includes(uid)
            return {
              ...p,
              reposts: done ? p.reposts.filter((id) => id !== uid) : [...p.reposts, uid],
            }
          }),
        }))
        if (isApiMode()) {
          void (async () => {
            try {
              if (was) await apiUnrepost(postId)
              else await apiRepost(postId)
              get().showToast(was ? 'Репост отменён' : 'Репостнуто')
            } catch (e) {
              set((st) => ({
                posts: st.posts.map((p) => {
                  if (p.id !== postId) return p
                  return {
                    ...p,
                    reposts: was
                      ? p.reposts.includes(uid)
                        ? p.reposts
                        : [...p.reposts, uid]
                      : p.reposts.filter((id) => id !== uid),
                  }
                }),
              }))
              get().showToast(e instanceof Error ? e.message : 'Ошибка репоста')
            }
          })()
          return
        }
        get().showToast(was ? 'Репост отменён' : 'Репостнуто')
      },

      toggleSave: (postId) => {
        const has = get().savedPostIds.includes(postId)
        set((s) => ({
          savedPostIds: has
            ? s.savedPostIds.filter((id) => id !== postId)
            : [...s.savedPostIds, postId],
        }))
        if (isApiMode()) {
          void (async () => {
            try {
              if (has) await apiUnbookmark(postId)
              else await apiBookmark(postId)
            } catch (e) {
              set((s) => ({
                savedPostIds: has
                  ? s.savedPostIds.includes(postId)
                    ? s.savedPostIds
                    : [...s.savedPostIds, postId]
                  : s.savedPostIds.filter((id) => id !== postId),
              }))
              get().showToast(e instanceof Error ? e.message : 'Ошибка закладки')
            }
          })()
        }
      },

      markInterested: (authorId) => {
        if (!authorId) return
        set((s) => ({
          interestedAuthorIds: s.interestedAuthorIds.includes(authorId)
            ? s.interestedAuthorIds
            : [...s.interestedAuthorIds, authorId],
        }))
      },

      hidePost: (postId) => {
        set((s) => ({
          hiddenPostIds: s.hiddenPostIds.includes(postId)
            ? s.hiddenPostIds
            : [...s.hiddenPostIds, postId],
        }))
      },

      hideAuthor: (authorId) => {
        if (!authorId) return
        set((s) => ({
          hiddenAuthorIds: s.hiddenAuthorIds.includes(authorId)
            ? s.hiddenAuthorIds
            : [...s.hiddenAuthorIds, authorId],
        }))
      },

      restrictAuthor: (authorId) => {
        if (!authorId) return
        set((s) => ({
          restrictedAuthorIds: s.restrictedAuthorIds.includes(authorId)
            ? s.restrictedAuthorIds
            : [...s.restrictedAuthorIds, authorId],
        }))
      },

      blockAuthor: async (authorId) => {
        if (!authorId) return { ok: false, error: 'Нет пользователя' }
        const applyLocal = () => {
          set((s) => ({
            blockedAuthorIds: s.blockedAuthorIds.includes(authorId)
              ? s.blockedAuthorIds
              : [...s.blockedAuthorIds, authorId],
            followingIds: s.followingIds.filter((id) => id !== authorId),
          }))
        }
        if (isApiMode()) {
          try {
            await apiBlock(authorId)
            applyLocal()
            return { ok: true }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Не удалось заблокировать'
            return { ok: false, error: msg }
          }
        }
        applyLocal()
        return { ok: true }
      },

      reportPost: async (postId, reason) => {
        if (!postId) return { ok: false, error: 'Нет публикации' }
        const applyLocal = () => {
          set((s) => ({
            reportedPostIds: s.reportedPostIds.includes(postId)
              ? s.reportedPostIds
              : [...s.reportedPostIds, postId],
            hiddenPostIds: s.hiddenPostIds.includes(postId)
              ? s.hiddenPostIds
              : [...s.hiddenPostIds, postId],
          }))
        }
        if (isApiMode()) {
          try {
            await apiReportPost(postId, reason?.trim() || 'other')
            applyLocal()
            return { ok: true }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Не удалось отправить жалобу'
            return { ok: false, error: msg }
          }
        }
        applyLocal()
        return { ok: true }
      },

      followUser: async (userId) => {
        if (!userId) return { ok: false, error: 'Нет пользователя' }
        const prevFollowers = get().users.find((u) => u.id === userId)?.followers
        const already = get().followingIds.includes(userId)
        const applyLocal = () => {
          set((s) => ({
            followingIds: s.followingIds.includes(userId)
              ? s.followingIds
              : [...s.followingIds, userId],
            users: s.users.map((u) =>
              u.id === userId && !already
                ? { ...u, followers: u.followers + 1 }
                : u,
            ),
          }))
        }
        const rollback = () => {
          set((s) => ({
            followingIds: already
              ? s.followingIds
              : s.followingIds.filter((id) => id !== userId),
            users: s.users.map((u) =>
              u.id === userId && prevFollowers !== undefined
                ? { ...u, followers: prevFollowers }
                : u,
            ),
          }))
        }
        applyLocal()
        if (isApiMode()) {
          try {
            await apiFollow(userId)
            await get().loadProfile(userId)
            return { ok: true }
          } catch (e) {
            rollback()
            const msg = e instanceof Error ? e.message : 'Не удалось подписаться'
            return { ok: false, error: msg }
          }
        }
        return { ok: true }
      },

      unfollowUser: async (userId) => {
        if (!userId) return { ok: false, error: 'Нет пользователя' }
        const prevFollowers = get().users.find((u) => u.id === userId)?.followers
        const wasFollowing = get().followingIds.includes(userId)
        const applyLocal = () => {
          set((s) => ({
            followingIds: s.followingIds.filter((id) => id !== userId),
            users: s.users.map((u) =>
              u.id === userId && wasFollowing
                ? { ...u, followers: Math.max(0, u.followers - 1) }
                : u,
            ),
          }))
        }
        const rollback = () => {
          set((s) => ({
            followingIds:
              wasFollowing && !s.followingIds.includes(userId)
                ? [...s.followingIds, userId]
                : s.followingIds,
            users: s.users.map((u) =>
              u.id === userId && prevFollowers !== undefined
                ? { ...u, followers: prevFollowers }
                : u,
            ),
          }))
        }
        applyLocal()
        if (isApiMode()) {
          try {
            await apiUnfollow(userId)
            await get().loadProfile(userId)
            return { ok: true }
          } catch (e) {
            rollback()
            const msg = e instanceof Error ? e.message : 'Не удалось отписаться'
            return { ok: false, error: msg }
          }
        }
        return { ok: true }
      },

      acceptConsent152: async () => {
        if (isApiMode()) {
          try {
            await apiAcceptConsent()
            setLocalConsent152(true)
            set({ consent152: true })
            return { ok: true }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Не удалось сохранить согласие'
            return { ok: false, error: msg }
          }
        }
        setLocalConsent152(true)
        set({ consent152: true })
        return { ok: true }
      },

      deletePost: async (postId) => {
        const post = get().posts.find((p) => p.id === postId)
        const uid = get().currentUserId
        if (!post || !uid || post.authorId !== uid) return

        const removeLocal = () => {
          set((s) => ({
            posts: s.posts.filter((p) => p.id !== postId && p.replyToId !== postId),
            savedPostIds: s.savedPostIds.filter((id) => id !== postId),
          }))
        }

        if (isApiMode()) {
          try {
            await apiDeletePost(postId)
            removeLocal()
          } catch (e) {
            removeLocal()
            const msg = e instanceof Error ? e.message : 'Не удалось удалить на сервере'
            get().showToast(msg)
          }
          return
        }

        removeLocal()
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
          set((s) => {
            let followingIds = s.followingIds
            if (typeof raw.is_following === 'boolean') {
              if (raw.is_following && !followingIds.includes(user.id)) {
                followingIds = [...followingIds, user.id]
              } else if (!raw.is_following) {
                followingIds = followingIds.filter((id) => id !== user.id)
              }
            }
            let blockedAuthorIds = s.blockedAuthorIds
            if (raw.is_blocked && !blockedAuthorIds.includes(user.id)) {
              blockedAuthorIds = [...blockedAuthorIds, user.id]
            }
            return {
              users: upsertUsers(s.users, user),
              followingIds,
              blockedAuthorIds,
            }
          })
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
          // API-mode Chat uses apiSendMessage directly
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
          // API-mode NewMessage uses apiCreateConversation directly
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
              birth_date?: string
              gender?: string
              city?: string
            } = {}
            if (patch.name !== undefined) body.display_name = patch.name
            if (patch.username !== undefined) body.username = patch.username
            if (patch.bio !== undefined) body.bio = patch.bio
            if (patch.birthDate !== undefined) body.birth_date = patch.birthDate ?? ''
            if (patch.gender !== undefined) body.gender = patch.gender ?? ''
            if (patch.city !== undefined) body.city = patch.city ?? ''
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
                users: upsertUsers(s.users.filter((u) => u.id !== user.id), merged),
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

      removeActivity: (id) => {
        set((s) => ({
          activities: s.activities.filter((a) => a.id !== id),
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
          set({ feedLoading: true, feedFilterTag: opts?.tag ?? '' })
          try {
            const tag = opts?.tag?.trim() || undefined
            const data = await apiFeed(40, null, tag)
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
          const tag = get().feedFilterTag?.trim() || undefined
          const data = await apiFeed(40, cursor, tag)
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

      getUser: (id) => {
        const byId = get().users.find((u) => u.id === id)
        if (byId) return byId
        const byName = get().users.filter((u) => u.username === id)
        return byName.find((u) => isUuid(u.id)) ?? byName[0]
      },
      getCurrentUser: () => {
        const id = get().currentUserId
        return id ? get().users.find((u) => u.id === id) ?? null : null
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        // API mode: do not persist users/following — local seeds collide with UUID profiles
        users: isApiMode() ? [] : s.users,
        posts: isApiMode() ? [] : s.posts,
        conversations: isApiMode() ? [] : s.conversations,
        messages: isApiMode() ? [] : s.messages,
        market: s.market,
        activities: isApiMode() ? [] : s.activities,
        settings: s.settings,
        savedPostIds: isApiMode() ? [] : s.savedPostIds,
        hiddenPostIds: s.hiddenPostIds,
        hiddenAuthorIds: s.hiddenAuthorIds,
        restrictedAuthorIds: s.restrictedAuthorIds,
        blockedAuthorIds: isApiMode() ? [] : s.blockedAuthorIds,
        reportedPostIds: s.reportedPostIds,
        interestedAuthorIds: s.interestedAuthorIds,
        followingIds: isApiMode() ? [] : s.followingIds,
        // Never persist session id in API mode — token in sessionStorage is source of truth
        currentUserId: isApiMode() ? null : s.currentUserId,
      }),
    },
  ),
)
