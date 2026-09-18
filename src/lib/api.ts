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
  created_at: string
  likes: number
  comments: number
  liked_by_me?: boolean
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
  username: string
  display_name: string
  email?: string
  phone?: string
  password: string
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
  limit = 30,
  cursor?: string | null,
): Promise<{ items: ApiFeedItem[]; next_cursor?: string | null }> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (cursor) q.set('cursor', cursor)
  return apiFetch(`/v1/feed?${q.toString()}`)
}

export async function apiCreatePost(
  body: string,
  imageUrl?: string,
): Promise<ApiFeedItem> {
  const payload: { body: string; image_url?: string } = { body }
  if (imageUrl) payload.image_url = imageUrl
  return apiFetch('/v1/posts', { method: 'POST', body: payload })
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
  return apiFetch(`/v1/users/${encodeURIComponent(usernameOrId)}`, { auth: false })
}

export async function apiUpdateMe(patch: {
  display_name?: string
  username?: string
  bio?: string
  avatar_url?: string
}): Promise<ApiUser> {
  return apiFetch('/v1/users/me', { method: 'PATCH', body: patch })
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
  peer: ApiPeerUser
  last_message?: ApiLastMessage | null
}

export type ApiMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
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
): Promise<{ items: ApiMessage[]; next_cursor?: string | null }> {
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
