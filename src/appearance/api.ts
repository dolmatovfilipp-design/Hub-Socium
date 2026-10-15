import { apiFetch, getAccessToken, isApiMode } from '../lib/api'
import { normalizeBackground } from './storage'
import {
  accentById,
  fontById,
  noneBackground,
  type AppearanceMode,
  type AppearancePatch,
  type AppearancePrefs,
  type ChatBackground,
} from './types'

type ServerPrefs = {
  theme_id?: string
  appearance?: string
  accent?: string
  font_scale?: string
  chat_background?: Partial<ChatBackground> | null
}

export function serverToPrefs(raw: ServerPrefs): AppearancePrefs {
  const appearance: AppearanceMode =
    raw.appearance === 'light' || raw.appearance === 'system' || raw.appearance === 'dark'
      ? raw.appearance
      : 'dark'
  return {
    themeId: raw.theme_id || 'default',
    appearance,
    accent: accentById(raw.accent || '').id === raw.accent ? accentById(raw.accent || '').id : 'graphite',
    fontScale: fontById(raw.font_scale || '').id === raw.font_scale ? fontById(raw.font_scale || '').id : 'md',
    background: raw.chat_background ? normalizeBackground(raw.chat_background) : noneBackground(),
  }
}

function patchBody(patch: AppearancePatch) {
  const body: Record<string, unknown> = {}
  if (patch.appearance) body.appearance = patch.appearance
  if (patch.accent) body.accent = patch.accent
  if (patch.fontScale) body.font_scale = patch.fontScale
  if (patch.background) body.chat_background = normalizeBackground(patch.background)
  return body
}

export function canSync() {
  return isApiMode() && !!getAccessToken()
}

export async function fetchAppearancePrefs(): Promise<AppearancePrefs> {
  const raw = await apiFetch<ServerPrefs>('/v1/me/chat-prefs')
  return serverToPrefs(raw)
}

export async function putAppearancePrefs(patch: AppearancePatch): Promise<AppearancePrefs> {
  const raw = await apiFetch<ServerPrefs>('/v1/me/chat-prefs', { method: 'PUT', body: patchBody(patch) })
  return serverToPrefs(raw)
}

export async function fetchConversationBackground(conversationId: string): Promise<ChatBackground | null> {
  const raw = await apiFetch<{ inherit?: boolean; chat_background?: Partial<ChatBackground> | null }>(
    `/v1/conversations/${conversationId}/background`,
  )
  if (raw.inherit || !raw.chat_background) return null
  return normalizeBackground(raw.chat_background)
}

export async function putConversationBackground(conversationId: string, background: ChatBackground | null) {
  if (background == null) {
    await apiFetch(`/v1/conversations/${conversationId}/background`, {
      method: 'PUT',
      body: { inherit: true },
    })
    return
  }
  await apiFetch(`/v1/conversations/${conversationId}/background`, {
    method: 'PUT',
    body: { chat_background: normalizeBackground(background) },
  })
}
