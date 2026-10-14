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

/** iOS drops sessionStorage when it unloads a tab or PWA. Tokens live in localStorage. */
function migrateTokensFromSession() {
  if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') return
  for (const key of [ACCESS_KEY, REFRESH_KEY]) {
    const legacy = sessionStorage.getItem(key)
    if (legacy && !localStorage.getItem(key)) localStorage.setItem(key, legacy)
    if (legacy) sessionStorage.removeItem(key)
  }
}

migrateTokensFromSession()
if (typeof localStorage !== 'undefined') {
  accessTokenMem = localStorage.getItem(ACCESS_KEY)
}

export function getAccessToken(): string | null {
  if (accessTokenMem) return accessTokenMem
  if (typeof localStorage !== 'undefined') {
    accessTokenMem = localStorage.getItem(ACCESS_KEY)
  }
  return accessTokenMem
}

export function getRefreshToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY)
}

function persistAccessCookie(access: string | null) {
  if (typeof document === 'undefined') return
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  if (!access) {
    document.cookie = `hub_access_token=; Path=/; Max-Age=0; SameSite=Lax${secure}`
    return
  }
  document.cookie = `hub_access_token=${encodeURIComponent(access)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`
}

export function setTokens(access: string, refresh?: string | null) {
  accessTokenMem = access
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(ACCESS_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
  }
  persistAccessCookie(access)
}

export function clearTokens() {
  accessTokenMem = null
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(ACCESS_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
  }
  persistAccessCookie(null)
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

function hasCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text)
}

/** User-facing copy. Server strings that are already Russian stay as they are. */
export function localizeApiError(status: number, code: string, message: string): string {
  const raw = (message || '').trim()
  if (status === 429 || code === 'rate_limited' || /too many requests/i.test(raw) || /slow down/i.test(raw)) {
    return 'Слишком много запросов. Подождите немного.'
  }
  if (raw && hasCyrillic(raw)) return raw
  if (status === 401) return 'Нужно войти снова'
  if (status === 403) return 'Недостаточно прав'
  if (status === 404) return 'Не найдено'
  if (status === 400 || status === 422) return 'Проверьте данные и попробуйте снова'
  if (status >= 500) return 'Сервер временно недоступен'
  return 'Не удалось выполнить запрос'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(), ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

let refreshInFlight: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function doRefresh(): Promise<boolean> {
  const refresh = getRefreshToken()
  if (!refresh) return false
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refresh_token: refresh }),
    })
    // Refresh tokens rotate. Parallel 401s must share this call; a 5xx must not
    // log the user out, or heartbeat/chat-prefs/incoming wipe a live session.
    if (res.status === 401 || res.status === 403) {
      clearTokens()
      return false
    }
    if (!res.ok) return false
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

// Bots, forum topics, live rooms, and E2E devices are intentionally excluded.
const EXCLUDED_FEATURE = /\/v1\/conversations\/[^/?]+\/(?:bots|topics|live)(?:\/|$)|\/v1\/e2e\/devices/

export async function apiFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  if (EXCLUDED_FEATURE.test(path.split('?')[0])) {
    throw new ApiError(404, 'not_found', 'feature excluded')
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false) {
    const tok = getAccessToken()
    if (tok) {
      headers.Authorization = `Bearer ${tok}`
      headers['X-Access-Token'] = tok
    }
  }

  const method = (opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')).toUpperCase()
  const idempotent = method === 'GET' || method === 'HEAD'
  const doFetch = () =>
    fetch(`${apiBaseUrl()}${path}`, {
      method,
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
      if (tok) {
        headers.Authorization = `Bearer ${tok}`
        headers['X-Access-Token'] = tok
      }
      res = await doFetch()
    }
  }
  // Retry only safe reads. A message POST must not be sent again after 429.
  if (res.status === 429 && idempotent) {
    for (let attempt = 1; attempt <= 2 && res.status === 429; attempt++) {
      await sleep(350 * attempt, opts.signal)
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
    const message = localizeApiError(
      res.status,
      code,
      nested?.message ?? errObj?.message ?? (res.statusText || ''),
    )
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
  country?: string
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
  show_gender?: boolean
  show_country?: boolean
  show_contact?: boolean
  email_verified?: boolean
  phone_verified?: boolean
  seller_rating?: number
  seller_reviews?: number
  show_adult?: boolean
  parental_enabled?: boolean
  last_seen_at?: string
  last_seen_label?: string
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
  is_verified?: boolean
  followers?: number
}

export type ApiUserSearchParams = {
  q?: string
  name?: string
  age_min?: number
  age_max?: number
  gender?: string
  city?: string
  following?: boolean
  /** Empty Поиск screen: limited people list with follower counts. */
  recommended?: boolean
  limit?: number
  cursor?: string | null
}

export type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  token_type: string
  user?: ApiUser
  verification_required?: boolean
  dev_code?: string
  message?: string
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
  age_rating?: 'all' | '12' | '18' | string
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
  referred_by?: string
  gender?: string
  birth_date?: string
  country?: string
  city?: string
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
    age_rating?: 'all' | '12' | '18'
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
  if (opts?.age_rating) payload.age_rating = opts.age_rating
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
  filename?: string
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
    // Same single-flight refresh as apiFetch. A 5xx must not rotate or clear tokens.
    const ok = await tryRefresh()
    if (ok) {
      const t2 = getAccessToken()
      if (t2) headers.Authorization = `Bearer ${t2}`
      res = await doFetch()
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

export async function apiListUserPosts(userId: string): Promise<{ items: ApiFeedItem[]; posts_locked?: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/posts`)
}

export async function apiListUserComments(userId: string): Promise<{ items: ApiComment[]; posts_locked?: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/comments`)
}

export async function apiListMutuals(userId: string): Promise<{ items: ApiFollowUser[] }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/mutuals`)
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
  if (params.recommended) q.set('recommended', '1')
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
  country?: string
  email?: string
  phone?: string
  email_verified?: boolean
  phone_verified?: boolean
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
  is_verified?: boolean
  is_bot?: boolean
  is_deleted?: boolean
  last_seen_at?: string
  last_seen_label?: string
  gender?: string
}

export type ApiLastMessage = {
  id: string
  body: string
  sender_id: string
  created_at: string
  msg_type?: string
  call_meta?: import('./callMeta').CallMeta | null
  client_id?: string
}

export type ApiConversation = {
  id: string
  updated_at: string
  unread: number
  pinned?: boolean
  archived?: boolean
  folder?: string
  is_group?: boolean
  title?: string
  avatar_url?: string
  member_count?: number
  peer: ApiPeerUser
  last_message?: ApiLastMessage | null
}

export type ChatPoll = {
  question: string
  options: { idx: number; label: string; votes: number; voted?: boolean; voters?: string[] }[]
  multiple: boolean
  anonymous: boolean
  closed: boolean
  total_voters: number
  my_votes: number[]
  can_close?: boolean
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
  view_once?: 'sent' | 'sealed' | 'opened' | string
  thread_root_id?: string
  thread_count?: number
  story_id?: string
  story_quote?: { story_id: string; body?: string; media_url?: string; author_id?: string }
  delivered?: boolean
  meta?: Record<string, unknown> | null
  sender_name?: string
  sender_username?: string
  conversation_title?: string
  is_group?: boolean
  sender?: { id: string; username: string; display_name: string; avatar_url?: string }
  poll?: ChatPoll
  transcript?: ApiTranscript
  call_meta?: import('./callMeta').CallMeta | null
  client_id?: string
}

export type ApiLinkPreview = {
  url: string
  ok: boolean
  title: string
  description: string
  image_url: string
  site_name: string
  final_url: string
}

export type ApiMessageReader = {
  user_id: string
  username: string
  display_name: string
  avatar_url?: string
  read_at: string
}

export type ApiMessageEdits = {
  items: { id: string; body: string; edited_at: string }[]
  body: string
  created_at: string
  edited_at?: string
}

export type ApiTranscript = {
  message_id: string
  status: 'pending' | 'processing' | 'done' | 'failed' | 'none' | string
  text?: string
  error?: string
}

export type ApiFeatures = {
  transcribe?: boolean
  translate?: boolean
  ai?: boolean
  payments?: boolean
  stickers?: boolean
}

let featuresCache: Promise<ApiFeatures> | null = null

export async function apiFeatures(): Promise<ApiFeatures> {
  if (!featuresCache) {
    featuresCache = apiFetch<ApiFeatures>('/v1/features').catch((err) => {
      featuresCache = null
      throw err
    })
  }
  return featuresCache
}

export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = Math.floor(Math.random() * 16)
    const v = ch === 'x' ? n : (n & 0x3) | 0x8
    return v.toString(16)
  })
}

export async function apiRequestTranscript(conversationId: string, messageId: string): Promise<ApiTranscript> {
  return apiFetch(
    `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/transcript`,
    { method: 'POST', body: {} },
  )
}

export async function apiGetTranscript(conversationId: string, messageId: string): Promise<ApiTranscript> {
  return apiFetch(
    `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/transcript`,
  )
}

export async function apiTranslateMessage(
  conversationId: string,
  messageId: string,
  target = 'ru',
): Promise<{ text: string; source?: string }> {
  return apiFetch(
    `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/translate`,
    { method: 'POST', body: { target } },
  )
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

export async function apiListConversations(opts?: {
  inbox?: 'inbox' | 'request' | 'hidden'
  q?: string
  unread?: boolean
}): Promise<{ items: ApiConversation[] }> {
  const q = new URLSearchParams()
  if (opts?.inbox) q.set('inbox', opts.inbox)
  if (opts?.q) q.set('q', opts.q)
  if (opts?.unread) q.set('unread', '1')
  const qs = q.toString()
  return apiFetch(`/v1/conversations${qs ? `?${qs}` : ''}`)
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
  peer_last_seen_at?: string
  peer_last_seen_label?: string
}> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (cursor) q.set('cursor', cursor)
  return apiFetch(`/v1/conversations/${conversationId}/messages?${q.toString()}`)
}

export async function apiSendMessage(
  conversationId: string,
  body: string,
  clientId?: string,
): Promise<ApiMessage> {
  return apiSendMessageFull(conversationId, { body, client_id: clientId || newClientId() })
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

export async function apiListBlocks(): Promise<{
  items: string[]
  users?: { id: string; username: string; display_name: string; avatar_url?: string }[]
}> {
  return apiFetch('/v1/users/me/blocks')
}

export async function apiMyReferral(): Promise<{
  ok: boolean
  code: string
  ref: string
  path: string
  message: string
}> {
  return apiFetch('/v1/me/referral')
}

export type ArchiveItemType = 'post' | 'message' | 'contact' | 'listing' | 'photo' | 'video'

export type ArchiveItem = {
  id: string
  type: ArchiveItemType
  ref_id: string
  title: string
  preview: string
  meta?: Record<string, unknown>
  created_at?: string
}

export async function apiListArchive(type?: ArchiveItemType): Promise<{ items: ArchiveItem[] }> {
  const q = type ? `?type=${encodeURIComponent(type)}` : ''
  return apiFetch(`/v1/me/archive${q}`)
}

export async function apiAddArchive(body: {
  type: ArchiveItemType
  ref_id: string
  title?: string
  preview?: string
  meta?: Record<string, unknown>
}): Promise<{ ok: boolean; id: string; type: string; ref_id: string }> {
  return apiFetch('/v1/me/archive', { method: 'POST', body })
}

export async function apiRemoveArchive(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/me/archive/${id}`, { method: 'DELETE' })
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

export async function apiPushPublicKey(): Promise<{ public_key: string }> {
  return apiFetch('/v1/push/vapid', { auth: false })
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

export async function apiTestPush(): Promise<{ ok: boolean; subscriptions?: number }> {
  return apiFetch('/v1/me/push/test', { method: 'POST', body: {} })
}

export async function apiRequestPasswordReset(
  contact: string,
): Promise<{ ok: boolean; message?: string; dev_code?: string; dev_note?: string }> {
  return apiFetch('/v1/auth/password-reset/request', {
    method: 'POST',
    auth: false,
    body: { contact },
  })
}

export async function apiConfirmPasswordReset(
  contact: string,
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; message?: string }> {
  return apiFetch('/v1/auth/password-reset/confirm', {
    method: 'POST',
    auth: false,
    body: { contact, code, new_password: newPassword },
  })
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

export async function apiHideMessage(conversationId: string, msgId: string): Promise<void> {
  await apiFetch(`/v1/conversations/${conversationId}/messages/${msgId}/hide`, { method: 'POST', body: {} })
}

export async function apiSearchMessages(
  q: string,
  conversationId?: string,
): Promise<{ items: ApiMessage[]; next_cursor?: string | null }> {
  const params = new URLSearchParams({ q })
  if (conversationId) params.set('conversation_id', conversationId)
  return apiFetch(`/v1/messages/search?${params.toString()}`)
}

export async function apiLinkPreview(url: string): Promise<ApiLinkPreview> {
  return apiFetch(`/v1/link-preview?url=${encodeURIComponent(url)}`)
}

export async function apiMessageReaders(
  conversationId: string,
  msgId: string,
): Promise<{ items: ApiMessageReader[] }> {
  return apiFetch(`/v1/conversations/${conversationId}/messages/${msgId}/readers`)
}

export async function apiMessageEdits(conversationId: string, msgId: string): Promise<ApiMessageEdits> {
  return apiFetch(`/v1/conversations/${conversationId}/messages/${msgId}/edits`)
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
  clientId?: string,
): Promise<ApiMessage> {
  return apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: {
      msg_type: 'voice',
      media_url: mediaUrl,
      duration_ms: durationMs,
      body: '',
      client_id: clientId || newClientId(),
    },
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
  filter_id?: string
  place_name?: string
  media_kind?: string
  audience?: string
}

export async function apiListStoryRing(): Promise<{ items: ApiStoryRingItem[] }> {
  return apiFetch('/v1/stories')
}

export async function apiCreateStory(
  body: string,
  mediaUrl?: string,
  audience: 'all' | 'close_friends' = 'all',
  extras?: { filter_id?: string; place_name?: string; media_kind?: string },
): Promise<ApiStory> {
  const payload: Record<string, unknown> = { body, audience }
  if (mediaUrl) payload.media_url = mediaUrl
  if (extras?.filter_id) payload.filter_id = extras.filter_id
  if (extras?.place_name) payload.place_name = extras.place_name
  if (extras?.media_kind) payload.media_kind = extras.media_kind
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
  price_minor?: number
  subscribed?: boolean
  payments?: boolean
}

export async function apiListChannels(mine = false): Promise<{ items: ApiChannel[] }> {
  return apiFetch(`/v1/channels${mine ? '?mine=1' : ''}`)
}

export async function apiCreateChannel(input: {
  title: string
  slug: string
  description?: string
  rules?: string
  price_minor?: number
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
  priceMinor?: number,
): Promise<{ id: string; body: string; poll?: ApiPoll }> {
  const payload: Record<string, unknown> = { body }
  if (poll) payload.poll = poll
  if (priceMinor) payload.price_minor = priceMinor
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

export async function apiSetChannelMemberRole(
  channelId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<{ ok: boolean; user_id: string; role: string }> {
  return apiFetch(`/v1/channels/${channelId}/members/${userId}`, {
    method: 'PATCH',
    body: { role },
  })
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
    meta?: Record<string, unknown>
    poll?: { question: string; options: string[]; multiple?: boolean; anonymous?: boolean }
    view_once?: boolean
    thread_root_id?: string
    client_id?: string
  },
): Promise<ApiMessage> {
  return apiFetch(`/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { ...input, client_id: input.client_id || newClientId() },
  })
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
export async function apiUnifiedSearch(q: string): Promise<{
  people: any[]; posts: any[]; tags: any[]; ads: any[]; empty_reason?: string; q: string
}> {
  return apiFetch(`/v1/search?q=${encodeURIComponent(q)}`)
}
export async function apiRequestEmailVerify(): Promise<{ ok: boolean; message?: string; dev_code?: string; email_verified?: boolean }> {
  return apiFetch('/v1/me/email/verify/request', { method: 'POST', body: {} })
}
export async function apiConfirmEmailVerify(code: string): Promise<{ ok: boolean; email_verified?: boolean; message?: string }> {
  return apiFetch('/v1/me/email/verify/confirm', { method: 'POST', body: { code } })
}
export async function apiDeleteAccount(password: string): Promise<{ ok: boolean; purged_at?: string }> {
  return apiFetch('/v1/me/delete', { method: 'POST', body: { password } })
}
export async function apiGetContentPrefs(): Promise<{
  show_adult: boolean
  parental_enabled: boolean
  hide_stories?: boolean
  age_gate_note?: boolean
  has_pin?: boolean
}> {
  return apiFetch('/v1/me/content-prefs')
}
export async function apiUpdateContentPrefs(body: {
  show_adult?: boolean
  parental_enabled?: boolean
  hide_stories?: boolean
  age_gate_note?: boolean
}): Promise<{
  ok: boolean
  show_adult: boolean
  parental_enabled: boolean
  hide_stories?: boolean
  age_gate_note?: boolean
  has_pin?: boolean
}> {
  return apiFetch('/v1/me/content-prefs', { method: 'PUT', body })
}
export async function apiHeartbeat(): Promise<{ ok: boolean; last_seen_at?: string; last_seen_label?: string }> {
  return apiFetch('/v1/me/heartbeat', { method: 'POST', body: {} })
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
  type?: 'image' | 'voice' | 'video_note' | 'file' | 'all',
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
export async function apiSavePhone(phone: string): Promise<{ ok: boolean; phone?: string | null; note?: string }> {
  return apiFetch('/v1/me/phone', { method: 'PUT', body: { phone } })
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
export type ApiIceServer = { urls: string | string[]; username?: string; credential?: string }

export type ApiCallSession = {
  ok?: boolean
  active?: boolean
  call_id?: string
  conversation_id?: string
  peer_id?: string
  initiator_id?: string
  status?: string
  video?: boolean
  role?: 'caller' | 'callee'
  ice_servers?: ApiIceServer[]
}

export type ApiIncomingCall = {
  call_id: string
  conversation_id: string
  video: boolean
  status: string
  created_at: string
  initiator_id: string
  peer_id: string
  initiator: { id: string; username: string; display_name: string; avatar_url?: string }
}

export async function apiStartCall(conversationId: string, video = true): Promise<ApiCallSession> {
  return apiFetch(`/v1/conversations/${conversationId}/call`, { method: 'POST', body: { video } })
}
export async function apiAnswerCall(conversationId: string): Promise<ApiCallSession> {
  return apiFetch(`/v1/conversations/${conversationId}/call/answer`, { method: 'POST', body: {} })
}
export async function apiDeclineCall(conversationId: string): Promise<{ ok: boolean; ended?: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/call/decline`, { method: 'POST', body: {} })
}
export async function apiEndCall(conversationId: string): Promise<any> {
  return apiFetch(`/v1/conversations/${conversationId}/call/end`, { method: 'POST', body: {} })
}
export async function apiListIncomingCalls(): Promise<{ items: ApiIncomingCall[]; ice_servers?: ApiIceServer[] }> {
  return apiFetch('/v1/me/calls/incoming')
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


export async function apiCreateGroup(input: {
  title: string
  member_ids?: string[]
  avatar_url?: string
}): Promise<ApiConversation> {
  return apiFetch('/v1/conversations/group', { method: 'POST', body: input })
}

export type GroupPermissions = {
  send: 'all' | 'admins'
  add: 'all' | 'admins'
  info: 'all' | 'admins'
  pin: 'all' | 'admins'
}

export async function apiListGroupMembers(conversationId: string): Promise<{
  items: (ApiPeerUser & { role?: string; online?: boolean; last_seen_at?: string })[]
  is_group: boolean
  title: string
  avatar_url: string
  am_admin: boolean
  my_role?: string
  member_count?: number
  max_members?: number
  can_invite?: boolean
  can_edit_info?: boolean
  can_pin?: boolean
  permissions?: GroupPermissions
}> {
  return apiFetch(`/v1/conversations/${conversationId}/members`)
}

export async function apiInviteGroupMembers(conversationId: string, userIds: string[]): Promise<{ ok: boolean; invited: number }> {
  return apiFetch(`/v1/conversations/${conversationId}/members`, {
    method: 'POST',
    body: { user_ids: userIds },
  })
}

export async function apiKickGroupMember(conversationId: string, userId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export async function apiPatchGroup(
  conversationId: string,
  patch: {
    title?: string
    avatar_url?: string
    pinned?: boolean
    archived?: boolean
    folder?: string
    perm_send?: 'all' | 'admins'
    perm_add?: 'all' | 'admins'
    perm_info?: 'all' | 'admins'
    perm_pin?: 'all' | 'admins'
  },
): Promise<{ ok: boolean; title?: string; avatar_url?: string }> {
  return apiFetch(`/v1/conversations/${conversationId}`, { method: 'PATCH', body: patch })
}

export async function apiAcceptGroupInvite(conversationId: string): Promise<{ ok: boolean; conversation_id: string }> {
  return apiFetch(`/v1/conversations/${conversationId}/invites/accept`, { method: 'POST', body: {} })
}

export async function apiDeclineGroupInvite(conversationId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/invites/decline`, { method: 'POST', body: {} })
}

export async function apiSetGroupMemberRole(
  conversationId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<{ ok: boolean; role: string }> {
  return apiFetch(`/v1/conversations/${conversationId}/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { role },
  })
}

export type GroupInviteLink = {
  token: string
  conversation_id: string
  title: string
  avatar_url?: string
  member_count: number
  max_members: number
  uses: number
  path: string
  expires_at?: string
  max_uses?: number
  already_member?: boolean
}

export async function apiCreateGroupInviteLink(
  conversationId: string,
  input: { expires_in_hours?: number; max_uses?: number } = {},
): Promise<GroupInviteLink> {
  return apiFetch(`/v1/conversations/${conversationId}/invite-links`, { method: 'POST', body: input })
}

export async function apiListGroupInviteLinks(conversationId: string): Promise<{ items: GroupInviteLink[] }> {
  return apiFetch(`/v1/conversations/${conversationId}/invite-links`)
}

export async function apiRevokeGroupInviteLink(conversationId: string, token: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${conversationId}/invite-links/${encodeURIComponent(token)}`, { method: 'DELETE' })
}

export async function apiPreviewGroupInviteLink(token: string): Promise<GroupInviteLink> {
  return apiFetch(`/v1/invite-links/${encodeURIComponent(token)}`)
}

export async function apiJoinGroupInviteLink(token: string): Promise<{ ok: boolean; already?: boolean; conversation_id: string }> {
  return apiFetch(`/v1/invite-links/${encodeURIComponent(token)}/join`, { method: 'POST', body: {} })
}

export async function apiVoteChatPoll(
  conversationId: string,
  messageId: string,
  optionIdx: number,
): Promise<{ ok: boolean; poll?: ChatPoll }> {
  return apiFetch(`/v1/conversations/${conversationId}/messages/${messageId}/poll/vote`, {
    method: 'POST',
    body: { option_idx: optionIdx },
  })
}

export async function apiCloseChatPoll(
  conversationId: string,
  messageId: string,
): Promise<{ ok: boolean; poll?: ChatPoll }> {
  return apiFetch(`/v1/conversations/${conversationId}/messages/${messageId}/poll/close`, {
    method: 'POST',
    body: {},
  })
}


/** LLM compose assist — no-op / disabled when server has no key. Never used for feed ranking. */
export async function apiComposeAssist(
  text: string,
): Promise<{ suggestion?: string; disabled?: boolean; message?: string }> {
  return apiFetch('/v1/assist/compose', { method: 'POST', body: { text } })
}

export async function apiReportUser(
  userId: string,
  reason = 'other',
): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/users/${encodeURIComponent(userId)}/report`, {
    method: 'POST',
    body: { reason },
  })
}

/** YooKassa checkout. 503 when YOOKASSA_* keys are missing. */
export async function apiCreateDemoPayment(opts: {
  amount_rub: number
  description?: string
  return_url?: string
}): Promise<{ ok: boolean; demo?: boolean; confirmation_url?: string; message?: string; payment_id?: string }> {
  return apiFetch('/v1/payments/yookassa/demo', { method: 'POST', body: opts })
}

export async function apiRequestContactCode(contact: string, channel: 'email' | 'phone'): Promise<{ ok: boolean; message?: string }> {
  return apiFetch('/v1/auth/contact-code/request', { method: 'POST', body: { contact, channel }, auth: false })
}

export async function apiConfirmContactCode(contact: string, code: string): Promise<{ ok: boolean; verified?: boolean }> {
  return apiFetch('/v1/auth/contact-code/confirm', { method: 'POST', body: { contact, code }, auth: false })
}

export async function apiDeleteActivity(id: string): Promise<void> {
  await apiFetch(`/v1/activity/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function apiGetMessagePrefs(): Promise<{ message_policy: string; hidden_words: string }> {
  return apiFetch('/v1/me/message-prefs')
}

export async function apiUpdateMessagePrefs(body: { message_policy?: string; hidden_words?: string }): Promise<{ message_policy: string; hidden_words: string }> {
  return apiFetch('/v1/me/message-prefs', { method: 'PUT', body })
}

export async function apiListFeedSignals(): Promise<{ items: { kind: string; user_id?: string; post_id?: string }[] }> {
  return apiFetch('/v1/me/feed-signals')
}

export async function apiPutFeedSignal(body: { kind: string; user_id?: string; post_id?: string }): Promise<{ ok: boolean }> {
  return apiFetch('/v1/me/feed-signals', { method: 'POST', body })
}

export async function apiUpdateParental(body: {
  enabled?: boolean
  pin?: string
  new_pin?: string
  age_gate_note?: boolean
}): Promise<{ ok: boolean; parental_enabled: boolean; age_gate_note: boolean; show_adult: boolean; has_pin: boolean }> {
  return apiFetch('/v1/me/parental', { method: 'PUT', body })
}

export async function apiSetRequestState(conversationId: string, action: 'accept' | 'hide'): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/request`, { method: 'POST', body: { action } })
}

export async function apiListMusic(): Promise<{ items: { id: string; title: string; artist: string; url: string }[] }> {
  return apiFetch('/v1/me/music')
}

export async function apiCreateMusic(body: { title: string; artist?: string; url: string }): Promise<{ id: string; title: string; artist: string; url: string }> {
  return apiFetch('/v1/me/music', { method: 'POST', body })
}

export async function apiDeleteMusic(id: string): Promise<void> {
  await apiFetch(`/v1/me/music/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function apiMarkDelivered(conversationId: string): Promise<void> {
  await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/delivered`, { method: 'POST', body: {} })
}

export async function apiCancelFollowRequest(userId: string): Promise<void> {
  await apiFetch(`/v1/users/${encodeURIComponent(userId)}/follow-request`, { method: 'DELETE' })
}

export type BusinessMedia = { url: string; kind: 'photo' | 'video'; position?: number }
export type BusinessSpec = { key: string; value: string; position?: number }
export type BusinessSeller = {
  id: string
  username: string
  display_name: string
  avatar_url?: string
  rating: number
}
export type BusinessProduct = {
  id: string
  seller_id: string
  title: string
  price: number
  old_price?: number
  short_text: string
  description: string
  category: string
  city: string
  stock: number
  status: string
  views: number
  rating: number
  review_count: number
  like_count: number
  liked: boolean
  created_at: string
  seller: BusinessSeller
  media: BusinessMedia[]
  specs: BusinessSpec[]
}
export type BusinessReview = {
  id: string
  body: string
  sentiment: '' | 'positive' | 'negative'
  created_at: string
  author: { id: string; username: string; display_name: string; avatar_url?: string }
}
export type BusinessOrder = {
  id: string
  status: string
  created_at: string
  conversation_id: string
  product_id: string
  title: string
  price: number
  buyer: { username: string; display_name: string }
}

export type BusinessDraft = {
  title: string
  price: number
  old_price?: number | null
  short_text?: string
  description?: string
  category?: string
  city?: string
  stock?: number
  status?: string
  media?: { url: string; kind: string }[]
  specs?: { key: string; value: string }[]
}

export async function apiGetBusinessProfile(): Promise<{ business_mode: boolean }> {
  return apiFetch('/v1/business/profile')
}

export async function apiSetBusinessMode(enabled: boolean): Promise<{ business_mode: boolean }> {
  return apiFetch('/v1/business/profile', { method: 'PUT', body: { enabled } })
}

export async function apiListBusinessProducts(params?: {
  q?: string
  category?: string
  city?: string
  price_min?: number
  price_max?: number
  rating_min?: number
  sort?: string
  mine?: boolean
}): Promise<{ items: BusinessProduct[] }> {
  const q = new URLSearchParams()
  if (params?.q) q.set('q', params.q)
  if (params?.category) q.set('category', params.category)
  if (params?.city) q.set('city', params.city)
  if (params?.price_min) q.set('price_min', String(params.price_min))
  if (params?.price_max) q.set('price_max', String(params.price_max))
  if (params?.rating_min) q.set('rating_min', String(params.rating_min))
  if (params?.sort) q.set('sort', params.sort)
  if (params?.mine) q.set('mine', '1')
  const qs = q.toString()
  return apiFetch(`/v1/business/products${qs ? `?${qs}` : ''}`)
}

export async function apiCreateBusinessProduct(body: BusinessDraft): Promise<BusinessProduct> {
  return apiFetch('/v1/business/products', { method: 'POST', body })
}

export async function apiUpdateBusinessProduct(id: string, body: BusinessDraft): Promise<BusinessProduct> {
  return apiFetch(`/v1/business/products/${encodeURIComponent(id)}`, { method: 'PATCH', body })
}

export async function apiDeleteBusinessProduct(id: string): Promise<void> {
  await apiFetch(`/v1/business/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function apiLikeBusinessProduct(id: string): Promise<{ liked: boolean; like_count: number; rating: number }> {
  return apiFetch(`/v1/business/products/${encodeURIComponent(id)}/like`, { method: 'POST', body: {} })
}

export async function apiUnlikeBusinessProduct(id: string): Promise<{ liked: boolean; like_count: number; rating: number }> {
  return apiFetch(`/v1/business/products/${encodeURIComponent(id)}/like`, { method: 'DELETE' })
}

export async function apiListBusinessReviews(id: string): Promise<{ items: BusinessReview[] }> {
  return apiFetch(`/v1/business/products/${encodeURIComponent(id)}/reviews`)
}

export async function apiAddBusinessReview(id: string, body: string, sentiment: '' | 'positive' | 'negative'): Promise<BusinessReview> {
  return apiFetch(`/v1/business/products/${encodeURIComponent(id)}/reviews`, { method: 'POST', body: { body, sentiment } })
}

export async function apiBuyBusinessProduct(id: string): Promise<{ id: string; conversation_id: string; status: string }> {
  return apiFetch(`/v1/business/products/${encodeURIComponent(id)}/buy`, { method: 'POST', body: {} })
}

export async function apiBusinessCabinet(): Promise<{
  business_mode: boolean
  stats: { views: number; likes: number; reviews: number }
  orders: BusinessOrder[]
}> {
  return apiFetch('/v1/business/cabinet')
}

export async function apiSetBusinessOrderStatus(id: string, status: string): Promise<{ status: string }> {
  return apiFetch(`/v1/business/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } })
}
