import { apiFetch, type ApiMessage } from './api'

export type AiResult<T> = T & { disabled?: boolean; message?: string }

export async function apiListThread(conversationId: string, rootId: string): Promise<ApiMessage[]> {
  const res = await apiFetch<{ items?: ApiMessage[] }>(
    `/v1/conversations/${conversationId}/messages?thread=${encodeURIComponent(rootId)}&limit=50`,
  )
  return res.items ?? []
}

export async function apiCatchUp(conversationId: string): Promise<AiResult<{ summary?: string; count?: number }>> {
  return apiFetch(`/v1/conversations/${conversationId}/summary`, { method: 'POST', body: {} })
}

export async function apiReplySuggestions(conversationId: string): Promise<AiResult<{ suggestions?: string[] }>> {
  return apiFetch(`/v1/conversations/${conversationId}/reply-suggestions`, { method: 'POST', body: {} })
}

export async function apiGetTranslatePref(conversationId: string): Promise<{
  enabled: boolean
  lang: string
  available: boolean
  disabled?: boolean
  message?: string
}> {
  return apiFetch(`/v1/conversations/${conversationId}/translate-pref`)
}

export async function apiSetTranslatePref(
  conversationId: string,
  enabled: boolean,
  lang = 'ru',
): Promise<{ enabled: boolean; lang: string; available: boolean; disabled?: boolean; message?: string }> {
  return apiFetch(`/v1/conversations/${conversationId}/translate-pref`, {
    method: 'PUT',
    body: { enabled, lang },
  })
}

export async function apiTranslateRecent(conversationId: string): Promise<AiResult<{
  lang?: string
  items?: { message_id: string; text: string }[]
}>> {
  return apiFetch(`/v1/conversations/${conversationId}/translate-recent`, { method: 'POST', body: {} })
}

export async function apiCreateReminder(
  conversationId: string,
  remindAt: string,
  note: string,
  messageId?: string,
): Promise<{ id: string; note: string; remind_at: string }> {
  return apiFetch(`/v1/conversations/${conversationId}/reminders`, {
    method: 'POST',
    body: { remind_at: remindAt, note, message_id: messageId },
  })
}

export async function apiListReminders(conversationId: string): Promise<{
  items: { id: string; note: string; remind_at: string; message_id?: string; fired_at?: string }[]
}> {
  return apiFetch(`/v1/conversations/${conversationId}/reminders`)
}

export async function apiOpenViewOnce(
  conversationId: string,
  messageId: string,
): Promise<{ media_url: string; view_once: string }> {
  return apiFetch(`/v1/conversations/${conversationId}/messages/${messageId}/view`, { method: 'POST', body: {} })
}

export async function apiGenerateSticker(
  prompt: string,
  conversationId?: string,
): Promise<AiResult<{ media_url?: string; message_id?: string; provider?: string }>> {
  return apiFetch('/v1/stickers', { method: 'POST', body: { prompt, conversation_id: conversationId } })
}

export async function apiCreateChatOrder(
  conversationId: string,
  title: string,
  amountMinor: number,
): Promise<{ id: string; title: string; amount_minor: number; status: string; payments?: boolean; message_id?: string }> {
  return apiFetch(`/v1/conversations/${conversationId}/orders`, {
    method: 'POST',
    body: { title, amount_minor: amountMinor },
  })
}

export async function apiPayChatOrder(orderId: string): Promise<{ confirmation_url?: string; status: string }> {
  return apiFetch(`/v1/orders/${orderId}/pay`, { method: 'POST', body: {} })
}

export async function apiGetChatOrder(orderId: string): Promise<{
  id: string
  status: string
  title: string
  amount_minor: number
  disabled?: boolean
  message?: string
  payments?: boolean
}> {
  return apiFetch(`/v1/orders/${orderId}`)
}

export async function apiSellerDraft(conversationId: string): Promise<AiResult<{ id?: string; body?: string; status?: string }>> {
  return apiFetch(`/v1/conversations/${conversationId}/seller-draft`, { method: 'POST', body: {} })
}

export async function apiApproveSellerDraft(id: string): Promise<{ ok: boolean; message_id: string; body: string }> {
  return apiFetch(`/v1/seller-drafts/${id}/approve`, { method: 'POST', body: {} })
}

export async function apiDismissSellerDraft(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/v1/seller-drafts/${id}/dismiss`, { method: 'POST', body: {} })
}

export async function apiSubscribeChannel(channelId: string): Promise<{
  status?: string
  confirmation_url?: string
  price_minor?: number
  joined?: boolean
}> {
  return apiFetch(`/v1/channels/${channelId}/subscribe`, { method: 'POST', body: {} })
}

export async function apiUnlockChannelPost(channelId: string, postId: string): Promise<{
  unlocked?: boolean
  confirmation_url?: string
  price_minor?: number
}> {
  return apiFetch(`/v1/channels/${channelId}/posts/${postId}/unlock`, { method: 'POST', body: {} })
}

export async function apiSetChannelPrice(channelId: string, priceMinor: number): Promise<{ price_minor: number; payments: boolean }> {
  return apiFetch(`/v1/channels/${channelId}/price`, { method: 'PUT', body: { price_minor: priceMinor } })
}
