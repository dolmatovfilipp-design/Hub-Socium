import { isBrowserOffline } from '../../lib/offlineQueue.ts'
import { apiListChatMedia, apiSendMessageFull, apiUploadMedia } from '../../lib/api.ts'
import { requireConfirm } from './confirm.ts'
import { VOICE_CLEAR_PENDING, emitVoice } from './events.ts'
import { chatIdFromPath } from './phrase.ts'
import {
  RESULT_CANCELLED,
  SAY_API_ONLY,
  SAY_NOT_HERE,
  errorSay,
  type VoiceCommandContext,
  type VoiceCommandDefinition,
  type VoiceCommandResult,
  type VoiceMatch,
} from './types.ts'

export type ShelfKind = 'photo' | 'video' | 'file' | 'video_note' | 'chat'

export interface ShelfItem {
  id: string
  name: string
  kind: ShelfKind
  file?: File
  mediaUrl?: string
  msgType?: string
  source: 'picked' | 'chat'
}

export interface FileShelfSnapshot {
  open: boolean
  conversationId: string | null
  kind: ShelfKind | null
  items: readonly ShelfItem[]
  selectedIndex: number | null
  /** Voice never opens the system dialog. The chat screen shows this button. */
  picker: { kind: ShelfKind; accept: string; multiple: boolean } | null
}

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime'
const FILE_ACCEPT =
  '.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.json,application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

const SHELF_LIMIT = 20

let speak: (text: string) => void = (text) => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ru-RU'
  window.speechSynthesis.speak(utterance)
}

/** Framework TTS. Used when the shelf truncates outside a handler return. */
export function registerVoiceSay(fn: (text: string) => void): void {
  speak = fn
}

let snapshot: FileShelfSnapshot = {
  open: false,
  conversationId: null,
  kind: null,
  items: [],
  selectedIndex: null,
  picker: null,
}

const listeners = new Set<() => void>()

function publish(next: FileShelfSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function subscribeFileShelf(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getFileShelfSnapshot(): FileShelfSnapshot {
  return snapshot
}

export function isFileShelfOpen(): boolean {
  return snapshot.open && (snapshot.items.length > 0 || snapshot.picker !== null)
}

export function dismissFileShelf(): boolean {
  const had = isFileShelfOpen() || snapshot.items.length > 0 || snapshot.picker !== null
  if (!had) return false
  publish({
    open: false,
    conversationId: null,
    kind: null,
    items: [],
    selectedIndex: null,
    picker: null,
  })
  emitVoice(VOICE_CLEAR_PENDING)
  return true
}

function acceptFor(kind: ShelfKind): string {
  if (kind === 'photo') return PHOTO_ACCEPT
  if (kind === 'file') return FILE_ACCEPT
  return VIDEO_ACCEPT
}

function fileMatches(kind: ShelfKind, file: File): boolean {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  if (kind === 'photo') {
    return (
      type === 'image/jpeg' ||
      type === 'image/png' ||
      type === 'image/webp' ||
      type === 'image/gif' ||
      /\.(jpe?g|png|webp|gif)$/.test(name)
    )
  }
  if (kind === 'file') {
    return !type.startsWith('image/') && !type.startsWith('video/') && !/\.(jpe?g|png|webp|gif|mp4|webm|mov)$/.test(name)
  }
  return (
    type === 'video/mp4' ||
    type === 'video/webm' ||
    type === 'video/quicktime' ||
    /\.(mp4|webm|mov)$/.test(name)
  )
}

function openKind(ctx: VoiceCommandContext, kind: ShelfKind, emptyReply: string): VoiceCommandResult {
  const conversationId = chatIdFromPath(ctx.pathname)
  if (!conversationId) return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  if (snapshot.kind === kind && snapshot.conversationId === conversationId && snapshot.items.length > 0) {
    publish({ ...snapshot, open: true, picker: null })
    return { say: `На полке ${snapshot.items.length}` }
  }
  publish({
    open: true,
    conversationId,
    kind,
    items: [],
    selectedIndex: null,
    picker: { kind, accept: acceptFor(kind), multiple: true },
  })
  return { say: emptyReply }
}

export function ingestPickedFiles(files: readonly File[]): { accepted: number; rejected: number; truncated: boolean } {
  const kind = snapshot.kind
  if (!kind || kind === 'chat') return { accepted: 0, rejected: files.length, truncated: false }
  const fitting: ShelfItem[] = []
  let rejected = 0
  for (const file of files) {
    if (!fileMatches(kind, file)) {
      rejected += 1
      continue
    }
    fitting.push({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name || 'файл',
      kind,
      file,
      source: 'picked',
    })
  }
  const room = Math.max(0, SHELF_LIMIT - snapshot.items.length)
  const take = fitting.slice(0, room)
  const truncated = fitting.length > take.length
  const items = [...snapshot.items, ...take]
  publish({
    ...snapshot,
    open: true,
    picker: null,
    items,
    selectedIndex: items.length === 1 ? 0 : null,
  })
  if (truncated) speak('На полке первые двадцать')
  if (!take.length && rejected) speak('Этот файл сюда не подходит')
  return { accepted: take.length, rejected, truncated }
}

function selectedItem(): ShelfItem | null {
  if (!snapshot.items.length) return null
  if (snapshot.items.length === 1) return snapshot.items[0] ?? null
  if (snapshot.selectedIndex == null) return null
  return snapshot.items[snapshot.selectedIndex] ?? null
}

async function selectItem(match: VoiceMatch): Promise<VoiceCommandResult> {
  if (!snapshot.open || !snapshot.items.length) return { say: 'Сначала выберите файлы' }
  const phrase = match.phrase
  let index: number
  if (phrase === 'последнее') index = snapshot.items.length - 1
  else if (match.number) index = match.number - 1
  else return { say: 'Скажите номер' }
  if (index < 0 || index >= snapshot.items.length) return { say: 'На полке нет такого номера' }
  const item = snapshot.items[index]
  if (!item) return { say: 'На полке нет такого номера' }
  publish({ ...snapshot, selectedIndex: index, open: true })
  return { say: `Выбрано. ${item.name}` }
}

async function clearAttachment(): Promise<VoiceCommandResult> {
  if (!snapshot.items.length) {
    emitVoice(VOICE_CLEAR_PENDING)
    return { say: 'Вложения нет' }
  }
  if (snapshot.selectedIndex == null && snapshot.items.length > 1) {
    return { say: 'Скажите, какое вложение убрать' }
  }
  const index = snapshot.selectedIndex ?? 0
  const items = snapshot.items.filter((_, itemIndex) => itemIndex !== index)
  publish({
    ...snapshot,
    items,
    selectedIndex: items.length === 1 ? 0 : null,
    open: items.length > 0,
    picker: items.length ? null : snapshot.picker,
  })
  emitVoice(VOICE_CLEAR_PENDING)
  return { say: 'Вложение убрано' }
}

async function loadChatMedia(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const conversationId = chatIdFromPath(ctx.pathname)
  if (!conversationId) return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  try {
    const response = await apiListChatMedia(conversationId)
    const rows = response.items ?? []
    if (!rows.length) return { say: 'В чате медиа нет' }
    const truncated = rows.length > SHELF_LIMIT
    const items: ShelfItem[] = rows.slice(0, SHELF_LIMIT).map((row) => ({
      id: row.id,
      name: row.body?.trim() || 'файл из чата',
      kind: 'chat',
      mediaUrl: row.media_url,
      msgType: row.msg_type,
      source: 'chat',
    }))
    publish({
      open: true,
      conversationId,
      kind: 'chat',
      items,
      selectedIndex: items.length === 1 ? 0 : null,
      picker: null,
    })
    if (truncated) speak('На полке первые двадцать')
    return { say: 'Полка из чата' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function messageBody(item: ShelfItem): { msgType: string; body: string; durationMs?: number } {
  const msgType =
    item.msgType ||
    (item.kind === 'photo'
      ? 'image'
      : item.kind === 'file'
        ? 'file'
        : item.kind === 'video_note'
          ? 'video_note'
          : item.kind === 'video'
            ? 'video'
            : 'file')
  if (msgType === 'video_note') return { msgType, body: '⭕️ Видеосообщение', durationMs: 3000 }
  if (msgType === 'video') return { msgType, body: item.name || '🎬 Видео' }
  if (msgType === 'file') return { msgType, body: item.name || '📎 Файл' }
  if (msgType === 'image') return { msgType, body: ' ' }
  return { msgType, body: item.name || ' ' }
}

async function sendSelected(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const conversationId = chatIdFromPath(ctx.pathname)
  if (!conversationId) return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  if (snapshot.conversationId && snapshot.conversationId !== conversationId) {
    return { say: 'Откройте тот чат, где выбраны файлы' }
  }
  const item = selectedItem()
  if (!item) {
    if (!snapshot.items.length) return { say: 'Сначала выберите файлы' }
    return { say: 'Скажите первое, последнее или номер' }
  }
  const accepted = await requireConfirm(ctx, `Отправить ${item.name}?`, 'yes')
  if (!accepted) return RESULT_CANCELLED
  if (typeof navigator !== 'undefined' && isBrowserOffline()) {
    return { say: 'Нет сети. Сообщение не отправлено' }
  }
  try {
    let mediaUrl = item.mediaUrl
    if (!mediaUrl) {
      if (!item.file) return { say: 'Сначала выберите файлы' }
      const uploaded = await apiUploadMedia(item.file)
      mediaUrl = uploaded.url
    }
    const shaped = messageBody(item)
    await apiSendMessageFull(conversationId, {
      body: shaped.body,
      media_url: mediaUrl,
      msg_type: shaped.msgType,
      duration_ms: shaped.durationMs,
    })
    publish({
      open: false,
      conversationId: null,
      kind: null,
      items: [],
      selectedIndex: null,
      picker: null,
    })
    emitVoice(VOICE_CLEAR_PENDING)
    ctx.toast('Отправлено')
    return { say: 'Отправлено' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function onChat(ctx: VoiceCommandContext, run: () => VoiceCommandResult): VoiceCommandResult {
  if (!chatIdFromPath(ctx.pathname)) return { say: SAY_NOT_HERE }
  return run()
}

export const fileShelfCommands: readonly VoiceCommandDefinition[] = [
  {
    id: 'C-18',
    title: 'Фото',
    group: 'Чат',
    phrases: ['фото'],
    synonyms: ['отправь фото'],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Выберите фото',
    starter: false,
    handler: (ctx) => Promise.resolve(onChat(ctx, () => openKind(ctx, 'photo', 'Выберите фото'))),
  },
  {
    id: 'C-19',
    title: 'Видео',
    group: 'Чат',
    phrases: ['видео в чат'],
    synonyms: ['отправь видео'],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Выберите видео',
    starter: false,
    handler: (ctx) => Promise.resolve(onChat(ctx, () => openKind(ctx, 'video', 'Выберите видео'))),
  },
  {
    id: 'C-20',
    title: 'Файл',
    group: 'Чат',
    phrases: ['файл'],
    synonyms: ['документ'],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Выберите файл',
    starter: false,
    handler: (ctx) => Promise.resolve(onChat(ctx, () => openKind(ctx, 'file', 'Выберите файл'))),
  },
  {
    id: 'C-21',
    title: 'Кружок',
    group: 'Чат',
    phrases: ['кружок'],
    synonyms: ['видеосообщение'],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Кружок выбирается готовым файлом',
    starter: false,
    handler: async (ctx) => {
      const opened = openKind(ctx, 'video_note', 'Кружок выбирается готовым файлом')
      if (opened.say === SAY_NOT_HERE || opened.say === SAY_API_ONLY) return opened
      return { say: 'Кружок выбирается готовым файлом' }
    },
  },
  {
    id: 'C-22',
    title: 'Выбрать вложение',
    group: 'Чат',
    phrases: ['первое', 'последнее', 'номер'],
    synonyms: [
      'второе',
      'третье',
      'четвертое',
      'пятое',
      'шестое',
      'седьмое',
      'восьмое',
      'девятое',
      'десятое',
      'одиннадцатое',
      'двенадцатое',
      'тринадцатое',
      'четырнадцатое',
      'пятнадцатое',
      'шестнадцатое',
      'семнадцатое',
      'восемнадцатое',
      'девятнадцатое',
      'двадцатое',
    ],
    screens: ['chat'],
    priority: 'shelf',
    slot: 'number',
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Выбрано',
    starter: false,
    handler: (ctx, match) => {
      if (!chatIdFromPath(ctx.pathname)) return Promise.resolve({ say: SAY_NOT_HERE })
      return selectItem(match)
    },
  },
  {
    id: 'C-23',
    title: 'Убрать вложение',
    group: 'Чат',
    phrases: ['убери вложение'],
    synonyms: ['убери фото'],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Вложение убрано',
    starter: true,
    handler: (ctx) => {
      if (!chatIdFromPath(ctx.pathname)) return Promise.resolve({ say: SAY_NOT_HERE })
      return clearAttachment()
    },
  },
  {
    id: 'C-24',
    title: 'Из этого чата',
    group: 'Чат',
    phrases: ['из этого чата'],
    synonyms: ['медиа чата для выбора'],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Полка из чата',
    starter: true,
    handler: (ctx) => loadChatMedia(ctx),
  },
  {
    id: 'FS-SEND',
    title: 'Отправить файл с полки',
    group: 'Чат',
    phrases: ['отправить'],
    synonyms: ['отправь'],
    screens: ['chat'],
    priority: 'shelf',
    shelfOnly: true,
    confirmation: 'yes',
    confirmInHandler: true,
    confirmPrompt: 'Отправить файл?',
    reply: 'Отправить?',
    starter: false,
    handler: (ctx) => sendSelected(ctx),
  },
  {
    id: 'FS-CANCEL',
    title: 'Закрыть полку',
    group: 'Чат',
    phrases: ['отмена'],
    synonyms: ['не надо', 'отмени'],
    screens: ['chat'],
    priority: 'shelf',
    shelfOnly: true,
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Отменено',
    starter: true,
    handler: () => {
      dismissFileShelf()
      return Promise.resolve({ say: 'Отменено' })
    },
  },
]
