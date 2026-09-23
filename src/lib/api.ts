const ACCESS_KEY = 'hub_access_token'
const REFRESH_KEY = 'hub_refresh_token'
const USE_API_KEY = 'hub_use_api'

let accessTokenMem: string | null = null

export function isApiMode(): boolean {
  if (typeof window !== 'undefined') {
    const ls = window.localStorage.getItem(USE_API_KEY)
    if (ls === 'true') return true
    if (ls === 'false') return false
  }
  return import.meta.env.VITE_USE_API === 'true'
}

export function apiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL
  if (fromEnv !== undefined && String(fromEnv).trim() !== '') {
    return String(fromEnv).replace(/\/$/, '')
  }
  // Same-origin (Vite proxy /v1 → API) — works on phone via Cloudflare tunnel
  return ''
}

export function getAccessToken(): string | null {
  if (accessTokenMem) return accessTokenMem
  if (typeof sessionStorage !== 'undefined') {
    accessTokenMem = sessionStorage.getItem(ACCESS_KEY)
  }
  return accessTokenMem
}

export function getRefreshToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(REFRESH_KEY)
}

export function setTokens(access: string, refresh?: string | null) {
  accessTokenMem = access
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(ACCESS_KEY, access)
    if (refresh) sessionStorage.setItem(REFRESH_KEY, refresh)
  }
}

export function clearTokens() {
  accessTokenMem = null
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(ACCESS_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
  }
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type FetchOpts = {
  method?: string
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
}

async function tryRefresh(): Promise<boolean> {
  const refresh = getRefreshToken()
  if (!refresh) return false
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refresh_token: refresh }),
    })
    if (!res.ok) {
      clearTokens()
      return false
    }
    const data = (await res.json()) as {
      access_token: string
      refresh_token?: string
    }
    setTokens(data.access_token, data.refresh_token ?? refresh)
    return true
  } catch {
    return false
  }
}

export async function apiFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false) {
    const tok = getAccessToken()
    if (tok) headers.Authorization = `Bearer ${tok}`
  }

  const doFetch = () =>
    fetch(`${apiBaseUrl()}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })

  let res = await doFetch()
  if (res.status === 401 && opts.auth !== false && getRefreshToken()) {
    const ok = await tryRefresh()
    if (ok) {
      const tok = getAccessToken()
      if (tok) headers.Authorization = `Bearer ${tok}`
      res = await doFetch()
    }
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  if (!res.ok) {
    const errObj = data as {
      error?: string | { code?: string; message?: string }
      message?: string
      code?: string
    } | null
    const nested = typeof errObj?.error === 'object' && errObj?.error ? errObj.error : null
    const code =
      nested?.code ??
      (typeof errObj?.error === 'string' ? errObj.error : undefined) ??
      errObj?.code ??
      'error'
    const message = nested?.message ?? errObj?.message ?? (res.statusText || 'request failed')
    throw new ApiError(res.status, code, message)
  }
  return data as T
}

export type ApiUser = {
  id: string
  username: string
  display_name: string
  email?: string | null
  phone?: string | null
  bio?: string
  avatar_url?: string
  followers?: number
  following?: number
  posts_count?: number
  consent_152?: boolean
  is_following?: boolean
  is_blocked?: boolean
  is_admin?: boolean
  age?: number
  birth_date?: string
  gender?: 'male' | 'female' | string
  city?: string
  is_private?: boolean
  can_view?: boolean
  posts_locked?: boolean
  follow_requested?: boolean
  is_muted?: boolean
  about?: string
  services?: string
  links?: Array<string | { url?: string; title?: string }>
  show_city?: boolean
  show_birth_date?: boolean
  seller_rating?: number
  seller_reviews?: number
}

export type ApiSearchUser = {
  id: string
  username: string
  display_name: string
  avatar_url?: string
  age?: number
  gender?: string
  city?: string
  is_following?: boolean
}

export type ApiUserSearchParams = {
  q?: string
  name?: string
  age_min?: number
  age_max?: number
  gender?: string
  city?: string
  following?: boolean
  limit?: number
  cursor?: string | null
}

export type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  token_type: string
  user?: ApiUser
}

export type ApiFeedItem = {
  id: string
  author_id: string
  body: string
  image_url?: string
  image_urls?: string[]
  poll?: ApiPoll
  created_at: string
  likes: number
  comments: number
  liked_by_me?: boolean
  reposts?: number
  reposted_by_me?: boolean
  tags?: string[]
  status?: string
  scheduled_at?: string
  repost_of?: string
  original?: ApiFeedItem
  quote_text?: string
  is_quote?: boolean
  quote_post_id?: string
  views?: number
}

export type ApiComment = {
  id: string
  post_id: string
  author_id: string
  body: string
  created_at: string
}

export async function apiLogin(login: string, password: string): Promise<TokenResponse> {
  const data = await apiFetch<TokenResponse>('/v1/auth/login', {
    method: 'POST',
    body: { login, password },
    auth: false,
  })
  setTokens(data.access_token, data.refresh_token)
  return data
}

export async function apiRegister(input: {
  username?: string
  display_name: string
  email?: string
  phone?: string
  password: string
  invite_code?: string
}): Promise<TokenResponse> {
  const data = await apiFetch<TokenResponse>('/v1/auth/register', {
    method: 'POST',
    body: input,
    auth: false,
  })
  setTokens(data.access_token, data.refresh_token)
  return data
}

export async function apiLogout(): Promise<void> {
  const refresh = getRefreshToken()
  try {
    await apiFetch('/v1/auth/logout', {
      method: 'POST',
      body: { refresh_token: refresh ?? '' },
      auth: false,
    })
  } catch {
    // ignore network errors on logout
  } finally {
    clearTokens()
  }
}

export async function apiFeed(
  limit = 20,
  cursor?: string | null,
  tag?: string,
  mode: 'friends' | 'interesting' = 'friends',
): Promise<{ items: ApiFeedItem[]; next_cursor?: string | null }> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (cursor) q.set('cursor', cursor)
  if (tag) q.set('tag', tag)
  const path = mode === 'interesting' ? '/v1/feed/interesting' : '/v1/feed'
  return apiFetch(`${path}?${q.toString()}`)
}

export type ApiPollOption = { id: string; label: string; votes: number; voted?: boolean; position?: number }
export type ApiPoll = {
  id: string
  question: string
  multi?: boolean
  options: ApiPollOption[]
  total_votes?: number
  my_votes?: string[]
}

export async function apiCreatePost(
  body: string,
  imageUrl?: string,
  tags?: string[],
  opts?: {
    status?: string
    scheduled_at?: string
    repost_of?: string
    image_urls?: string[]
    poll?: { question: string; options: string[]; multi?: boolean }
  },
): Promise<ApiFeedItem> {
  const payload: Record<string, unknown> = { body }
  if (imageUrl) payload.image_url = imageUrl
  if (opts?.image_urls?.length) payload.image_urls = opts.image_urls
  if (tags?.length) payload.tags = tags
  if (opts?.status) payload.status = opts.status
  if (opts?.scheduled_at) payload.scheduled_at = opts.scheduled_at
  if (opts?.repost_of) payload.repost_of = opts.repost_of
  if (opts?.poll) payload.poll = opts.poll
  return apiFetch('/v1/posts', { method: 'POST', body: payload })
}

export async function apiDeletePost(postId: string): Promise<void> {
  await apiFetch(`/v1/posts/${postId}`, { method: 'DELETE' })
}

export type ApiMediaUpload = {
  id: string
  url: string
  content_type: string
  bytes: number
  created_at?: string
}

/** Multipart upload; browser sets multipart boundary (do not set Content-Type). */
export async function apiUploadMedia(file: File): Promise<ApiMediaUpload> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const tok = getAccessToken()
  if (tok) headers.Authorization = `Bearer ${tok}`

  const form = new FormData()
  form.append('file', file)

  const doFetch = () =>
    fetch(`${apiBaseUrl()}/v1/media/upload`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    })

  let res = await doFetch()
  if (res.status === 401 && getRefreshToken()) {
    // reuse refresh via a lightweight call
    const refresh = getRefreshToken()
    if (refresh) {
      try {
        const rr = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ refresh_token: refresh }),
        })
        if (rr.ok) {
          const data = (await rr.json()) as { access_token: string; refresh_token?: string }
          setTokens(data.access_token, data.refresh_token ?? refresh)
          const t2 = getAccessToken()
          if (t2) headers.Authorization = `Bearer ${t2}`
          res = await doFetch()
        } else {
          clearTokens()
        }
      } catch {
        /* ignore */
      }
    }
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }
  if (!res.ok) {
    const errObj = data as {
      error?: string | { code?: string; message?: string }
      message?: string
      code?: string
    } | null
    const nested = typeof errObj?.error === 'object' && errObj?.error ? errObj.error : null
    const code =
      nested?.code ??
      (typeof errObj?.error === 'string' ? errObj.error : undefined) ??
      errObj?.code ??
      'error'
    const message = nested?.message ?? errObj?.message ?? (res.statusText || 'upload failed')
    throw new ApiError(res.status, code, message)
  }
  return data as ApiMediaUpload
}

export async function apiLike(postId: string): Promise<void> {
  await apiFetch(`/v1/posts/${postId}/like`, { method: 'POST', body: {} })
}

export async function apiUnlike(postId: string): Promise<void> {
  await apiFetch(`/v1/posts/${postId}/like`, { method: 'DELETE' })
}

export async function apiRepost(postId: string): Promise<ApiFeedItem> {
  return apiFetch(`/v1/posts/${encodeURIComponent(postId)}/repost`, { method: "POST", body: {} })
}

export async function apiUnrepost(postId: string): Promise<ApiFeedItem> {
  return apiFetch(`/v1/posts/${encodeURIComponent(postId)}/repost`, { method: "DELETE" })
}

export async function apiListUserReposts(userId: string): Promise<{ items: ApiFeedItem[] }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/reposts`)
}


export async function apiListComments(postId: string): Promise<{ items: ApiComment[] }> {
  return apiFetch(`/v1/posts/${postId}/comments`, { auth: false })
}

export async function apiAddComment(postId: string, body: string): Promise<ApiComment> {
  return apiFetch(`/v1/posts/${postId}/comments`, { method: 'POST', body: { body } })
}

export async function apiMe(): Promise<ApiUser> {
  return apiFetch('/v1/users/me')
}

export async function apiGetUser(usernameOrId: string): Promise<ApiUser> {
  // Prefer auth so server can include is_following / is_blocked for current viewer
  return apiFetch(`/v1/users/${encodeURIComponent(usernameOrId)}`)
}

export async function apiSearchUsers(
  params: ApiUserSearchParams = {},
): Promise<{ items: ApiSearchUser[]; next_cursor?: string | null }> {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.name) q.set('name', params.name)
  if (params.age_min != null) q.set('age_min', String(params.age_min))
  if (params.age_max != null) q.set('age_max', String(params.age_max))
  if (params.gender && params.gender !== 'any') q.set('gender', params.gender)
  if (params.city) q.set('city', params.city)
  if (params.following) q.set('following', '1')
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.cursor) q.set('cursor', params.cursor)
  return apiFetch(`/v1/users/search?${q.toString()}`)
}

export async function apiUpdateMe(patch: {
  display_name?: string
  username?: string
  bio?: string
  avatar_url?: string
  birth_date?: string
  gender?: string
  city?: string
  is_private?: boolean
}): Promise<ApiUser> {
  return apiFetch('/v1/users/me', { method: 'PATCH', body: patch })
}

export type ApiFollowUser = {
  id: string
  username: string
  display_name: string
  avatar_url?: string
}

export async function apiListFollowers(userId: string): Promise<{ items: ApiFollowUser[] }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/followers`)
}

export async function apiListFollowingOf(userId: string): Promise<{ items: ApiFollowUser[] }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/following`)
}

export type ApiPeerUser = {
  id: string
  username: string
  display_name: string
  avatar_url?: string
}

export type ApiLastMessage = {
  id: string
  body: string
  sender_id: string
  created_at: string
}

export type ApiConversation = {
  id: string
  updated_at: string
  unread: number
  pinned?: boolean
  archived?: boolean
  folder?: string
  peer: ApiPeerUser
  last_message?: ApiLastMessage | null
}

export type ApiMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  media_url?: string
  edited_at?: string
  msg_type?: string
  duration_ms?: number
  read?: boolean
  reply_to_id?: string
  forward_of?: string
  reactions?: { emoji: string; count: number; mine?: boolean }[]
  expires_at?: string
  story_id?: string
  story_quote?: { story_id: string; body?: string; media_url?: string; author_id?: string }
}

export type ApiActivityItem = {
  id: string
  actor_id: string
  type: string
  post_id?: string | null
  meta?: { text?: string; comment_id?: string; [k: string]: unknown }
  created_at: string
  read: boolean
  read_at?: string | null
  actor: ApiPeerUser
}

export async function apiListConversations(): Promise<{ items: ApiConversation[] }> {
  return apiFetch('/v1/conversations')
}

export async function apiCreateConversation(input: {
  user_id?: string
  username?: string
}): Promise<ApiConversation> {
  return apiFetch('/v1/conversations', { method: 'POST', body: input })
}

export async function apiListMessages(
  conversationId: string,
  limit = 50,
  cursor?: string | null,
): Promise<{
  items: ApiMessage[]
  next_cursor?: string | null
  typing_user_id?: string
  peer_last_read_at?: string
}> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (cursor) q.set('cursor', cursor)
  return apiFetch(`/v1/conversations/${conversationId}/messages?${q.toString()}`)
}

export async function apiSendMessage(conversationId: string, body: string): Promise<ApiMessage> {
  return apiFetch(`/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body },
  })
}

export async function apiMarkConversationRead(conversationId: string): Promise<void> {
  await apiFetch(`/v1/conversations/${conversationId}/read`, { method: 'POST', body: {} })
}

export async function apiListActivity(
  filter: 'all' | 'follows' | 'replies' | 'mentions' = 'all',
  limit = 30,
  cursor?: string | null,
): Promise<{ items: ApiActivityItem[]; next_cursor?: string | null }> {
  const q = new URLSearchParams({ filter, limit: String(limit) })
  if (cursor) q.set('cursor', cursor)
  return apiFetch(`/v1/activity?${q.toString()}`)
}

export async function apiMarkActivityRead(opts?: { all?: boolean; ids?: string[] }): Promise<void> {
  await apiFetch('/v1/activity/read', {
    method: 'POST',
    body: opts?.ids?.length ? { ids: opts.ids } : { all: true },
  })
}

export async function apiAcceptConsent(): Promise<{ ok: boolean; consent_152: boolean }> {
  return apiFetch('/v1/users/me/consent', { method: 'POST', body: {} })
}

export async function apiFollow(userId: string): Promise<{ ok: boolean; following: boolean; requested?: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/follow`, {
    method: 'POST',
    body: {},
  })
}

export async function apiUnfollow(userId: string): Promise<{ ok: boolean; following: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/follow`, { method: 'DELETE' })
}

export async function apiBlock(userId: string): Promise<{ ok: boolean; blocked: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/block`, {
    method: 'POST',
    body: {},
  })
}

export async function apiUnblock(userId: string): Promise<{ ok: boolean; blocked: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/block`, { method: 'DELETE' })
}

export async function apiReportPost(
  postId: string,
  reason: string,
): Promise<{ id: string; post_id: string; reason: string }> {
  return apiFetch(`/v1/posts/${encodeURIComponent(postId)}/report`, {
    method: 'POST',
    body: { reason },
  })
}

export async function apiListFollowing(): Promise<{ items: string[] }> {
  return apiFetch('/v1/users/me/following')
}

export async function apiListBlocks(): Promise<{ items: string[] }> {
  return apiFetch('/v1/users/me/blocks')
}

/** Public: join waitlist (idempotent). */
export async function apiJoinWaitlist(email: string): Promise<{
  ok: boolean
  email: string
  created?: boolean
  id?: string
}> {
  return apiFetch('/v1/waitlist', {
    method: 'POST',
    body: { email },
    auth: false,
  })
}

/**
 * Public: validate invite code without consuming uses.
 * Seed code for private beta: HUB-BETA
 */
export async function apiValidateInvite(code: string): Promise<{ ok: boolean; code: string }> {
  return apiFetch('/v1/invite/validate', {
    method: 'POST',
    body: { code },
    auth: false,
  })
}



export type ModReport = {
  id: string
  reporter_id: string
  reporter?: string | null
  target_user_id?: string | null
  target?: string | null
  post_id?: string | null
  reason: string
  status: string
  created_at: string
}

export async function apiListModReports(): Promise<{ reports: ModReport[] }> {
  return apiFetch('/v1/mod/reports')
}

export async function apiSubscribePush(subscription: {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}): Promise<{ ok: boolean }> {
  return apiFetch('/v1/me/push', { method: 'POST', body: subscription })
}

export async function apiUnsubscribePush(endpoint: string): Promise<void> {
  await apiFetch('/v1/me/push', { method: 'DELETE', body: { endpoint } })
}

export async function apiListBookmarks(): Promise<{ items: ApiFeedItem[] }> {
  return apiFetch('/v1/me/bookmarks')
}

export async function apiListMyLikes(): Promise<{ items: ApiFeedItem[] }> {
  return apiFetch('/v1/me/likes')
}

export async function apiBookmark(postId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/posts/${encodeURIComponent(postId)}/bookmark`, { method: 'POST', body: {} })
}

export async function apiUnbookmark(postId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/posts/${encodeURIComponent(postId)}/bookmark`, { method: 'DELETE' })
}

export async function apiResolveModReport(id: string, status: string): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/v1/mod/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } })
}

export async function apiEditMessage(conversationId: string, msgId: string, body: string): Promise<ApiMessage> {
  return apiFetch(`/v1/conversations/${conversationId}/messages/${msgId}`, { method: 'PATCH', body: { body } })
}

export async function apiDeleteMessage(conversationId: string, msgId: string): Promise<void> {
  await apiFetch(`/v1/conversations/${conversationId}/messages/${msgId}`, { method: 'DELETE' })
}

export async function apiSendMessageMedia(conversationId: string, body: string, mediaUrl?: string): Promise<ApiMessage> {
  const payload: Record<string, unknown> = { body }
  if (mediaUrl) payload.media_url = mediaUrl
  return apiFetch(`/v1/conversations/${conversationId}/messages`, { method: 'POST', body: payload })
}
// —— N7 follow requests / private ——
export async function apiListFollowRequests(): Promise<{
  items: {
    id: string
    created_at: string
    from_user: ApiPeerUser
  }[]
}> {
  return apiFetch('/v1/follow-requests')
}

export async function apiApproveFollowRequest(id: string): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/v1/follow-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} })
}

export async function apiDenyFollowRequest(id: string): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/v1/follow-requests/${encodeURIComponent(id)}/deny`, { method: 'POST', body: {} })
}

export async function apiMuteUser(userId: string): Promise<{ ok: boolean; muted: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/mute`, { method: 'POST', body: {} })
}

export async function apiUnmuteUser(userId: string): Promise<{ ok: boolean; muted: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/mute`, { method: 'DELETE' })
}

export async function apiListMutes(): Promise<{ items: ApiPeerUser[] }> {
  return apiFetch('/v1/users/me/mutes')
}

export async function apiQuoteRepost(postId: string, quoteText: string): Promise<ApiFeedItem> {
  return apiFetch(`/v1/posts/${encodeURIComponent(postId)}/repost`, {
    method: 'POST',
    body: { quote_text: quoteText },
  })
}

export async function apiTyping(conversationId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/typing`, {
    method: 'POST',
    body: {},
  })
}

export async function apiMuteConversation(conversationId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/mute`, {
    method: 'POST',
    body: {},
  })
}

export async function apiUnmuteConversation(conversationId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/mute`, {
    method: 'DELETE',
  })
}

export async function apiSendVoice(
  conversationId: string,
  mediaUrl: string,
  durationMs: number,
): Promise<ApiMessage> {
  return apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: { msg_type: 'voice', media_url: mediaUrl, duration_ms: durationMs, body: '' },
  })
}

export type ApiStoryRingItem = {
  author: ApiPeerUser
  latest_story_id: string
  created_at: string
  seen: boolean
  is_me?: boolean
}

export type ApiStory = {
  id: string
  author_id: string
  body: string
  media_url?: string
  created_at: string
  expires_at: string
}

export async function apiListStoryRing(): Promise<{ items: ApiStoryRingItem[] }> {
  return apiFetch('/v1/stories')
}

export async function apiCreateStory(
  body: string,
  mediaUrl?: string,
  audience: 'all' | 'close_friends' = 'all',
): Promise<ApiStory> {
  const payload: Record<string, unknown> = { body, audience }
  if (mediaUrl) payload.media_url = mediaUrl
  return apiFetch('/v1/stories', { method: 'POST', body: payload })
}

export async function apiListUserStories(userId: string): Promise<{ items: ApiStory[] }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/stories`)
}

export async function apiDeleteStory(id: string): Promise<void> {
  await apiFetch(`/v1/stories/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function apiCreateDraftOrSchedule(input: {
  body: string
  image_url?: string
  tags?: string[]
  status: 'draft' | 'scheduled' | 'published'
  scheduled_at?: string
}): Promise<ApiFeedItem> {
  return apiFetch('/v1/posts', { method: 'POST', body: input })
}

export async function apiListDrafts(): Promise<{
  items: {
    id: string
    body: string
    status: string
    image_url?: string
    scheduled_at?: string
    created_at: string
    tags?: string[]
  }[]
}> {
  return apiFetch('/v1/me/drafts')
}

export async function apiPublishDraft(id: string): Promise<ApiFeedItem> {
  return apiFetch(`/v1/posts/${encodeURIComponent(id)}/publish`, { method: 'POST', body: {} })
}

export async function apiExplore(params: {
  q?: string
  tag?: string
  limit?: number
} = {}): Promise<{
  items: ApiFeedItem[]
  tags: { tag: string; count: number }[]
  q?: string
  tag?: string
}> {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.tag) q.set('tag', params.tag)
  if (params.limit) q.set('limit', String(params.limit))
  return apiFetch(`/v1/explore?${q.toString()}`)
}

export async function apiGetPost(id: string): Promise<ApiFeedItem> {
  return apiFetch(`/v1/posts/${encodeURIComponent(id)}`, { auth: false })
}


// --- S1–S5 wave ---

export async function apiListCloseFriends(): Promise<{
  items: { id: string; username: string; display_name: string; avatar_url?: string; added_at?: string }[]
}> {
  return apiFetch('/v1/me/close-friends')
}

export async function apiAddCloseFriend(userId: string): Promise<{ ok: boolean }> {
  return apiFetch('/v1/me/close-friends', { method: 'POST', body: { user_id: userId } })
}

export async function apiRemoveCloseFriend(userId: string): Promise<void> {
  await apiFetch(`/v1/me/close-friends/${userId}`, { method: 'DELETE' })
}

export async function apiCreateStoryAudience(
  body: string,
  mediaUrl?: string,
  audience: 'all' | 'close_friends' = 'all',
): Promise<ApiStory> {
  const payload: Record<string, unknown> = { body, audience }
  if (mediaUrl) payload.media_url = mediaUrl
  return apiFetch('/v1/stories', { method: 'POST', body: payload })
}

export type ApiClip = {
  id: string
  author_id: string
  caption: string
  media_url: string
  duration_ms: number
  created_at: string
  likes?: number
  liked_by_me?: boolean
  author?: { id: string; username: string; display_name: string; avatar_url?: string }
}

export async function apiListClips(): Promise<{ items: ApiClip[] }> {
  return apiFetch('/v1/clips')
}

export async function apiCreateClip(mediaUrl: string, caption = '', durationMs = 0): Promise<ApiClip> {
  return apiFetch('/v1/clips', {
    method: 'POST',
    body: { media_url: mediaUrl, caption, duration_ms: durationMs },
  })
}

export async function apiDeleteClip(id: string): Promise<void> {
  await apiFetch(`/v1/clips/${id}`, { method: 'DELETE' })
}

export async function apiLikeClip(id: string): Promise<{ likes: number; liked: boolean }> {
  return apiFetch(`/v1/clips/${id}/like`, { method: 'POST', body: {} })
}

export async function apiUnlikeClip(id: string): Promise<{ likes: number; liked: boolean }> {
  return apiFetch(`/v1/clips/${id}/like`, { method: 'DELETE' })
}

export type ApiChannel = {
  id: string
  slug: string
  title: string
  description: string
  rules: string
  owner_id: string
  members: number
  joined: boolean
  my_role?: 'owner' | 'admin' | 'member' | string
  created_at: string
}

export async function apiListChannels(mine = false): Promise<{ items: ApiChannel[] }> {
  return apiFetch(`/v1/channels${mine ? '?mine=1' : ''}`)
}

export async function apiCreateChannel(input: {
  title: string
  slug: string
  description?: string
  rules?: string
}): Promise<ApiChannel> {
  return apiFetch('/v1/channels', { method: 'POST', body: input })
}

export async function apiGetChannel(idOrSlug: string): Promise<ApiChannel> {
  return apiFetch(`/v1/channels/${idOrSlug}`)
}

export async function apiJoinChannel(id: string): Promise<{ ok: boolean; joined: boolean }> {
  return apiFetch(`/v1/channels/${id}/join`, { method: 'POST', body: {} })
}

export async function apiLeaveChannel(id: string): Promise<{ ok: boolean; joined: boolean }> {
  return apiFetch(`/v1/channels/${id}/join`, { method: 'DELETE' })
}

export async function apiListChannelPosts(id: string): Promise<{
  items: { id: string; author_id: string; body: string; created_at: string; author?: ApiPeerUser }[]
}> {
  return apiFetch(`/v1/channels/${id}/posts`)
}

export async function apiCreateChannelPost(
  id: string,
  body: string,
  poll?: { question: string; options: string[]; multi?: boolean },
): Promise<{ id: string; body: string; poll?: ApiPoll }> {
  const payload: Record<string, unknown> = { body }
  if (poll) payload.poll = poll
  return apiFetch(`/v1/channels/${id}/posts`, { method: 'POST', body: payload })
}

export async function apiDeleteChannelPost(channelId: string, postId: string): Promise<void> {
  await apiFetch(`/v1/channels/${channelId}/posts/${postId}`, { method: 'DELETE' })
}

export async function apiListChannelMembers(channelId: string): Promise<{
  items: { user_id: string; role: string; username: string; display_name: string; avatar_url?: string }[]
}> {
  return apiFetch(`/v1/channels/${channelId}/members`)
}

export async function apiKickChannelMember(channelId: string, userId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/channels/${channelId}/members/${userId}`, { method: 'DELETE' })
}

export async function apiPatchConversation(
  id: string,
  patch: { pinned?: boolean; archived?: boolean; folder?: 'inbox' | 'important' | 'archive' },
): Promise<{ ok: boolean; pinned?: boolean; archived?: boolean; folder?: string }> {
  return apiFetch(`/v1/conversations/${id}`, { method: 'PATCH', body: patch })
}

export async function apiReactMessage(conversationId: string, msgId: string, emoji: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/messages/${msgId}/reactions`, {
    method: 'POST',
    body: { emoji },
  })
}

export async function apiUnreactMessage(conversationId: string, msgId: string, emoji: string): Promise<void> {
  await apiFetch(
    `/v1/conversations/${conversationId}/messages/${msgId}/reactions?emoji=${encodeURIComponent(emoji)}`,
    { method: 'DELETE' },
  )
}

export async function apiForwardMessage(
  fromConversationId: string,
  messageId: string,
  toConversationId: string,
): Promise<ApiMessage> {
  return apiFetch(`/v1/conversations/${fromConversationId}/forward`, {
    method: 'POST',
    body: { message_id: messageId, to_conversation_id: toConversationId },
  })
}

export async function apiSendMessageFull(
  conversationId: string,
  input: {
    body?: string
    media_url?: string
    msg_type?: string
    duration_ms?: number
    reply_to_id?: string
    story_id?: string
  },
): Promise<ApiMessage> {
  return apiFetch(`/v1/conversations/${conversationId}/messages`, { method: 'POST', body: input })
}

export async function apiGetChatPrefs(): Promise<{
  theme_id: string
  appearance: string
  themes: { id: string; name: string; gradient: string[] }[]
}> {
  return apiFetch('/v1/me/chat-prefs')
}

export async function apiUpdateChatPrefs(themeId: string, appearance: string): Promise<{ ok: boolean }> {
  return apiFetch('/v1/me/chat-prefs', {
    method: 'PUT',
    body: { theme_id: themeId, appearance },
  })
}

export async function apiListConversationsFolder(
  folder?: string,
  archived = false,
): Promise<{ items: ApiConversation[] }> {
  const q = new URLSearchParams()
  if (folder) q.set('folder', folder)
  if (archived) q.set('archived', '1')
  const qs = q.toString()
  return apiFetch(`/v1/conversations${qs ? `?${qs}` : ''}`)
}


// --- S6–S11 / S17 ---
export async function apiListVoiceRooms(): Promise<{ items: any[] }> {
  return apiFetch('/v1/voice-rooms')
}
export async function apiCreateVoiceRoom(title: string, topic = ''): Promise<any> {
  return apiFetch('/v1/voice-rooms', { method: 'POST', body: { title, topic } })
}
export async function apiGetVoiceRoom(id: string): Promise<any> {
  return apiFetch(`/v1/voice-rooms/${id}`)
}
export async function apiJoinVoiceRoom(id: string): Promise<any> {
  return apiFetch(`/v1/voice-rooms/${id}/join`, { method: 'POST', body: {} })
}
export async function apiLeaveVoiceRoom(id: string): Promise<any> {
  return apiFetch(`/v1/voice-rooms/${id}/join`, { method: 'DELETE' })
}
export async function apiVoiceHeartbeat(id: string, muted?: boolean): Promise<any> {
  return apiFetch(`/v1/voice-rooms/${id}/heartbeat`, { method: 'POST', body: muted === undefined ? {} : { muted } })
}

export async function apiVoiceSignal(
  roomId: string,
  toUserId: string,
  kind: 'offer' | 'answer' | 'ice',
  payload: unknown,
): Promise<{ ok: boolean; id: string }> {
  return apiFetch(`/v1/voice-rooms/${roomId}/signal`, {
    method: 'POST',
    body: { to_user_id: toUserId, kind, payload },
  })
}

export async function apiVoicePollSignals(roomId: string): Promise<{
  items: { id: string; from_user_id: string; kind: 'offer' | 'answer' | 'ice'; payload: any; created_at: string }[]
  ice_servers?: { urls: string | string[] }[]
}> {
  return apiFetch(`/v1/voice-rooms/${roomId}/signals`)
}
export async function apiListMarketAds(params?: { city?: string; q?: string }): Promise<{ items: any[] }> {
  const q = new URLSearchParams()
  if (params?.city) q.set('city', params.city)
  if (params?.q) q.set('q', params.q)
  const qs = q.toString()
  return apiFetch(`/v1/market/ads${qs ? `?${qs}` : ''}`)
}
export async function apiCreateMarketAd(input: {
  title: string; description?: string; price: number; city?: string; category?: string; image_url?: string
}): Promise<any> {
  return apiFetch('/v1/market/ads', { method: 'POST', body: input })
}
export async function apiListSellerReviews(userId: string): Promise<{ items: any[]; average: number; count: number }> {
  return apiFetch(`/v1/users/${userId}/reviews`)
}
export async function apiCreateSellerReview(userId: string, rating: number, body = ''): Promise<any> {
  return apiFetch(`/v1/users/${userId}/reviews`, { method: 'POST', body: { rating, body } })
}
export async function apiListMeetups(city?: string): Promise<{ items: any[] }> {
  const q = city ? `?city=${encodeURIComponent(city)}` : ''
  return apiFetch(`/v1/meetups${q}`)
}
export async function apiCreateMeetup(input: {
  title: string; description?: string; city?: string; place?: string; starts_at: string
}): Promise<any> {
  return apiFetch('/v1/meetups', { method: 'POST', body: input })
}
export async function apiGetMeetup(id: string): Promise<any> {
  return apiFetch(`/v1/meetups/${id}`)
}
export async function apiMeetupGoing(id: string): Promise<{ ok: boolean; conversation_id?: string }> {
  return apiFetch(`/v1/meetups/${id}/going`, { method: 'POST', body: {} })
}
export async function apiMeetupCancel(id: string): Promise<any> {
  return apiFetch(`/v1/meetups/${id}/going`, { method: 'DELETE' })
}
export async function apiUnifiedSearch(q: string): Promise<{
  people: any[]; posts: any[]; tags: any[]; ads: any[]; empty_reason?: string; q: string
}> {
  return apiFetch(`/v1/search?q=${encodeURIComponent(q)}`)
}
export async function apiGetNotifPrefs(): Promise<any> {
  return apiFetch('/v1/me/notification-prefs')
}
export async function apiUpdateNotifPrefs(body: Record<string, unknown>): Promise<any> {
  return apiFetch('/v1/me/notification-prefs', { method: 'PUT', body })
}
export async function apiPatchProfileCard(body: Record<string, unknown>): Promise<any> {
  return apiFetch('/v1/users/me/card', { method: 'PATCH', body })
}


/* ===== Wave 3: S15 / S18 / S19 ===== */
export async function apiListSessions(): Promise<{ items: any[] }> {
  return apiFetch('/v1/me/sessions')
}
export async function apiRevokeSession(id: string): Promise<any> {
  return apiFetch(`/v1/me/sessions/${id}`, { method: 'DELETE' })
}
export async function apiLogoutEverywhere(): Promise<any> {
  return apiFetch('/v1/me/sessions/logout-all', { method: 'POST', body: {} })
}
export async function apiExportMyData(): Promise<any> {
  return apiFetch('/v1/me/export')
}
export async function apiNearby(opts?: {
  city?: string
  lat?: number
  lng?: number
}): Promise<{
  city: string
  mode?: string
  geo_consent?: boolean
  viewer?: { lat: number; lng: number }
  note?: string
  posts: any[]
  ads: any[]
  meetups: any[]
  markers?: { id: string; kind: string; title?: string; lat: number; lng: number; approx?: boolean }[]
}> {
  const q = new URLSearchParams()
  if (opts?.city) q.set('city', opts.city)
  if (opts?.lat != null) q.set('lat', String(opts.lat))
  if (opts?.lng != null) q.set('lng', String(opts.lng))
  const qs = q.toString()
  return apiFetch(`/v1/nearby${qs ? `?${qs}` : ''}`)
}
export async function apiListWidgets(userId: string): Promise<{ items: any[]; is_verified?: boolean }> {
  return apiFetch(`/v1/users/${userId}/widgets`)
}
export async function apiUpsertWidget(body: Record<string, unknown>): Promise<any> {
  return apiFetch('/v1/me/widgets', { method: 'POST', body })
}
export async function apiDeleteWidget(id: string): Promise<any> {
  return apiFetch(`/v1/me/widgets/${id}`, { method: 'DELETE' })
}

export async function apiVotePoll(pollId: string, optionId: string): Promise<ApiPoll> {
  return apiFetch(`/v1/polls/${pollId}/vote`, { method: 'POST', body: { option_id: optionId } })
}

export async function apiListBookmarkFolders(): Promise<{
  items: { id: string; name: string; count: number }[]
  unfiled: number
}> {
  return apiFetch('/v1/me/bookmark-folders')
}

export async function apiCreateBookmarkFolder(name: string): Promise<{ id: string; name: string }> {
  return apiFetch('/v1/me/bookmark-folders', { method: 'POST', body: { name } })
}

export async function apiMoveBookmark(postId: string, folderId: string | null): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/posts/${postId}/bookmark`, {
    method: 'PATCH',
    body: { folder_id: folderId },
  })
}

export async function apiListBookmarksInFolder(folderId?: string | null): Promise<{ items: ApiFeedItem[] }> {
  const q =
    folderId === null || folderId === 'unfiled'
      ? '?folder_id=unfiled'
      : folderId
        ? `?folder_id=${encodeURIComponent(folderId)}`
        : ''
  return apiFetch(`/v1/me/bookmarks${q}`)
}

export async function apiPinChatMessage(conversationId: string, messageId: string | null): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/pinned-message`, {
    method: 'PUT',
    body: { message_id: messageId },
  })
}

export async function apiListChatMedia(
  conversationId: string,
  type?: 'image' | 'voice' | 'video_note' | 'all',
): Promise<{ items: { id: string; media_url: string; msg_type: string; created_at: string; body?: string }[] }> {
  const q = type && type !== 'all' ? `?type=${type}` : ''
  return apiFetch(`/v1/conversations/${conversationId}/media${q}`)
}

export async function apiGetSavedMessages(): Promise<ApiConversation & { is_saved?: boolean }> {
  return apiFetch('/v1/conversations/saved')
}



// --- WAVE B2 ---
export async function apiGetDisappear(conversationId: string): Promise<{ disappear_hours: number | null; disappear_after_read: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/disappear`)
}
export async function apiSetDisappear(
  conversationId: string,
  body: { hours?: number | null; after_read?: boolean },
): Promise<{ ok: boolean; disappear_hours: number | null; disappear_after_read: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/disappear`, { method: 'PUT', body })
}
export async function apiScheduleDM(
  conversationId: string,
  body: string,
  scheduledAt: string,
): Promise<{ id: string; scheduled_at: string }> {
  return apiFetch(`/v1/conversations/${conversationId}/scheduled-messages`, {
    method: 'POST',
    body: { body, scheduled_at: scheduledAt },
  })
}
export async function apiListScheduledDMs(conversationId: string): Promise<{ items: { id: string; body: string; scheduled_at: string }[] }> {
  return apiFetch(`/v1/conversations/${conversationId}/scheduled-messages`)
}
export async function apiCancelScheduledDM(conversationId: string, sid: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/scheduled-messages/${sid}`, { method: 'DELETE' })
}
export async function apiUpdatePresence(status: string, text = ''): Promise<{ ok: boolean }> {
  return apiFetch('/v1/me/presence', { method: 'PUT', body: { status, text } })
}
export async function apiSendAttentionGift(postId: string, sticker = '✨'): Promise<{ ok: boolean; attention_count: number }> {
  return apiFetch(`/v1/posts/${postId}/attention`, { method: 'POST', body: { sticker } })
}
export async function apiSendProfileAttention(userId: string, sticker = '✨'): Promise<{ ok: boolean; attention_count: number }> {
  return apiFetch(`/v1/users/${userId}/attention`, { method: 'POST', body: { sticker } })
}
export async function apiModSetVerified(userId: string, verified: boolean): Promise<{ ok: boolean; is_verified: boolean }> {
  return apiFetch(`/v1/mod/users/${userId}/verified`, { method: 'PUT', body: { verified } })
}


// --- WAVE B3 ---
export async function apiSaveGeo(lat: number, lng: number): Promise<{ ok: boolean }> {
  return apiFetch('/v1/me/geo', { method: 'POST', body: { lat, lng, consent: true } })
}
export async function apiMatchContacts(phones: string[]): Promise<{ items: any[]; matched: number; note?: string }> {
  return apiFetch('/v1/contacts/match', { method: 'POST', body: { phones } })
}
export async function apiCreateGuestLink(label?: string): Promise<{ token: string; path: string; label: string }> {
  return apiFetch('/v1/me/guest-links', { method: 'POST', body: { label } })
}
export async function apiListGuestLinks(): Promise<{ items: { id: string; token: string; path: string; label: string }[] }> {
  return apiFetch('/v1/me/guest-links')
}
export async function apiRevokeGuestLink(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/me/guest-links/${id}`, { method: 'DELETE' })
}
export async function apiGuestView(token: string): Promise<any> {
  return apiFetch(`/v1/guest/${token}`)
}
export async function apiStartCall(conversationId: string): Promise<any> {
  return apiFetch(`/v1/conversations/${conversationId}/call`, { method: 'POST', body: { video: true } })
}
export async function apiEndCall(conversationId: string): Promise<any> {
  return apiFetch(`/v1/conversations/${conversationId}/call/end`, { method: 'POST', body: {} })
}
export async function apiGetCall(conversationId: string): Promise<any> {
  return apiFetch(`/v1/conversations/${conversationId}/call`)
}
export async function apiPostCallSignal(conversationId: string, toUserId: string, kind: string, payload: unknown): Promise<any> {
  return apiFetch(`/v1/conversations/${conversationId}/call/signal`, {
    method: 'POST',
    body: { to_user_id: toUserId, kind, payload },
  })
}
export async function apiPollCallSignals(conversationId: string): Promise<{ items: any[]; ice_servers: any[] }> {
  return apiFetch(`/v1/conversations/${conversationId}/call/signals`)
}
