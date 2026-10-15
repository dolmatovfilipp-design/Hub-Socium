import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useNavMotion } from '../components/NavMotion'
import { useStore } from '../store/useStore'
import { FileShelfHost } from '../voice/FileShelfHost'
import { Avatar } from '../components/Avatar'
import { ChatPollCard } from '../components/ChatPollCard'
import { IconChevron, IconMic, IconMore, IconPhone, IconPin, IconPlane, IconPlayCircle, IconPlus, IconSearch, IconSmile, IconUser, IconVideo } from '../components/Icons'
import { CirclePreview, VideoCirclePlayer } from '../components/VideoCircle'
import { DisappearChoices, HonestBanner, OrderForm, ScheduleFields, StickerForm, SummaryBody, ToolSheet, menuGlyph } from '../components/ChatLive'
import { trimSilence, voiceCaptureConstraints } from '../lib/audioTrim'
import {
  apiApproveSellerDraft,
  apiCatchUp,
  apiCreateChatOrder,
  apiCreateReminder,
  apiDismissSellerDraft,
  apiGenerateSticker,
  apiGetTranslatePref,
  apiOpenViewOnce,
  apiPayChatOrder,
  apiListThread,
  apiReplySuggestions,
  apiSellerDraft,
  apiSetTranslatePref,
  apiTranslateRecent,
} from '../lib/liveApi'
import { chatWsSubscribe, chatWsConnected } from '../lib/chatWs'
import { requestOutgoingCall } from '../lib/callBus'
import { callCardSubtitle, callCardTitle, callDirection, callIsVideo, type CallMeta } from '../lib/callMeta'
import {
  apiListConversations,
  apiListMessages,
  apiDeleteMessage,
  apiHideMessage,
  apiSearchMessages,
  apiLinkPreview,
  apiMessageReaders,
  apiMessageEdits,
  apiUploadMedia,
  apiTyping,
  apiSendVoice,
  apiSendMessageFull,
  apiMarkConversationRead,
  apiMarkDelivered,
  apiReactMessage,
  apiEditMessage,
  apiPinChatMessage,
  apiAddArchive,
  apiScheduleDM,

  apiSetDisappear,
  apiGetDisappear,
  apiListChatMedia,
  apiForwardMessage,
  apiPatchConversation,
  apiFeatures,
  newClientId,
  apiRequestTranscript,
  apiGetTranscript,
  apiTranslateMessage,
  isApiMode,
  type ApiConversation,
  type ApiLinkPreview,
  type ApiMessage,
  type ApiMessageEdits,
  type ApiMessageReader,
  type ApiPeerUser,
  type ApiTranscript,
  type ChatPoll,
} from '../lib/api'
import { ruParticipants } from '../utils/ru'
import { enqueueOffline, isBrowserOffline } from '../lib/offlineQueue'
import { cachePeek, cacheSet } from '../lib/listCache'
import { formatPresence } from '../utils/validation'
import { VoiceBubble } from '../components/VoiceBubble'
import {
  DictationDock,
  isVoiceModeOn,
  requestVoiceCapture,
  storeVoiceRecording,
  type DictMessage,
} from '../voice/dictation'

function formatChatDate(iso: string): string {
  const d = new Date(iso)
  const months = [
    'ЯНВАРЯ', 'ФЕВРАЛЯ', 'МАРТА', 'АПРЕЛЯ', 'МАЯ', 'ИЮНЯ',
    'ИЮЛЯ', 'АВГУСТА', 'СЕНТЯБРЯ', 'ОКТЯБРЯ', 'НОЯБРЯ', 'ДЕКАБРЯ',
  ]
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getMonth()]} В ${hh}:${mm}`
}

function peekConv(id: string): ApiConversation | null {
  const list = cachePeek<ApiConversation[]>('conversations_inbox')
  return list?.find((c) => c.id === id) ?? null
}

function peekMsgs(id: string): ApiMessage[] {
  return cachePeek<{ items?: ApiMessage[] }>('msgs_' + id)?.items ?? []
}

function dateKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

type BubbleMsg = {
  id: string
  mine: boolean
  body: string
  createdAt: string
  mediaUrl?: string
  msgType?: string
  durationMs?: number
  read?: boolean
  delivered?: boolean
  receipt?: boolean
  replyToId?: string
  forwardOf?: string
  reactions?: { emoji: string; count: number; mine?: boolean }[]
  editedAt?: string
  expiresAt?: string
  storyQuote?: { body?: string; media_url?: string }
  meta?: Record<string, unknown>
  senderName?: string
  senderAvatar?: string
  senderId?: string
  poll?: ChatPoll
  transcript?: ApiTranscript
  callMeta?: CallMeta | null
  viewOnce?: string
  threadCount?: number
  threadRootId?: string
}

function formatHm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function firstHttpURL(body: string): string | null {
  const m = body.match(/https?:\/\/[^\s<>"']+/i)
  if (!m) return null
  return m[0].replace(/[),.;!?]+$/g, '')
}

function canEditType(msgType?: string): boolean {
  const t = (msgType || 'text').toLowerCase()
  return t === 'text' || t === 'image' || t === 'video' || t === 'file'
}

/** Own non-e2e text (and image/video/file captions) stay editable for 48 hours. */
const MESSAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000

function sameUser(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

function canEditMessage(
  m: { sender_id?: string; msg_type?: string; created_at?: string } | undefined,
  uid: string,
  now = Date.now(),
): boolean {
  if (!m || !sameUser(m.sender_id, uid) || !canEditType(m.msg_type)) return false
  const created = Date.parse(m.created_at || '')
  if (!Number.isFinite(created)) return false
  return now - created <= MESSAGE_EDIT_WINDOW_MS
}

function peerFromMessages(messages: ApiMessage[], uid: string): ApiPeerUser | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const senderId = m.sender?.id || m.sender_id
    if (!senderId || sameUser(senderId, uid)) continue
    const username = m.sender?.username || m.sender_username || ''
    const display = m.sender?.display_name || m.sender_name || username
    if (!username && !display) continue
    return {
      id: senderId,
      username: username || display,
      display_name: display || username,
      avatar_url: m.sender?.avatar_url,
      is_bot: false,
    }
  }
  return null
}

/** A direct chat whose membership join picked a bot (or nobody) still has a human speaker. */
function resolveChatPeer(
  conv: ApiConversation | null,
  messages: ApiMessage[],
  uid: string,
): { peer: ApiPeerUser | null; isGroup: boolean } {
  if (!conv) {
    const human = peerFromMessages(messages, uid)
    if (human) return { peer: human, isGroup: false }
    if (messages.length > 0) {
      return { peer: { id: '', username: 'Удалённый аккаунт', display_name: 'Удалённый аккаунт' }, isGroup: false }
    }
    return { peer: null, isGroup: false }
  }
  let isGroup = !!conv.is_group
  let peer: ApiPeerUser | undefined = conv.peer
  const syntheticGroup = isGroup && !!peer && !peer.is_bot && (peer.username === 'group' || peer.id === conv.id)
  if (syntheticGroup) return { peer, isGroup: true }
  const bad = !peer || !!peer.is_bot || peer.id === conv.id || sameUser(peer.id, uid)
  if (bad) {
    const human = peerFromMessages(messages, uid)
    if (human) return { peer: human, isGroup: false }
  }
  if (!isGroup && (!peer || peer.is_bot) && messages.length > 0) {
    return {
      peer: { id: '', username: 'Удалённый аккаунт', display_name: 'Удалённый аккаунт' },
      isGroup: false,
    }
  }
  return { peer: peer ?? null, isGroup }
}

const linkPreviewCache = new Map<string, ApiLinkPreview>()

function ReceiptTicks({ delivered, read }: { delivered: boolean; read: boolean }) {
  const color = read ? '#4da3ff' : '#8e8e93'
  const label = read ? 'прочитано' : delivered ? 'доставлено' : 'отправлено'
  return (
    <span aria-label={label} className="inline-flex items-center" style={{ color }}>
      <svg width="15" height="11" viewBox="0 0 15 11" fill="none" aria-hidden>
        <path d="M1 5.5 3.2 8 7.2 2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        {delivered || read ? (
          <path d="M5.4 5.5 7.6 8 13 2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
      </svg>
    </span>
  )
}

function LocationBubble({ meta }: { meta?: Record<string, unknown> }) {
  const lat = typeof meta?.lat === 'number' ? meta.lat : null
  const lng = typeof meta?.lng === 'number' ? meta.lng : null
  const title = typeof meta?.title === 'string' && meta.title ? meta.title : 'Местоположение'
  if (lat == null || lng == null) return <p>📍 {title}</p>
  return (
    <a
      href={`https://maps.google.com/?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block min-w-[160px] no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="block text-[18px]">📍</span>
      <span className="block text-[14px] font-medium text-white">{title}</span>
      <span className="block text-[11px] text-[#8e8e93]">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
    </a>
  )
}

function ContactBubble({ meta, body }: { meta?: Record<string, unknown>; body: string }) {
  const name = typeof meta?.name === 'string' && meta.name ? meta.name : body.replace(/^👤\s*/, '') || 'Контакт'
  const phone = typeof meta?.phone === 'string' ? meta.phone : ''
  return (
    <div className="min-w-[150px]">
      <p className="text-[11px] text-[#8e8e93]">Контакт</p>
      <p className="text-[15px] font-medium text-white">{name}</p>
      {phone ? <p className="text-[13px] text-[#a8a8a8]">{phone}</p> : null}
    </div>
  )
}

const SOURCE_LANG: Record<string, string> = {
  en: 'английского',
  de: 'немецкого',
  fr: 'французского',
  es: 'испанского',
  it: 'итальянского',
  uk: 'украинского',
  be: 'белорусского',
  kk: 'казахского',
  zh: 'китайского',
  tr: 'турецкого',
  pl: 'польского',
  ja: 'японского',
  ko: 'корейского',
  pt: 'португальского',
  ar: 'арабского',
  ru: 'русского',
}

type TranslationView = {
  loading?: boolean
  text?: string
  source?: string
  error?: string
  hidden?: boolean
}

function uiLang(): string {
  try {
    const saved = localStorage.getItem('hub_ui_lang')
    if (saved && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(saved)) return saved
  } catch {
    /* ignore */
  }
  return 'ru'
}

function TranscriptLine({
  t,
  mine,
  canRequest,
  onRequest,
}: {
  t?: ApiTranscript
  mine: boolean
  canRequest: boolean
  onRequest: () => void
}) {
  const [open, setOpen] = useState(false)
  const status = t?.status ?? 'none'
  if (status === 'none') {
    if (!canRequest) return null
    return (
      <button
        type="button"
        data-testid="transcribe-btn"
        onClick={(e) => {
          e.stopPropagation()
          onRequest()
        }}
        className={`mt-1 flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${mine ? 'bg-white/15 text-white' : 'bg-white/10 text-[#c8c8c8]'}`}
      >
        <span aria-hidden>Aa</span> Расшифровать
      </button>
    )
  }
  if (status === 'pending' || status === 'processing') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[#a8a8a8]" data-testid="transcript-pending">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        Расшифровка…
      </p>
    )
  }
  if (status === 'failed') {
    return (
      <p className="mt-1 text-[12px] text-[#ff9b9b]" data-testid="transcript-failed">
        {t?.error || 'Не удалось расшифровать'}
        {canRequest ? (
          <button
            type="button"
            className="ml-2 underline"
            onClick={(e) => {
              e.stopPropagation()
              onRequest()
            }}
          >
            Повторить
          </button>
        ) : null}
      </p>
    )
  }
  const text = t?.text || ''
  const long = text.length > 160
  return (
    <div className="mt-1 max-w-[260px] rounded-lg bg-black/20 px-2 py-1" data-testid="transcript">
      <p className={`whitespace-pre-wrap break-words text-[13px] leading-snug text-[#e5e5e5] ${long && !open ? 'line-clamp-3' : ''}`} data-testid="transcript-text">
        {text}
      </p>
      {long ? (
        <button
          type="button"
          className="mt-0.5 text-[12px] text-[#4ea4ff]"
          data-testid="transcript-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {open ? 'Свернуть' : 'Показать полностью'}
        </button>
      ) : null}
    </div>
  )
}

function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<ApiLinkPreview | null>(linkPreviewCache.get(url) ?? null)
  useEffect(() => {
    const cached = linkPreviewCache.get(url)
    if (cached) {
      setData(cached.ok ? cached : null)
      return
    }
    let cancelled = false
    void apiLinkPreview(url)
      .then((d) => {
        linkPreviewCache.set(url, d)
        if (!cancelled && d.ok) setData(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [url])
  if (!data) return null
  const href = data.final_url || data.url || url
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 block overflow-hidden rounded-xl bg-black/30 no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      {data.image_url ? <img src={data.image_url} alt="" className="max-h-32 w-full object-cover" /> : null}
      <span className="block px-2.5 py-1.5">
        {data.site_name ? <span className="block text-[10px] uppercase tracking-wide text-[#8e8e93]">{data.site_name}</span> : null}
        {data.title ? <span className="block text-[13px] font-medium text-white">{data.title}</span> : null}
        {data.description ? <span className="line-clamp-2 block text-[12px] text-[#a8a8a8]">{data.description}</span> : null}
      </span>
    </a>
  )
}

function TranslationLine({ st, onHide }: { st: TranslationView; onHide: () => void }) {
  if (st.hidden) return null
  if (st.loading) {
    return (
      <p className="mt-1 text-[12px] text-[#a8a8a8]" data-testid="translation-pending">
        Перевод…
      </p>
    )
  }
  if (st.error) {
    return (
      <p className="mt-1 text-[12px] text-[#ff9b9b]" data-testid="translation-error">
        {st.error}
      </p>
    )
  }
  const src = st.source ? SOURCE_LANG[st.source.split('-')[0]] : ''
  return (
    <div className="mt-1 border-l-2 border-[#4ea4ff] pl-2" data-testid="translation">
      <p className="text-[11px] text-[#8e8e93]">Перевод{src ? ` с ${src}` : ''}</p>
      <p className="whitespace-pre-wrap break-words text-[14px] text-white" data-testid="translation-text">
        {st.text}
      </p>
      <button
        type="button"
        className="text-[11px] text-[#4ea4ff]"
        data-testid="translation-hide"
        onClick={(e) => {
          e.stopPropagation()
          onHide()
        }}
      >
        Скрыть перевод
      </button>
    </div>
  )
}

function messageCanTranslate(m: { msgType?: string; body?: string; transcript?: ApiTranscript } | undefined): boolean {
  if (!m) return false
  const type = m.msgType || 'text'
  if (type === 'voice' || type === 'video_note') {
    return m.transcript?.status === 'done' && !!(m.transcript.text || '').trim()
  }
  if (type === 'text' || type === 'image' || type === 'video' || type === 'file') {
    const body = (m.body || '').trim()
    if (!body) return false
    if (body.startsWith('📍') || body.startsWith('👤')) return false
    return true
  }
  return false
}

function FileBubble({ url, filename }: { url: string; filename: string }) {
  const name = filename.replace(/^📎\s*/, '').trim() || 'Файл'
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={name}
      className="mb-1 flex min-w-[180px] max-w-[240px] items-center gap-2.5 rounded-xl bg-black/25 px-3 py-2.5 no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-[18px]">📄</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-white">{name}</span>
        <span className="block text-[11px] text-[#8e8e93]">Файл · открыть</span>
      </span>
    </a>
  )
}

function ChatThread({
  messages,
  peerName,
  peerUsername,
  peerAvatar,
  peerId,
  profileTo,
  profileLabel,
  peerSubtitle,
  bottomRef,
  scrollerRef,
  contentRef,
  typing,
  onOpenActions,
  isGroup,
  highlightId,
  onShowEdits,
  conversationId,
  onPollUpdate,
  canTranscribe,
  onTranscribe,
  translations,
  onHideTranslation,
  myId,
  onRedial,
  onOpenThread,
  onOpenViewOnce,
  onPayOrder,
  payments,
}: {
  messages: BubbleMsg[]
  peerName: string
  peerUsername: string
  peerAvatar?: string
  peerId: string
  profileTo?: string
  profileLabel?: string
  peerSubtitle?: string
  bottomRef: RefObject<HTMLDivElement | null>
  scrollerRef?: RefObject<HTMLDivElement | null>
  contentRef?: RefObject<HTMLDivElement | null>
  onDeleteMessage?: (id: string) => void
  typing?: boolean
  myId?: string
  onRedial?: (video: boolean) => void
  onReply?: (id: string) => void
  onReact?: (id: string, emoji: string) => void
  onForward?: (id: string) => void
  onEdit?: (id: string) => void
  onPin?: (id: string) => void
  onOpenReactPicker?: (id: string) => void
  onOpenActions?: (id: string) => void
  isGroup?: boolean
  highlightId?: string | null
  onShowEdits?: (id: string) => void
  conversationId?: string
  onPollUpdate?: (messageId: string, poll: ChatPoll) => void
  canTranscribe?: boolean
  onTranscribe?: (id: string) => void
  translations?: Record<string, TranslationView>
  onOpenThread?: (id: string) => void
  onOpenViewOnce?: (id: string) => void
  onPayOrder?: (orderId: string) => void
  payments?: boolean
  onHideTranslation?: (id: string) => void
}) {
  let lastDate = ''
  const title = isGroup ? (peerName || 'Группа') : (peerUsername || peerName)
  const subtitle = isGroup ? (peerSubtitle || '') : (peerSubtitle || (peerName && peerName !== peerUsername ? peerName : ''))

  return (
    <div ref={scrollerRef} className="no-scrollbar flex-1 overflow-y-auto bg-black px-4 pb-4 pt-2">
      <div ref={contentRef}>
      {/* Threads-style profile intro */}
      <div className="mb-8 flex flex-col items-center px-4 pt-6 text-center">
        <Avatar name={peerName || peerUsername} id={peerId} src={peerAvatar} size={88} />
        <p className="mt-3 text-[20px] font-bold leading-tight text-white">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-1 max-w-[280px] text-[14px] leading-snug text-[#8e8e93]">{subtitle}</p>
        ) : null}
        {profileTo ? (
          <Link
            to={profileTo}
            className="pressable mt-5 flex flex-col items-center gap-1.5 text-white"
          >
            <span className="flex h-11 w-11 items-center justify-center text-white">
              <IconUser size={22} strokeWidth={1.6} />
            </span>
            <span className="text-[13px]">{profileLabel || 'Посмотреть профиль'}</span>
          </Link>
        ) : null}
      </div>

      {messages.map((m) => {
        const dk = dateKey(m.createdAt)
        const showDate = dk !== lastDate
        lastDate = dk
        if (m.msgType === 'call') {
          const meta = m.callMeta || undefined
          const missed = meta && myId ? callDirection(meta, myId) === 'missed' : (m.body || '').includes('Пропущен')
          const video = callIsVideo(meta, m.body)
          const title = meta && myId ? callCardTitle(meta, myId) : m.body
          const sub = meta && myId ? callCardSubtitle(meta, myId) : null
          return (
            <div key={m.id}>
              {showDate && (
                <p className="mb-3 mt-4 text-center text-[11px] font-medium uppercase tracking-wide text-[#8e8e93]">
                  {formatChatDate(m.createdAt)}
                </p>
              )}
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  className="pressable flex items-center gap-3 rounded-2xl bg-[#1c1c1e] px-4 py-2.5 text-left"
                  onClick={() => onRedial?.(video)}
                >
                  <span className={`flex h-11 w-11 items-center justify-center ${missed ? 'text-[#ff453a]' : 'text-white'}`}>
                    {video ? <IconVideo size={22} strokeWidth={2} /> : <IconPhone size={22} strokeWidth={2} />}
                  </span>
                  <span>
                    <span className={`block text-[14px] font-medium ${missed ? 'text-[#ff453a]' : 'text-white'}`}>{title}</span>
                    {sub ? <span className="block text-[12px] text-[#8e8e93]">{sub}</span> : null}
                  </span>
                </button>
              </div>
            </div>
          )
        }
        const plainText = !m.msgType || m.msgType === 'text'
        const hideBody =
          m.msgType === 'voice' ||
          m.msgType === 'video_note' ||
          m.msgType === 'video' ||
          m.msgType === 'file' ||
          m.msgType === 'sticker' ||
          m.msgType === 'gif' ||
          m.msgType === 'location' ||
          m.msgType === 'contact'
        const previewUrl = plainText ? firstHttpURL(m.body) : null
        return (
          <div key={m.id} id={`msg-${m.id}`}>
            {showDate && (
              <p className="mb-3 mt-4 text-center text-[11px] font-medium uppercase tracking-wide text-[#8e8e93]">
                {formatChatDate(m.createdAt)}
              </p>
            )}
            <div className={`mb-3 flex items-end gap-2 ${m.mine ? 'justify-end' : 'justify-start'}`}>
              {!m.mine && (
                <Avatar
                  name={m.senderName || peerName}
                  id={m.senderId || peerId}
                  src={m.senderAvatar || peerAvatar}
                  size={28}
                />
              )}
              <div
                data-voice-msg={m.body || (m.msgType === 'voice' ? 'Голосовое сообщение' : 'Вложение')}
                data-voice-mine={m.mine ? '1' : '0'}
                className={`msg-bubble ${m.mine ? 'msg-bubble-mine' : 'msg-bubble-theirs'} ${highlightId === m.id ? 'ring-2 ring-[#5eb3f6]' : ''}`}
                onDoubleClick={() => onOpenActions?.(m.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onOpenActions?.(m.id)
                }}
              >
                {isGroup && !m.mine && m.senderName ? (
                  <p className="mb-0.5 text-[12px] font-semibold text-[#4da3ff]">{m.senderName}</p>
                ) : null}
                {m.forwardOf ? (
                  <p className="mb-1 text-[11px] text-[#8e8e93]">↗ Переслано</p>
                ) : null}
                {m.replyToId ? (
                  <p className="mb-1 rounded-lg bg-black/20 px-2 py-1 text-[11px] text-[#8e8e93]">↩ ответ</p>
                ) : null}
                {m.msgType === 'voice' && m.mediaUrl ? (
                  <>
                    <VoiceBubble url={m.mediaUrl} durationMs={m.durationMs ?? 0} />
                    <TranscriptLine
                      t={m.transcript}
                      mine={m.mine}
                      canRequest={!!canTranscribe && !m.id.startsWith('tmp_')}
                      onRequest={() => onTranscribe?.(m.id)}
                    />
                  </>
                ) : m.viewOnce === 'sealed' ? (
                  <button type="button" className="text-[14px] text-white" onClick={() => onOpenViewOnce?.(m.id)}>
                    Открыть один раз
                  </button>
                ) : m.viewOnce === 'opened' ? (
                  <p className="text-[14px] text-[#8e8e93]">Фото просмотрено</p>
                ) : m.msgType === 'video_note' && m.mediaUrl ? (
                  <>
                    <VideoCirclePlayer url={m.mediaUrl} />
                    <TranscriptLine
                      t={m.transcript}
                      mine={m.mine}
                      canRequest={!!canTranscribe && !m.id.startsWith('tmp_')}
                      onRequest={() => onTranscribe?.(m.id)}
                    />
                  </>
                ) : m.msgType === 'video' && m.mediaUrl ? (
                  <video src={m.mediaUrl} className="mb-1 max-h-56 w-full rounded-xl" controls playsInline preload="metadata" />
                ) : m.msgType === 'file' && m.mediaUrl ? (
                  <FileBubble url={m.mediaUrl} filename={m.body || 'Файл'} />
                ) : m.msgType === 'sticker' && m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="Стикер" className="h-28 w-28 object-contain" decoding="sync" />
                ) : m.msgType === 'gif' && m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="GIF" className="mb-1 max-h-48 rounded-xl" decoding="sync" />
                ) : m.msgType === 'location' ? (
                  <LocationBubble meta={m.meta} />
                ) : m.msgType === 'contact' ? (
                  <ContactBubble meta={m.meta} body={m.body} />
                ) : m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="" className="mb-1 max-h-48 rounded-xl" decoding="sync" />
                ) : null}
                {m.meta?.kind === 'order' ? (
                  <div className="min-w-[180px]">
                    <p className="text-[15px] font-medium">{String(m.meta.title || m.body)}</p>
                    <p className="mt-1 text-[13px] text-[#8e8e93]">
                      {(Number(m.meta.amount_minor) / 100).toFixed(0)} ₽ · {m.meta.status === 'paid' ? 'оплачен' : 'ожидает оплаты'}
                    </p>
                    {payments && !m.mine && m.meta.status !== 'paid' ? (
                      <button
                        type="button"
                        className="mt-2 rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-black"
                        onClick={() => onPayOrder?.(String(m.meta?.order_id || ''))}
                      >
                        Оплатить
                      </button>
                    ) : null}
                  </div>
                ) : m.poll && conversationId ? (
                  <ChatPollCard
                    conversationId={conversationId}
                    messageId={m.id}
                    poll={m.poll}
                    onUpdate={(next) => onPollUpdate?.(m.id, next)}
                  />
                ) : m.body && !hideBody ? (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                ) : null}
                {previewUrl ? <LinkPreviewCard url={previewUrl} /> : null}
                {m.storyQuote ? (
                  <div className="mb-1 rounded-xl border border-white/[0.08] bg-black/25 px-2.5 py-1.5 text-[12px] text-[#a8a8a8]">
                    История{m.storyQuote.body ? `: ${String(m.storyQuote.body).slice(0, 60)}` : ''}
                  </div>
                ) : null}
                {translations?.[m.id] ? (
                  <TranslationLine st={translations[m.id]} onHide={() => onHideTranslation?.(m.id)} />
                ) : null}
                {m.editedAt ? (
                  <button
                    type="button"
                    className="mt-0.5 text-left text-[10px] text-[#8e8e93]"
                    onClick={(e) => {
                      e.stopPropagation()
                      onShowEdits?.(m.id)
                    }}
                  >
                    изменено
                  </button>
                ) : null}
                {m.expiresAt ? <p className="mt-0.5 text-[10px] text-[#8e8e93]">исчезает</p> : null}
                {isGroup && !m.threadRootId ? (
                  <button type="button" className="mt-1 text-left text-[12px] text-[#4da3ff]" onClick={() => onOpenThread?.(m.id)}>
                    {m.threadCount ? `Ветка · ${m.threadCount}` : 'Ветка'}
                  </button>
                ) : null}
                {m.reactions && m.reactions.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.reactions.map((r) => (
                      <span
                        key={r.emoji}
                        className={`rounded-full px-1.5 text-[12px] ${r.mine ? 'bg-white/25' : 'bg-white/10'}`}
                      >
                        {r.emoji} {r.count}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className={`mt-0.5 flex items-center gap-1 text-[10px] text-[#8e8e93] ${m.mine ? 'justify-end' : ''}`}>
                  <span>{formatHm(m.createdAt)}</span>
                  {m.mine && m.receipt ? <ReceiptTicks delivered={!!m.delivered} read={!!m.read} /> : null}
                </p>
              </div>
            </div>
          </div>
        )
      })}

      {typing ? (
        <p className="mt-1 text-[12px] text-[#8e8e93]">печатает…</p>
      ) : null}
      <div ref={bottomRef} />
      </div>
    </div>
  )
}

const CHAT_EMOJIS = ['😀', '😁', '😂', '😊', '😍', '😘', '😎', '😢', '😡', '👍', '👎', '🙏', '🔥', '❤️', '🎉', '✅']

function ChatSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const root = (typeof document !== 'undefined' && document.getElementById('hub-overlay-root')) || document.body
  return createPortal(
    <div className="pointer-events-auto absolute inset-0 z-[var(--hub-z-sheet)] flex items-end justify-center">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Закрыть" onClick={onClose} />
      <div
        className="relative max-h-[85%] w-full overflow-y-auto rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <p className="mb-3 text-center text-[15px] font-semibold text-white">{title}</p>
        <div className="flex flex-col gap-2">{children}</div>
        <button type="button" className="mt-1 w-full py-2 text-center text-[15px] text-[#8e8e93]" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>,
    root,
  )
}

const chatMenuRow = 'pressable rounded-2xl bg-[#2c2c2e] px-4 py-3.5 text-left text-[16px] text-white'

function ChatComposer({
  text,
  setText,
  onSubmit,
  disabled,
  sending,
  pendingMedia,
  pendingLabel,
  onPickMedia,
  onClearMedia,
  onTyping,
  onVoice,
  recording,
  viewOnce,
  onToggleViewOnce,
  onCircle,
  circleRecording,
}: {
  text: string
  setText: (v: string) => void
  onSubmit: (e: FormEvent) => void
  disabled?: boolean
  sending?: boolean
  pendingMedia?: string | null
  pendingLabel?: string | null
  onPickMedia?: () => void
  onClearMedia?: () => void
  onTyping?: () => void
  onVoice?: () => void
  onVideoNote?: () => void
  recording?: boolean
  viewOnce?: boolean
  onToggleViewOnce?: () => void
  onCircle?: () => void
  circleRecording?: boolean
}) {
  const canSend = (text.trim().length > 0 || !!pendingMedia) && !disabled && !sending
  const showSend = canSend && !recording && !circleRecording
  const [emojiOpen, setEmojiOpen] = useState(false)

  return (
    <form
      onSubmit={onSubmit}
      className="flex shrink-0 flex-col gap-2 bg-black px-3 pt-2"
      style={{ paddingBottom: 'max(12px, var(--hub-safe-bottom))' }}
    >
      {pendingMedia ? (
        <div className="flex items-center justify-between rounded-2xl bg-[#1c1c1e] px-3 py-2 text-[13px] text-[#8e8e93]">
          <span className="truncate">{pendingLabel || 'Фото прикреплено'}</span>
          {onToggleViewOnce ? (
            <button type="button" className="shrink-0 text-white" onClick={onToggleViewOnce}>
              {viewOnce ? 'Один раз' : 'Обычное'}
            </button>
          ) : null}
          <button type="button" className="shrink-0 text-white" onClick={onClearMedia}>
            Убрать
          </button>
        </div>
      ) : null}
      {emojiOpen ? (
        <div className="flex flex-wrap gap-1 rounded-2xl bg-[#1c1c1e] px-2 py-2">
          {CHAT_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="pressable flex h-11 w-11 items-center justify-center text-[22px] active:scale-95 active:opacity-55"
              onClick={() => {
                setText(text + emoji)
                onTyping?.()
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <div className="hub-composer-row">
        <button
          type="button"
          className="hub-circle-btn"
          aria-label="Прикрепить"
          onClick={onPickMedia}
        >
          <IconPlus size={22} strokeWidth={1.6} />
        </button>
        <div className="hub-composer-pill">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              onTyping?.()
            }}
            placeholder="Сообщение"
            className="min-h-[40px] w-full flex-1 bg-transparent py-2.5 text-[15px] text-white placeholder:text-[#8e8e93]"
          />
          <button
            type="button"
            aria-label="Эмодзи"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <IconSmile size={22} strokeWidth={1.6} />
          </button>
        </div>
        {showSend ? (
          <button
            type="submit"
            disabled={sending}
            className="hub-circle-btn disabled:opacity-60"
            aria-label="Отправить"
          >
            <IconPlane size={22} strokeWidth={1.6} />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="hub-circle-btn"
              data-alert={circleRecording ? 'true' : undefined}
              aria-label={circleRecording ? 'Остановить кружок' : 'Кружок'}
              onClick={onCircle}
            >
              <IconPlayCircle size={22} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className="hub-circle-btn"
              data-alert={recording ? 'true' : undefined}
              aria-label={recording ? 'Остановить запись' : 'Голосовое'}
              onClick={onVoice}
            >
              <IconMic size={22} strokeWidth={1.6} />
            </button>
          </>
        )}
      </div>
    </form>
  )
}

function TopBar({
  name,
  username,
  subtitle,
  avatar,
  id,
  onBack,
  onMenu,
  onOpenInfo,
  onSearch,
  isGroup,
  onAudioCall,
  onVideoCall,
}: {
  name: string
  username: string
  subtitle?: string
  avatar?: string
  id: string
  onBack: () => void
  onMenu?: () => void
  onOpenInfo?: () => void
  onSearch?: () => void
  isGroup?: boolean
  onAudioCall?: () => void
  onVideoCall?: () => void
}) {
  const title = isGroup ? name : (username || name)
  const sub = subtitle || (!isGroup && name && name !== username ? name : '')
  return (
    <header className="safe-top z-10 shrink-0 bg-black px-2 pb-1 pt-1">
      <div className="hub-chat-bar flex h-[52px] items-center">
        <button
          type="button"
          onClick={onBack}
          className="hub-circle-btn"
          aria-label="Назад"
        >
          <IconChevron size={22} strokeWidth={1.6} className="-scale-x-100" />
        </button>
        <button
          type="button"
          disabled={!onOpenInfo && !isGroup}
          onClick={onOpenInfo}
          className={`hub-title-pill min-w-0 flex-1 ${onOpenInfo ? 'pressable' : 'pointer-events-none'}`}
          aria-label={isGroup ? 'О группе' : 'Профиль'}
        >
          <Avatar name={name || username} id={id} src={avatar} size={36} />
          <div className="min-w-0 flex-1 pr-1 text-left">
            <div className="truncate text-[16px] font-semibold leading-tight text-white">
              {title}
            </div>
            {sub ? (
              <div className="truncate text-[13px] leading-tight text-[#8e8e93]">{sub}</div>
            ) : null}
          </div>
        </button>
        {onSearch ? (
          <button
            type="button"
            className="hub-circle-btn"
            onClick={onSearch}
            aria-label="Поиск"
          >
            <IconSearch size={22} strokeWidth={1.6} />
          </button>
        ) : null}
        {onAudioCall ? (
          <button
            type="button"
            data-chat-audio-call=""
            className="hub-circle-btn"
            aria-label="Аудиозвонок"
            onClick={onAudioCall}
          >
            <IconPhone size={28} strokeWidth={2} />
          </button>
        ) : null}
        {onVideoCall ? (
          <button
            type="button"
            data-chat-video-call=""
            className="hub-circle-btn"
            aria-label="Видеозвонок"
            onClick={onVideoCall}
          >
            <IconVideo size={22} strokeWidth={1.6} />
          </button>
        ) : null}
        {onMenu ? (
          <button
            type="button"
            className="hub-circle-btn"
            onClick={onMenu}
            aria-label="Ещё"
          >
            <IconMore size={28} strokeWidth={1.8} />
          </button>
        ) : (
          <span className="hub-circle-btn opacity-0 pointer-events-none" aria-hidden />
        )}
      </div>
    </header>
  )
}

function mergeIncoming(prev: ApiMessage[], msg: ApiMessage): ApiMessage[] {
  const idx = prev.findIndex(
    (m) => m.id === msg.id || (!!msg.client_id && !!m.client_id && m.client_id === msg.client_id),
  )
  if (idx >= 0) {
    const next = prev.slice()
    next[idx] = { ...prev[idx], ...msg }
    return next
  }
  return [...prev.filter((m) => !(m.id.startsWith('tmp_') && msg.client_id && m.client_id === msg.client_id)), msg]
}

export function Chat() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const { motionClass, dismiss } = useNavMotion('push')
  const navigate = useNavigate()
  const uid = useStore((s) => s.currentUserId)!
  const conversations = useStore((s) => s.conversations)
  const conversation = useMemo(
    () => conversations.find((c) => c.id === id),
    [conversations, id],
  )
  const allMessages = useStore((s) => s.messages)
  const localMessages = useMemo(
    () =>
      allMessages
        .filter((m) => m.conversationId === id)
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [allMessages, id],
  )
  const users = useStore((s) => s.users)
  const other = useMemo(() => {
    if (!conversation) return undefined
    const oid = conversation.participantIds.find((x) => x !== uid)
    return users.find((u) => u.id === oid)
  }, [conversation, users, uid])
  const sendMessage = useStore((s) => s.sendMessage)
  const markRead = useStore((s) => s.markConversationRead)
  const showToast = useStore((s) => s.showToast)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const threadContentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const api = isApiMode()

  const [apiConv, setApiConv] = useState<ApiConversation | null>(() => (id ? peekConv(id) : null))
  const [liveSeen, setLiveSeen] = useState('')
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>(() => (id ? peekMsgs(id) : []))
  const [loading, setLoading] = useState(() => api && !(id && peekMsgs(id).length))
  const [sending, setSending] = useState(false)
  const outboundLock = useRef(false)
  const [pendingMedia, setPendingMedia] = useState<string | null>(null)
  const [pendingMediaKind, setPendingMediaKind] = useState<'image' | 'file'>('image')
  const [pendingFilename, setPendingFilename] = useState<string | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [pollQ, setPollQ] = useState('')
  const [pollOpts, setPollOpts] = useState(['', ''])
  const [pollMulti, setPollMulti] = useState(false)
  const [pollAnon, setPollAnon] = useState(true)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [actionMsgId, setActionMsgId] = useState<string | null>(null)
  const [features, setFeatures] = useState({ transcribe: false, translate: false, ai: false, payments: false, stickers: false })
  const [translations, setTranslations] = useState<Record<string, TranslationView>>({})
  const transcriptPolls = useRef(new Set<string>())
  const convRef = useRef(id)
  convRef.current = id
  const mediaRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoFileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [typingUserId, setTypingUserId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recRef = useRef<{
    rec: MediaRecorder
    stream: MediaStream
    chunks: BlobPart[]
    started: number
    stopped: Promise<Blob>
  } | null>(null)
  const recTimerRef = useRef<number | null>(null)
  const [replyTo, setReplyTo] = useState<ApiMessage | null>(null)
  const [forwardMsgId, setForwardMsgId] = useState<string | null>(null)
  const [forwardTargets, setForwardTargets] = useState<ApiConversation[]>([])
  const [forwardLoading, setForwardLoading] = useState(false)
  const [reactPickerMsgId, setReactPickerMsgId] = useState<string | null>(null)
  const [disappearHours, setDisappearHours] = useState<number | null>(null)
  const [disappearAfterRead, setDisappearAfterRead] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [livePanel, setLivePanel] = useState<null | 'summary' | 'disappear' | 'sticker' | 'order' | 'seller'>(null)
  const [summaryText, setSummaryText] = useState('')
  const [summaryOff, setSummaryOff] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionOff, setSuggestionOff] = useState('')
  const [stickerOff, setStickerOff] = useState('')
  const [sellerBody, setSellerBody] = useState('')
  const [sellerId, setSellerId] = useState('')
  const [sellerOff, setSellerOff] = useState('')
  const [viewOncePending, setViewOncePending] = useState(false)
  const [onceUrl, setOnceUrl] = useState('')
  const [threadRoot, setThreadRoot] = useState<string | null>(null)
  const [threadItems, setThreadItems] = useState<ApiMessage[]>([])
  const [threadText, setThreadText] = useState('')
  const [circlePreview, setCirclePreview] = useState<{ url: string; file: File; durationMs: number } | null>(null)
  const [circleRecording, setCircleRecording] = useState(false)
  const circleRef = useRef<{ rec: MediaRecorder; stream: MediaStream; started: number; stopped: Promise<Blob> } | null>(null)
  const circleCancel = useRef(false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [mediaItems, setMediaItems] = useState<{ id: string; media_url: string; msg_type: string }[]>([])
  const [pinnedMsg, setPinnedMsg] = useState<{ id: string; body?: string } | null>(null)
  const videoNoteRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchHits, setSearchHits] = useState<ApiMessage[]>([])
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState<ApiMessage | null>(null)
  const [readersFor, setReadersFor] = useState<string | null>(null)
  const [readers, setReaders] = useState<ApiMessageReader[]>([])
  const [readersLoading, setReadersLoading] = useState(false)
  const [editsFor, setEditsFor] = useState<string | null>(null)
  const [editHistory, setEditHistory] = useState<ApiMessageEdits | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const searchFromUrl = searchParams.get('q') || ''
  useEffect(() => {
    const initial = searchFromUrl.trim()
    if (initial.length >= 2) {
      setSearchOpen(true)
      setSearchQ(searchFromUrl)
    } else {
      setSearchOpen(false)
      setSearchQ('')
      setSearchHits([])
    }
    setEditing(null)
  }, [id, searchFromUrl])

  useEffect(() => {
    if (!api || !searchOpen) return
    const q = searchQ.trim()
    if (q.length < 2) {
      setSearchHits([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      void apiSearchMessages(q, id)
        .then((r) => {
          if (!cancelled) setSearchHits(r.items ?? [])
        })
        .catch(() => {
          if (!cancelled) setSearchHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [api, searchOpen, searchQ, id])

  useEffect(() => {
    if (!readersFor || !id || !api) return
    let cancelled = false
    setReadersLoading(true)
    void apiMessageReaders(id, readersFor)
      .then((r) => {
        if (!cancelled) setReaders(r.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setReaders([])
      })
      .finally(() => {
        if (!cancelled) setReadersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [readersFor, id, api])

  useEffect(() => {
    if (!editsFor || !id || !api) {
      setEditHistory(null)
      return
    }
    let cancelled = false
    void apiMessageEdits(id, editsFor)
      .then((r) => {
        if (!cancelled) setEditHistory(r)
      })
      .catch(() => {
        if (!cancelled) setEditHistory(null)
      })
    return () => {
      cancelled = true
    }
  }, [editsFor, id, api])

  const stopVoiceRecording = useCallback(async () => {
    if (outboundLock.current) return
    const ctx = recRef.current
    if (!ctx) return
    outboundLock.current = true
    recRef.current = null
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (ctx.rec.state === 'recording') ctx.rec.stop()
    ctx.stream.getTracks().forEach((tr) => tr.stop())
    setRecording(false)
    const raw = await ctx.stopped
    let blob = raw
    let durationMs = Math.min(120000, Date.now() - ctx.started)
    try {
      const trimmed = await trimSilence(raw)
      blob = trimmed.blob
      durationMs = Math.min(120000, trimmed.durationMs)
    } catch {
      /* keep the original recording when the browser cannot decode it */
    }
    recRef.current = null
    setRecSeconds(0)
    if (!id || durationMs < 400) {
      outboundLock.current = false
      if (id && durationMs < 400) showToast('Слишком коротко')
      return
    }
    const clientId = newClientId()
    try {
      const type = blob.type || 'audio/webm'
      const ext = /mp4|m4a|aac/i.test(type) ? 'm4a' : /ogg/i.test(type) ? 'ogg' : /wav/i.test(type) ? 'wav' : 'webm'
      const file = new File([blob], `voice.${ext}`, { type })
      const media = await apiUploadMedia(file)
      const msg = await apiSendVoice(id, media.url, durationMs, clientId)
      setApiMessages((prev) => mergeIncoming(prev, msg))
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось записать')
    } finally {
      outboundLock.current = false
    }
  }, [id, showToast])

  const startVoiceRecording = useCallback(async () => {
    if (isVoiceModeOn()) {
      requestVoiceCapture('chat')
      return
    }
    if (!id || !navigator.mediaDevices?.getUserMedia) {
      showToast('Микрофон недоступен')
      return
    }
    if (outboundLock.current) return
    if (recording) {
      await stopVoiceRecording()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: voiceCaptureConstraints })
      const rec = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      const started = Date.now()
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data)
      }
      const stopped = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
      })
      rec.start()
      recRef.current = { rec, stream, chunks, started, stopped }
      setRecording(true)
      setRecSeconds(0)
      recTimerRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - started) / 1000)
        setRecSeconds(sec)
        if (sec >= 120) void stopVoiceRecording()
      }, 250)
      showToast('Запись… нажмите Стоп')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось записать')
    }
  }, [id, recording, showToast, stopVoiceRecording])

  const startCircle = useCallback(async () => {
    if (circleRef.current || !navigator.mediaDevices?.getUserMedia) return
    circleCancel.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 480, height: 480 },
        audio: voiceCaptureConstraints,
      })
      const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data)
      }
      const stopped = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))
      })
      rec.start()
      if (circleCancel.current) {
        rec.stop()
        stream.getTracks().forEach((tr) => tr.stop())
        return
      }
      circleRef.current = { rec, stream, started: Date.now(), stopped }
      setCircleRecording(true)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Камера недоступна')
    }
  }, [showToast])

  const stopCircle = useCallback(async () => {
    const ctx = circleRef.current
    if (!ctx) {
      circleCancel.current = true
      return
    }
    circleRef.current = null
    setCircleRecording(false)
    if (ctx.rec.state === 'recording') ctx.rec.stop()
    ctx.stream.getTracks().forEach((tr) => tr.stop())
    const durationMs = Date.now() - ctx.started
    const blob = await ctx.stopped
    if (durationMs < 400) {
      showToast('Слишком коротко')
      return
    }
    const file = new File([blob], 'circle.webm', { type: blob.type || 'video/webm' })
    setCirclePreview({ url: URL.createObjectURL(blob), file, durationMs: Math.min(60000, durationMs) })
  }, [showToast])

  const openSummary = useCallback(async () => {
    if (!id) return
    setLivePanel('summary')
    setSummaryLoading(true)
    setSummaryOff('')
    setSummaryText('')
    try {
      const res = await apiCatchUp(id)
      if (res.disabled) setSummaryOff(res.message || 'AI не подключён')
      else setSummaryText(res.summary || '')
    } catch (e) {
      setSummaryOff(e instanceof Error ? e.message : 'AI не подключён')
    } finally {
      setSummaryLoading(false)
    }
  }, [id])

  const openSuggestions = useCallback(async () => {
    if (!id) return
    setSuggestionOff('')
    try {
      const res = await apiReplySuggestions(id)
      if (res.disabled) {
        setSuggestions([])
        setSuggestionOff(res.message || 'AI не подключён')
        return
      }
      setSuggestions(res.suggestions ?? [])
    } catch (e) {
      setSuggestionOff(e instanceof Error ? e.message : 'AI не подключён')
    }
  }, [id])

  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'missed') void openSummary()
      else if (action === 'replies') void openSuggestions()
      else if (action === 'translate-on' || action === 'translate-off') {
        if (!id) return
        void apiSetTranslatePref(id, action === 'translate-on').then((res) => {
          if (res.disabled || res.message) showToast(res.message || 'Перевод не подключён')
          else showToast(res.enabled ? 'Перевод включён' : 'Перевод выключен')
        })
      }       else if (action === 'remind') setScheduleOpen(true)
      else if (action === 'disappear') setLivePanel('disappear')
      else if (action === 'sticker') setLivePanel('sticker')
      else if (action === 'order') setLivePanel('order')
      else if (action === 'seller') setLivePanel('seller')
      else if (action === 'thread') showToast('Нажмите «Ветка» у сообщения')
    }
    window.addEventListener('hub:chat-action', onAction)
    return () => window.removeEventListener('hub:chat-action', onAction)
  }, [id, openSummary, openSuggestions, showToast])

  const loadApi = useCallback(async () => {
    if (!isApiMode() || !id) return
    setError(null)
    try {
      const [convs, msgs] = await Promise.all([
        apiListConversations(),
        apiListMessages(id, 50),
      ])
      const found = (convs.items ?? []).find((c) => c.id === id) ?? null
      setApiConv(found)
      const items = msgs.items ?? []
      setApiMessages(items)
      void apiMarkDelivered(id).catch(() => {})
      if (id) cacheSet('msgs_' + id, msgs)
      const pinned = (msgs as any).pinned_message as { id: string; body?: string } | undefined
      setPinnedMsg(pinned ?? null)
      if (id) {
        void apiGetDisappear(id).then((d) => {
          setDisappearHours(d.disappear_hours)
          setDisappearAfterRead(!!d.disappear_after_read)
        }).catch(() => {})
      }
      try {
        await apiMarkConversationRead(id)
      } catch {
        // ignore
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить чат')
    } finally {
      setLoading(false)
    }
  }, [id])

  const shownId = useRef(id)
  if (shownId.current !== id) {
    shownId.current = id
    const peeked = id ? peekMsgs(id) : []
    setApiConv(id ? peekConv(id) : null)
    setApiMessages(peeked)
    setLoading(api && peeked.length === 0)
    setError(null)
  }

  useEffect(() => {
    void loadApi()
  }, [loadApi, id])

  useEffect(() => {
    setTranslations({})
    transcriptPolls.current.clear()
  }, [id])

  useEffect(() => {
    if (!api) return
    let live = true
    void apiFeatures()
      .then((f) => {
        if (live) setFeatures({ transcribe: !!f.transcribe, translate: !!f.translate, ai: !!f.ai, payments: !!f.payments, stickers: f.stickers !== undefined ? !!f.stickers : !!f.ai })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [api])

  const applyTranscript = useCallback((t: ApiTranscript) => {
    if (!t?.message_id) return
    setApiMessages((prev) => prev.map((m) => (m.id === t.message_id ? { ...m, transcript: t } : m)))
  }, [])

  const pollTranscript = useCallback((messageId: string) => {
    const conv = convRef.current
    if (!conv || transcriptPolls.current.has(messageId)) return
    transcriptPolls.current.add(messageId)
    const started = Date.now()
    const tick = () => {
      if (convRef.current !== conv) {
        transcriptPolls.current.delete(messageId)
        return
      }
      if (Date.now() - started > 420_000) {
        transcriptPolls.current.delete(messageId)
        return
      }
      void apiGetTranscript(conv, messageId)
        .then((t) => {
          if (t.status !== 'pending' && t.status !== 'processing') {
            applyTranscript(t)
            transcriptPolls.current.delete(messageId)
            return
          }
          window.setTimeout(tick, 2500)
        })
        .catch(() => {
          window.setTimeout(tick, 2500)
        })
    }
    window.setTimeout(tick, 2500)
  }, [applyTranscript])

  const requestTranscript = useCallback((messageId: string) => {
    const conv = convRef.current
    if (!conv) return
    void apiRequestTranscript(conv, messageId)
      .then((t) => {
        applyTranscript(t)
        if (t.status === 'done' || t.status === 'failed') return
        pollTranscript(messageId)
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось расшифровать'))
  }, [applyTranscript, pollTranscript, showToast])

  const translateMessage = useCallback((messageId: string) => {
    const conv = convRef.current
    if (!conv) return
    setTranslations((prev) => ({ ...prev, [messageId]: { loading: true } }))
    void apiTranslateMessage(conv, messageId, uiLang())
      .then((t) => setTranslations((prev) => ({ ...prev, [messageId]: { text: t.text, source: t.source } })))
      .catch((e) => setTranslations((prev) => ({
        ...prev,
        [messageId]: { error: e instanceof Error ? e.message : 'Не удалось перевести' },
      })))
  }, [])

  useEffect(() => {
    if (!api || !id) return
    for (const m of apiMessages) {
      const st = m.transcript?.status
      if ((m.msg_type === 'voice' || m.msg_type === 'video_note') && (st === 'pending' || st === 'processing')) {
        pollTranscript(m.id)
      }
    }
  }, [api, id, apiMessages, pollTranscript])

  // Realtime: WebSocket push + short poll backup (≤500ms when WS down)
  useEffect(() => {
    if (!api || !id) return
    let cancelled = false
    const mergeItems = (items: ApiMessage[]) => {
      setApiMessages((prev) => {
        if (
          prev.length === items.length &&
          prev.every((m, i) => {
            const n = items[i]
            return (
              m.id === n?.id &&
              m.read === n?.read &&
              m.delivered === n?.delivered &&
              m.edited_at === n?.edited_at &&
              m.body === n?.body &&
              (m.reactions?.length ?? 0) === (n?.reactions?.length ?? 0) &&
              (m.poll?.total_voters ?? 0) === (n?.poll?.total_voters ?? 0) &&
              (m.poll?.my_votes ?? []).join(',') === (n?.poll?.my_votes ?? []).join(',') &&
              !!m.poll?.closed === !!n?.poll?.closed &&
              m.transcript?.status === n?.transcript?.status &&
              m.transcript?.text === n?.transcript?.text
            )
          })
        ) {
          return prev
        }
        const prevById = new Map(prev.map((m) => [m.id, m]))
        const byId = new Map(items.map((m) => [m.id, m]))
        const merged: typeof items = []
        const seen = new Set<string>()
        for (const m of items) {
          const old = prevById.get(m.id)
          merged.push(!m.transcript && old?.transcript ? { ...m, transcript: old.transcript } : m)
          seen.add(m.id)
        }
        for (const m of prev) {
          if (!seen.has(m.id) && !byId.has(m.id) && m.id.startsWith('tmp_')) {
            const echoed = !!m.client_id && items.some((n) => n.client_id === m.client_id)
            if (!echoed) merged.push(m)
          }
        }
        return merged
      })
    }
    const tick = async () => {
      try {
        const msgs = await apiListMessages(id, 50)
        if (cancelled) return
        const items = msgs.items ?? []
        setTypingUserId(msgs.typing_user_id ?? null)
        if (msgs.peer_last_seen_label) setLiveSeen(msgs.peer_last_seen_label)
        mergeItems(items)
      } catch {
        // ignore transient poll errors
      }
    }
    const unsub = chatWsSubscribe(id, (ev) => {
      if (cancelled) return
      if (ev.type === 'message' && ev.conversation_id === id && ev.message) {
        const msg = ev.message as ApiMessage
        setApiMessages((prev) => mergeIncoming(prev, msg))
      } else if (ev.type === 'transcript' && ev.conversation_id === id) {
        const t = (ev as { transcript?: ApiTranscript }).transcript
        if (t?.message_id) applyTranscript(t)
      } else if (ev.type === 'typing' && ev.conversation_id === id && (ev as any).user_id) {
        setTypingUserId(String((ev as any).user_id))
      }
    })
    void tick()
    let timer = 0
    const arm = () => {
      if (cancelled) return
      const wait = chatWsConnected() ? 60_000 : 15_000
      timer = window.setTimeout(() => {
        void tick().finally(() => {
          if (!cancelled) arm()
        })
      }, wait)
    }
    arm()
    return () => {
      cancelled = true
      unsub()
      window.clearTimeout(timer)
    }
  }, [api, id, applyTranscript])

  useEffect(() => {
    if (!api && id) markRead(id)
  }, [api, id, markRead, localMessages.length])

  useEffect(() => {
    const onClear = () => {
      setPendingMedia(null)
      setPendingFilename(null)
      setPendingMediaKind('image')
    }
    window.addEventListener('hub:voice-clear-pending', onClear)
    return () => window.removeEventListener('hub:voice-clear-pending', onClear)
  }, [])

  const messageCount = api ? apiMessages.length : localMessages.length
  const pinToLatest = useCallback(() => {
    const el = threadRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    stickToBottomRef.current = true
  }, [id])

  useEffect(() => {
    const el = threadRef.current
    const content = threadContentRef.current
    if (!el) return
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = gap < 96
    }
    const onMedia = () => pinToLatest()
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('load', onMedia, true)
    el.addEventListener('loadedmetadata', onMedia, true)
    const ro = new ResizeObserver(() => pinToLatest())
    if (content) ro.observe(content)
    pinToLatest()
    const raf = window.requestAnimationFrame(() => {
      pinToLatest()
      window.requestAnimationFrame(pinToLatest)
    })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('load', onMedia, true)
      el.removeEventListener('loadedmetadata', onMedia, true)
      ro.disconnect()
      window.cancelAnimationFrame(raf)
    }
  }, [id, messageCount, pinToLatest])

  const dictationMessages = useMemo((): DictMessage[] => {
    if (api) {
      return apiMessages.map((m) => ({
        id: m.id,
        mine: sameUser(m.sender_id, uid),
        text: m.body || '',
        media: Boolean(m.media_url) || (!!m.msg_type && m.msg_type !== 'text'),
      }))
    }
    return localMessages.map((m) => ({
      id: m.id,
      mine: m.senderId === uid,
      text: m.text,
      media: false,
    }))
  }, [api, apiMessages, localMessages, uid])

  const onDictationSendText = useCallback(async (body: string, replyToId?: string) => {
    if (!id || outboundLock.current) return
    if (!isApiMode()) {
      sendMessage(id, body)
      return
    }
    const clientId = newClientId()
    if (isBrowserOffline()) {
      enqueueOffline('message', { conversationId: id, body, reply_to_id: replyToId, client_id: clientId }, body.slice(0, 40) || 'Сообщение')
      throw new Error('Текст сохранён и уйдёт, когда появится сеть')
    }
    outboundLock.current = true
    try {
      const msg = await apiSendMessageFull(id, { body, reply_to_id: replyToId, client_id: clientId })
      setApiMessages((prev) => mergeIncoming(prev, msg))
    } finally {
      outboundLock.current = false
    }
  }, [id, sendMessage])

  const onDictationSendVoice = useCallback(async (blob: Blob, durationMs: number) => {
    if (!id || !isApiMode()) throw new Error('Это доступно при подключении к серверу')
    if (outboundLock.current) return
    if (isBrowserOffline()) throw new Error('Нет сети. Сообщение не отправлено')
    outboundLock.current = true
    try {
      const stored = await storeVoiceRecording(blob, 'voice.webm')
      const msg = await apiSendVoice(id, stored.url, durationMs, newClientId())
      setApiMessages((prev) => mergeIncoming(prev, msg))
    } finally {
      outboundLock.current = false
    }
  }, [id])

  const onDictationEdit = useCallback(async (messageId: string, body: string) => {
    if (!id || !isApiMode()) throw new Error('Это доступно при подключении к серверу')
    const msg = await apiEditMessage(id, messageId, body)
    setApiMessages((prev) => prev.map((item) => (item.id === messageId ? { ...item, ...msg, body } : item)))
  }, [id])

  const onDictationDelete = useCallback(async (messageId: string) => {
    if (!id || !isApiMode()) throw new Error('Это доступно при подключении к серверу')
    await apiDeleteMessage(id, messageId)
    setApiMessages((prev) => prev.filter((item) => item.id !== messageId))
  }, [id])

  const onDictationReply = useCallback((messageId: string | null) => {
    if (!messageId) {
      setReplyTo(null)
      return
    }
    const found = apiMessages.find((item) => item.id === messageId)
    if (found) setReplyTo(found)
  }, [apiMessages])

  const dictationDock = (
    <DictationDock
      surface="chat"
      messages={dictationMessages}
      focusedId={dictationMessages[dictationMessages.length - 1]?.id ?? null}
      replyToId={replyTo?.id ?? null}
      composerText={text}
      canSendVoice={api}
      canMutate={api}
      onFillComposer={setText}
      onSetReply={onDictationReply}
      onSendText={onDictationSendText}
      onSendVoice={onDictationSendVoice}
      onEdit={onDictationEdit}
      onDelete={onDictationDelete}
    />
  )

  if (api) {
    const resolvedPeer = resolveChatPeer(apiConv, apiMessages, uid)
    const peer = resolvedPeer.peer
    const chatIsGroup = resolvedPeer.isGroup
    const seenLabel = chatIsGroup
      ? ''
      : (liveSeen || peer?.last_seen_label || formatPresence(peer?.last_seen_at, peer?.gender))
    const onSend = async (e: FormEvent) => {
      e.preventDefault()
      if (outboundLock.current) return
      if (editing && id) {
        const next = text.trim()
        if (!next) return
        outboundLock.current = true
        setSending(true)
        try {
          const msg = await apiEditMessage(id, editing.id, next)
          setApiMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)))
          setEditing(null)
          setText('')
          showToast('Изменено')
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Не удалось изменить')
        } finally {
          outboundLock.current = false
          setSending(false)
        }
        return
      }
      if ((!text.trim() && !pendingMedia) || !id) return
      const body = text.trim()
      const clientId = newClientId()
      const media = pendingMedia
      const sendKind = pendingMediaKind
      const sendName = pendingFilename
      setText('')
      setPendingMedia(null)
      outboundLock.current = true
      setSending(true)
      const replyId = replyTo?.id
      setReplyTo(null)
      try {
        if (isBrowserOffline()) {
          enqueueOffline(
            'message',
            { conversationId: id, body: body || (media ? ' ' : ''), media_url: media || undefined, client_id: clientId },
            body.slice(0, 40) || 'Сообщение',
          )
          showToast('Сообщение · ждёт сеть')
          return
        }
        const kind = media ? sendKind : 'text'
        const fileBody =
          kind === 'file'
            ? body || sendName || '📎 Файл'
            : body || (media ? ' ' : '')
        const msg = await apiSendMessageFull(id, {
          body: fileBody,
          media_url: media || undefined,
          msg_type: kind === 'file' ? 'file' : media ? 'image' : 'text',
          reply_to_id: replyId,
          view_once: kind !== 'file' && !!media && viewOncePending,
          thread_root_id: threadRoot || undefined,
          client_id: clientId,
        })
        setViewOncePending(false)
        setPendingMediaKind('image')
        setPendingFilename(null)
        setApiMessages((prev) => mergeIncoming(prev, msg))
      } catch (err) {
        setText(body)
        if (replyId) {
          const found = apiMessages.find((m) => m.id === replyId)
          if (found) setReplyTo(found)
        }
        showToast(err instanceof Error ? err.message : 'Не отправилось')
      } finally {
        outboundLock.current = false
        setSending(false)
      }
    }

    if (!peer) {
      if (loading) {
        return (
          <div className={`flex h-full items-center justify-center bg-black text-[#8e8e93] ${motionClass}`}>
            Загрузка…
          </div>
        )
      }
      return (
        <div className={`flex h-full flex-col items-center justify-center bg-black px-6 text-center ${motionClass}`}>
          <p className="text-[#8e8e93]">{error ?? 'Диалог не найден'}</p>
          <Link to="/app/messages" className="mt-6 text-sm text-white underline">
            Назад
          </Link>
        </div>
      )
    }

    const bubbles: BubbleMsg[] = apiMessages.map((m) => ({
      id: m.id,
      mine: sameUser(m.sender_id, uid),
      body: m.body,
      mediaUrl: m.media_url,
      createdAt: m.created_at,
      msgType: m.msg_type,
      durationMs: m.duration_ms,
      read: m.read,
      delivered: m.delivered,
      receipt: true,
      replyToId: m.reply_to_id,
      forwardOf: m.forward_of,
      reactions: m.reactions,
      editedAt: m.edited_at,
      expiresAt: m.expires_at,
      storyQuote: m.story_quote,
      meta: m.meta ?? undefined,
      senderName: m.sender?.display_name || m.sender?.username || m.sender_name,
      senderAvatar: m.sender?.avatar_url,
      senderId: m.sender?.id || m.sender_id,
      poll: m.poll,
      transcript: m.transcript,
      callMeta: m.call_meta,
      viewOnce: m.view_once,
      threadCount: m.thread_count,
      threadRootId: m.thread_root_id,
    }))

    const showingSearchHits = searchOpen && searchQ.trim().length >= 2
    // Threads DM: always pure black (ignore chat wallpaper themes)
    return (
      <div className={`flex h-full flex-col bg-black ${motionClass}`}>
        <TopBar
          onBack={() => dismiss('/app/messages')}
          name={chatIsGroup ? (apiConv?.title || peer.display_name || 'Группа') : (peer.display_name || peer.username)}
          username={peer.username}
          subtitle={chatIsGroup ? (apiConv?.member_count != null ? ruParticipants(apiConv.member_count) : undefined) : (seenLabel || (peer?.display_name && peer.display_name !== peer?.username ? peer.display_name : undefined))}
          avatar={(chatIsGroup ? (apiConv?.avatar_url || peer.avatar_url) : peer.avatar_url) || undefined}
          id={chatIsGroup ? (apiConv?.id || peer.id) : peer.id}
          isGroup={chatIsGroup}
          onOpenInfo={chatIsGroup && id ? () => navigate(`/app/messages/${id}/settings`) : (peer.id ? () => navigate(`/app/profile/${peer.id}`) : undefined)}
          onSearch={() => {
            setSearchOpen((open) => {
              if (open) {
                setSearchQ('')
                setSearchHits([])
              }
              return !open
            })
          }}
          onMenu={() => setHeaderMenuOpen(true)}
          onAudioCall={chatIsGroup ? () => showToast('Групповые звонки недоступны') : peer.id && !sameUser(peer.id, uid) ? () => requestOutgoingCall({
            conversationId: id || '',
            peerId: peer.id,
            peerName: peer.display_name || peer.username,
            peerAvatar: peer.avatar_url,
            video: false,
          }) : undefined}
          onVideoCall={chatIsGroup ? () => showToast('Групповые звонки недоступны') : peer.id && !sameUser(peer.id, uid) ? () => requestOutgoingCall({
            conversationId: id || '',
            peerId: peer.id,
            peerName: peer.display_name || peer.username,
            peerAvatar: peer.avatar_url,
            video: true,
          }) : undefined}
        />
        {searchOpen ? (
          <div className="shrink-0 px-3 pb-2">
            <div className="hub-search-pill">
              <IconSearch size={16} className="shrink-0 text-[#8e8e93]" />
              <input
                value={searchQ}
                autoFocus
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Поиск в чате"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="search"
              />
            </div>
          </div>
        ) : null}
        {scheduleOpen && id ? (
          <ToolSheet title="Отложить" onClose={() => setScheduleOpen(false)}>
            <ScheduleFields
              onSchedule={(body, iso) => {
                void apiScheduleDM(id, body, iso)
                  .then(() => { showToast('Запланировано'); setScheduleOpen(false) })
                  .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
              }}
              onRemind={(iso) => {
                void apiCreateReminder(id, iso, 'Ответить позже')
                  .then(() => { showToast('Напомню ответить'); setScheduleOpen(false) })
                  .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
              }}
            />
          </ToolSheet>
        ) : null}
        {showingSearchHits ? (
          <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-4">
            {searching ? <p className="py-8 text-center text-[14px] text-[#8e8e93]">Поиск…</p> : null}
            {!searching && !searchHits.length ? (
              <p className="py-8 text-center text-[14px] text-[#8e8e93]">Ничего не найдено</p>
            ) : null}
            {searchHits.map((h) => (
              <button
                key={h.id}
                type="button"
                className="pressable w-full rounded-2xl px-3 py-3 text-left hover:bg-white/[0.04]"
                onClick={() => {
                  setSearchOpen(false)
                  setSearchQ('')
                  setHighlightId(h.id)
                  window.setTimeout(() => setHighlightId(null), 2500)
                  requestAnimationFrame(() => {
                    const el = document.getElementById(`msg-${h.id}`)
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    else showToast('Сообщение выше загруженной истории')
                  })
                }}
              >
                <p className="line-clamp-2 text-[14px] text-white">{h.body}</p>
                <p className="mt-0.5 text-[12px] text-[#8e8e93]">
                  {h.sender_name ? `${h.sender_name} · ` : ''}
                  {formatChatDate(h.created_at)}
                </p>
              </button>
            ))}
          </div>
        ) : (
        <ChatThread
          typing={!!typingUserId}
          messages={bubbles}
          peerName={chatIsGroup ? (apiConv?.title || peer.display_name || 'Группа') : (peer.display_name || peer.username)}
          peerUsername={chatIsGroup ? (apiConv?.title || 'Группа') : peer.username}
          peerAvatar={(chatIsGroup ? (apiConv?.avatar_url || peer.avatar_url) : peer.avatar_url) || undefined}
          peerId={chatIsGroup ? (apiConv?.id || '') : peer.id}
          profileTo={chatIsGroup && id ? `/app/messages/${id}/settings` : `/app/profile/${peer.id}`}
          profileLabel={chatIsGroup ? 'О группе' : 'Посмотреть профиль'}
          peerSubtitle={chatIsGroup ? (apiConv?.member_count != null ? ruParticipants(apiConv.member_count) : undefined) : (peer.display_name && peer.display_name !== peer.username ? peer.display_name : undefined)}
          isGroup={chatIsGroup}
          highlightId={highlightId}
          onShowEdits={(msgId) => setEditsFor(msgId)}
          conversationId={id}
          onPollUpdate={(mid, next) => {
            setApiMessages((prev) => prev.map((m) => (m.id === mid ? { ...m, poll: next } : m)))
          }}
          myId={uid}
          onRedial={chatIsGroup || !peer.id || sameUser(peer.id, uid) ? undefined : (video) => {
            if (!id) return
            requestOutgoingCall({
              conversationId: id,
              peerId: peer.id,
              peerName: peer.display_name || peer.username,
              peerAvatar: peer.avatar_url,
              video,
            })
          }}
          bottomRef={bottomRef}
          scrollerRef={threadRef}
          contentRef={threadContentRef}
          onDeleteMessage={(msgId) => {
            if (!id) return
            void apiDeleteMessage(id, msgId)
              .then(() => setApiMessages((prev) => prev.filter((m) => m.id !== msgId)))
              .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось удалить'))
          }}
          onReply={(msgId) => {
            const m = apiMessages.find((x) => x.id === msgId)
            if (m) {
              setReplyTo(m)
              setEditing(null)
            }
          }}
          onReact={(msgId, emoji) => {
            if (!id) return
            void apiReactMessage(id, msgId, emoji)
              .then(() => loadApi())
              .catch((e) => showToast(e instanceof Error ? e.message : 'Реакция не добавилась'))
          }}
          onForward={(msgId) => {
            if (!id) return
            setForwardMsgId(msgId)
            setForwardLoading(true)
            void apiListConversations()
              .then((res) => {
                setForwardTargets((res.items ?? []).filter((c) => c.id !== id))
              })
              .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось загрузить чаты'))
              .finally(() => setForwardLoading(false))
          }}
          onEdit={(msgId) => {
            if (!id) return
            const m = apiMessages.find((x) => x.id === msgId)
            const next = window.prompt('Изменить сообщение', m?.body || '')
            if (next == null || !next.trim()) return
            void apiEditMessage(id, msgId, next.trim())
              .then(() => {
                showToast('Изменено')
                void loadApi()
              })
              .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось изменить'))
          }}
          onPin={(msgId) => {
            if (!id) return
            void apiPinChatMessage(id, msgId)
              .then(() => {
                showToast('Сообщение закреплено')
                void loadApi()
              })
              .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось закрепить'))
          }}
          onOpenReactPicker={(msgId) => setReactPickerMsgId(msgId)}
          onOpenActions={(msgId) => setActionMsgId(msgId)}
          canTranscribe={features.transcribe}
          onTranscribe={requestTranscript}
          onOpenThread={(mid) => {
            setThreadRoot(mid)
            if (!id) return
            void apiListThread(id, mid).then(setThreadItems).catch(() => setThreadItems([]))
          }}
          onOpenViewOnce={(mid) => {
            if (!id) return
            void apiOpenViewOnce(id, mid)
              .then((res) => {
                setOnceUrl(res.media_url)
                setApiMessages((prev) => prev.map((m) => (m.id === mid ? { ...m, view_once: 'opened', media_url: undefined, body: 'Фото просмотрено' } : m)))
              })
              .catch((e) => showToast(e instanceof Error ? e.message : 'Уже просмотрено'))
          }}
          payments={features.payments}
          onPayOrder={(orderId) => {
            if (!orderId) return
            void apiPayChatOrder(orderId)
              .then((res) => {
                if (res.confirmation_url) window.location.href = res.confirmation_url
                else showToast('Платёж создан')
              })
              .catch((e) => showToast(e instanceof Error ? e.message : 'Оплата не подключена'))
          }}
          translations={translations}
          onHideTranslation={(mid) => setTranslations((prev) => {
            const next = { ...prev }
            delete next[mid]
            return next
          })}
        />
        )}
        {pinnedMsg ? (
          <div className="glass flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[13px] text-white">
            <div className="flex min-w-0 items-center gap-2">
              <IconPin size={14} className="shrink-0 text-[#a8a8a8]" />
              <span className="truncate text-[#e5e5ea]">{pinnedMsg.body || 'Закреплено'}</span>
            </div>
            <button type="button" className="pressable shrink-0 text-[12px] text-[#8e8e93]" onClick={() => {
              if (!id) return
              void apiPinChatMessage(id, null).then(() => { setPinnedMsg(null); void loadApi() })
            }}>Снять</button>
          </div>
        ) : null}
        {reactPickerMsgId ? (
          <div className="glass-strong border-t border-white/[0.08] px-3 py-3">
            <div className="mx-auto flex max-w-md flex-wrap justify-center gap-1.5">
              {['❤️','🔥','😂','👍','🙏','😮','😢','🎉','💯','👏'].map((e) => (
                <button key={e} type="button" className="pressable flex h-11 w-11 items-center justify-center text-[22px] active:scale-95 active:opacity-55" onClick={() => {
                  if (!id || !reactPickerMsgId) return
                  const mid = reactPickerMsgId
                  setReactPickerMsgId(null)
                  void apiReactMessage(id, mid, e).then(() => loadApi())
                }}>{e}</button>
              ))}
              <form
                className="mt-2 flex w-full gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const data = new FormData(e.currentTarget)
                  const emoji = String(data.get('emoji') || '').trim()
                  if (!id || !reactPickerMsgId || !emoji) return
                  const mid = reactPickerMsgId
                  setReactPickerMsgId(null)
                  void apiReactMessage(id, mid, emoji).then(() => loadApi())
                }}
              >
                <input name="emoji" aria-label="Свой эмодзи" placeholder="Любой эмодзи" className="min-w-0 flex-1 rounded-full bg-[#2c2c2e] px-3 py-2 text-[15px] text-white outline-none" />
                <button type="submit" className="rounded-full bg-white px-3 text-[13px] font-semibold text-black">Ок</button>
              </form>
            </div>
            <button type="button" className="mt-2 w-full text-center text-[13px] text-[#8e8e93]" onClick={() => setReactPickerMsgId(null)}>Отмена</button>
          </div>
        ) : null}
        
        {mediaOpen ? (
          <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={() => setMediaOpen(false)}>
            <div className="safe-top glass flex items-center justify-between border-b border-white/[0.06] px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <p className="text-[15px] font-semibold text-white">Медиа</p>
              <button type="button" className="pressable text-[13px] text-[#8e8e93]" onClick={() => setMediaOpen(false)}>Готово</button>
            </div>
            <div className="grid grid-cols-3 gap-1 overflow-y-auto p-2" onClick={(e) => e.stopPropagation()}>
              {mediaItems.map((m) => (
                <div key={m.id} className="aspect-square overflow-hidden rounded-lg bg-[#111]">
                  {m.msg_type === 'voice' ? (
                    <div className="flex h-full items-center justify-center text-[12px] text-white">🎤</div>
                  ) : m.msg_type === 'file' ? (
                    <a
                      href={m.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center no-underline"
                    >
                      <span className="text-[22px]">📄</span>
                      <span className="line-clamp-2 text-[10px] text-[#a8a8a8]">Файл</span>
                    </a>
                  ) : m.msg_type === 'video' || m.msg_type === 'video_note' ? (
                    <video src={m.media_url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <img src={m.media_url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  )}
                </div>
              ))}
              {!mediaItems.length && <p className="col-span-3 py-10 text-center text-[#777]">Пусто</p>}
            </div>
          </div>
        ) : null}
        {recording ? (
          <div data-voice-recording="" className="flex items-center justify-between gap-3 bg-[#1c1c1e] px-4 py-3 text-[14px] text-white">
            <span className="text-red-400">● Запись {recSeconds}с</span>
            <button type="button" className="rounded-full bg-white px-4 py-1.5 font-semibold text-black" onClick={() => void stopVoiceRecording()}>
              Стоп
            </button>
          </div>
        ) : null}
        {forwardMsgId ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={() => setForwardMsgId(null)}>
            <div
              className="max-h-[70vh] w-full max-w-lg overflow-hidden rounded-t-3xl bg-[#1c1c1e] pb-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <p className="text-[16px] font-semibold text-white">Переслать в…</p>
                <button type="button" className="text-[#8e8e93]" onClick={() => setForwardMsgId(null)}>Закрыть</button>
              </div>
              <div className="no-scrollbar max-h-[55vh] overflow-y-auto px-2 py-2">
                {forwardLoading && <p className="py-6 text-center text-[#777]">Загрузка…</p>}
                {!forwardLoading && !forwardTargets.length && (
                  <p className="py-6 text-center text-[#777]">Нет других диалогов</p>
                )}
                {forwardTargets.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-white/5"
                    onClick={() => {
                      if (!id || !forwardMsgId) return
                      const msgId = forwardMsgId
                      setForwardMsgId(null)
                      void apiForwardMessage(id, msgId, c.id)
                        .then(() => showToast(`Переслано → ${c.peer?.display_name || c.peer?.username || 'чат'}`))
                        .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось переслать'))
                    }}
                  >
                    <Avatar id={c.peer?.id || c.id} name={c.peer?.display_name || c.peer?.username || '?'} src={c.peer?.avatar_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-white">
                        {c.peer?.display_name || c.peer?.username || 'Чат'}
                      </p>
                      <p className="truncate text-[12px] text-[#8e8e93]">@{c.peer?.username}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {editing ? (
          <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/80 px-3 py-2 text-[13px] text-[#8e8e93]">
            <span className="truncate">Редактирование</span>
            <button type="button" className="text-white" onClick={() => { setEditing(null); setText('') }}>✕</button>
          </div>
        ) : null}
        {replyTo ? (
          <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/80 px-3 py-2 text-[13px] text-[#8e8e93]">
            <span className="truncate">Ответ: {replyTo.body.slice(0, 80)}</span>
            <button type="button" className="text-white" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        ) : null}
        <input
          ref={mediaRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            void apiUploadMedia(f)
              .then((m) => {
                setPendingMedia(m.url)
                setPendingMediaKind('image')
                setPendingFilename(null)
                showToast('Фото прикреплено')
              })
              .catch((err) => showToast(err instanceof Error ? err.message : 'Ошибка фото'))
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.json,application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            void apiUploadMedia(f)
              .then((m) => {
                setPendingMedia(m.url)
                setPendingMediaKind('file')
                setPendingFilename(m.filename || f.name || 'Файл')
                showToast('Файл прикреплён')
              })
              .catch((err) => showToast(err instanceof Error ? err.message : 'Ошибка файла'))
          }}
        />

        <input
          ref={videoFileRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f || !id) return
            void (async () => {
              try {
                const media = await apiUploadMedia(f)
                const msg = await apiSendMessageFull(id, {
                  media_url: media.url,
                  msg_type: 'video',
                  body: f.name || '🎬 Видео',
                })
                setApiMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]))
                showToast('Видео отправлено')
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Ошибка видео')
              }
            })()
          }}
        />
        <input
          ref={videoNoteRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f || !id) return
            void (async () => {
              try {
                const media = await apiUploadMedia(f)
                const msg = await apiSendMessageFull(id, {
                  media_url: media.url,
                  msg_type: 'video_note',
                  duration_ms: 3000,
                  body: '⭕️ Видеосообщение',
                })
                setApiMessages((prev) => [...prev, msg])
                showToast('Кружок отправлен')
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Ошибка кружка')
              }
            })()
          }}
        />

        {actionMsgId ? (
          <ChatSheet title="Сообщение" onClose={() => setActionMsgId(null)}>
              {(() => {
                const m = apiMessages.find((x) => x.id === actionMsgId)
                const mine = sameUser(m?.sender_id, uid)
                const mid = actionMsgId
                const row = 'pressable rounded-2xl bg-[#2c2c2e] px-4 py-3.5 text-left text-[16px] text-white'
                return (
                  <div className="flex flex-col gap-2">
                    <button type="button" className={row} onClick={() => { setActionMsgId(null); setReaders([]); setReadersFor(mid) }}>Кто прочитал</button>
                    <button type="button" className={row} onClick={() => { setActionMsgId(null); setEditing(null); setReplyTo(m ?? null) }}>Ответить</button>
                    {canEditMessage(m, uid) ? (
                      <button type="button" className={row} onClick={() => {
                        setActionMsgId(null)
                        setReplyTo(null)
                        setEditing(m ?? null)
                        setText(m?.body || '')
                      }}>Редактировать</button>
                    ) : null}
                    <button type="button" className={row} onClick={() => { setActionMsgId(null); setReactPickerMsgId(mid) }}>Реакция</button>
                    <button type="button" className={row} onClick={() => {
                      setActionMsgId(null)
                      setForwardMsgId(mid)
                      setForwardLoading(true)
                      void apiListConversations()
                        .then((res) => setForwardTargets((res.items ?? []).filter((c) => c.id !== id)))
                        .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
                        .finally(() => setForwardLoading(false))
                    }}>Переслать</button>
                    <button type="button" className={row} onClick={() => {
                      setActionMsgId(null)
                      if (!id) return
                      void apiPinChatMessage(id, mid).then(() => { showToast('Закреплено'); void loadApi() })
                        .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
                    }}>Закрепить</button>
                    <button type="button" className={row} onClick={() => {
                      setActionMsgId(null)
                      if (!m) return
                      const mediaType = m.msg_type === 'image' ? 'photo' : m.msg_type === 'video' || m.msg_type === 'video_note' ? 'video' : 'message'
                      void apiAddArchive({
                        type: mediaType as 'photo' | 'video' | 'message',
                        ref_id: mid,
                        title: (m.body || '').slice(0, 80) || 'Сообщение',
                        preview: (m.body || '').slice(0, 200),
                        meta: { conversation_id: id, media_url: m.media_url, msg_type: m.msg_type },
                      }).then(() => showToast('В архиве')).catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
                    }}>В архив</button>
                    {features.translate && messageCanTranslate({ msgType: m?.msg_type, body: m?.body, transcript: m?.transcript }) ? (
                      <button type="button" data-testid="action-translate" className={row}
                        onClick={() => { setActionMsgId(null); translateMessage(mid) }}>Перевести</button>
                    ) : null}
                    <button type="button" className="pressable rounded-2xl bg-[#2c2c2e] px-4 py-3.5 text-left text-[16px] text-[#ff453a]" onClick={() => {
                      setActionMsgId(null)
                      if (!id) return
                      void apiHideMessage(id, mid)
                        .then(() => {
                          setApiMessages((prev) => prev.filter((x) => x.id !== mid))
                          showToast('Удалено у вас')
                        })
                        .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось удалить'))
                    }}>Удалить у меня</button>
                    <button type="button" className="pressable rounded-2xl bg-[#5c1f24] px-4 py-3.5 text-left text-[16px] text-[#ff453a]" onClick={() => {
                      setActionMsgId(null)
                      if (!id) return
                      if (!mine) {
                        showToast('Удалить у всех можно только своё сообщение')
                        return
                      }
                      if (!confirm('Удалить сообщение у всех?')) return
                      void apiDeleteMessage(id, mid)
                        .then(() => {
                          setApiMessages((prev) => prev.filter((x) => x.id !== mid))
                          showToast('Удалено у всех')
                        })
                        .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось удалить'))
                    }}>Удалить у всех</button>
                  </div>
                )
              })()}
          </ChatSheet>
        ) : null}

        {readersFor ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setReadersFor(null)}>
            <div className="w-full max-w-lg rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <p className="mb-3 text-center text-[15px] font-semibold text-white">Кто прочитал</p>
              {readersLoading ? <p className="py-6 text-center text-[14px] text-[#8e8e93]">Загрузка…</p> : null}
              {!readersLoading && !readers.length ? (
                <p className="py-6 text-center text-[14px] text-[#8e8e93]">Пока никто не прочитал</p>
              ) : null}
              <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
                {readers.map((u) => (
                  <div key={u.user_id} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                    <Avatar name={u.display_name || u.username} id={u.user_id} src={u.avatar_url} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-white">{u.display_name || u.username}</p>
                      <p className="text-[12px] text-[#8e8e93]">{formatHm(u.read_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="mt-2 w-full py-2 text-center text-[15px] text-[#8e8e93]" onClick={() => setReadersFor(null)}>Отмена</button>
            </div>
          </div>
        ) : null}

        {editsFor ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setEditsFor(null)}>
            <div className="w-full max-w-lg rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <p className="mb-3 text-center text-[15px] font-semibold text-white">История изменений</p>
              <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                {(editHistory?.items ?? []).map((item) => (
                  <div key={item.id} className="rounded-2xl bg-[#2c2c2e] px-4 py-3">
                    <p className="whitespace-pre-wrap break-words text-[15px] text-white">{item.body}</p>
                    <p className="mt-1 text-[12px] text-[#8e8e93]">{formatHm(item.edited_at)}</p>
                  </div>
                ))}
                {editHistory ? (
                  <div className="rounded-2xl bg-[#2c2c2e] px-4 py-3">
                    <p className="text-[12px] text-[#8e8e93]">Сейчас</p>
                    <p className="whitespace-pre-wrap break-words text-[15px] text-white">{editHistory.body}</p>
                    {editHistory.edited_at ? <p className="mt-1 text-[12px] text-[#8e8e93]">{formatHm(editHistory.edited_at)}</p> : null}
                  </div>
                ) : (
                  <p className="py-6 text-center text-[14px] text-[#8e8e93]">Загрузка…</p>
                )}
              </div>
              <button type="button" className="mt-2 w-full py-2 text-center text-[15px] text-[#8e8e93]" onClick={() => setEditsFor(null)}>Отмена</button>
            </div>
          </div>
        ) : null}

        {headerMenuOpen ? (
          <ChatSheet title="Чат" onClose={() => setHeaderMenuOpen(false)}>
                <button type="button" className={chatMenuRow} onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiListChatMedia(id).then((r) => { setMediaItems(r.items ?? []); setMediaOpen(true) })
                }}>Медиа</button>
                {features.ai ? <button type="button" className={`${chatMenuRow} flex items-center gap-3`} onClick={() => { setHeaderMenuOpen(false); void openSummary() }}>{menuGlyph('ai')}Что я пропустил</button> : null}
                {features.ai ? <button type="button" className={`${chatMenuRow} flex items-center gap-3`} onClick={() => { setHeaderMenuOpen(false); void openSuggestions() }}>{menuGlyph('ai')}Умные ответы</button> : null}
                {features.translate ? <button type="button" className={`${chatMenuRow} flex items-center gap-3`} onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiGetTranslatePref(id).then(async (pref) => {
                    if (!pref.available) {
                      showToast(pref.message || 'Перевод не подключён')
                      return
                    }
                    const next = !pref.enabled
                    const saved = await apiSetTranslatePref(id, next, pref.lang || 'ru')
                    if (saved.disabled || saved.message) {
                      showToast(saved.message || 'Перевод не подключён')
                      return
                    }
                    if (next) {
                      const batch = await apiTranslateRecent(id)
                      if (batch.disabled) showToast(batch.message || 'Перевод не подключён')
                      else {
                        const map: Record<string, TranslationView> = {}
                        for (const item of batch.items ?? []) map[item.message_id] = { text: item.text }
                        setTranslations((prev) => ({ ...prev, ...map }))
                        showToast('Перевод включён')
                      }
                    } else showToast('Перевод выключен')
                  }).catch((e) => showToast(e instanceof Error ? e.message : 'Перевод не подключён'))
                }}>{menuGlyph('lang')}Автоперевод</button> : null}
                <button type="button" className={`${chatMenuRow} flex items-center gap-3`} onClick={() => { setHeaderMenuOpen(false); setLivePanel('disappear') }}>{menuGlyph('timer')}Исчезающие{disappearHours ? ` · ${disappearHours}ч` : ''}</button>
                {features.stickers ? <button type="button" className={`${chatMenuRow} flex items-center gap-3`} onClick={() => { setHeaderMenuOpen(false); setStickerOff(''); setLivePanel('sticker') }}>{menuGlyph('sticker')}Стикер</button> : null}
                {features.payments ? <button type="button" className={`${chatMenuRow} flex items-center gap-3`} onClick={() => { setHeaderMenuOpen(false); setLivePanel('order') }}>{menuGlyph('order')}Заказ</button> : null}
                {features.ai ? <button type="button" className={`${chatMenuRow} flex items-center gap-3`} onClick={() => {
                  setHeaderMenuOpen(false)
                  setSellerOff('')
                  setSellerBody('')
                  setLivePanel('seller')
                  if (!id) return
                  void apiSellerDraft(id).then((res) => {
                    if (res.disabled) setSellerOff(res.message || 'AI не подключён')
                    else {
                      setSellerBody(res.body || '')
                      setSellerId(res.id || '')
                    }
                  }).catch((e) => setSellerOff(e instanceof Error ? e.message : 'AI не подключён'))
                }}>{menuGlyph('ai')}Черновик ответа</button> : null}
                <button type="button" className={chatMenuRow} onClick={() => {
                  setHeaderMenuOpen(false)
                  setScheduleOpen(true)
                }}>Отложить</button>
                {chatIsGroup ? (
                  <button type="button" className={chatMenuRow} onClick={() => {
                    setHeaderMenuOpen(false)
                    showToast('Групповые звонки недоступны')
                  }}>Групповой аудиозвонок</button>
                ) : null}
                {chatIsGroup ? (
                  <button type="button" className={chatMenuRow} onClick={() => {
                    setHeaderMenuOpen(false)
                    showToast('Групповые звонки недоступны')
                  }}>Групповой видеозвонок</button>
                ) : null}
                <button type="button" className={chatMenuRow} onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiPatchConversation(id, { pinned: !apiConv?.pinned }).then(() => {
                    showToast(apiConv?.pinned ? 'Чат откреплён' : 'Чат закреплён')
                    void loadApi()
                  })
                }}>{apiConv?.pinned ? 'Открепить чат' : 'Закрепить чат'}</button>
                <button type="button" className={chatMenuRow} onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiPatchConversation(id, { folder: 'important' }).then(() => showToast('В «Важные»'))
                }}>В «Важные»</button>
                <button type="button" className={chatMenuRow} onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiPatchConversation(id, { archived: true, folder: 'archive' }).then(() => {
                    showToast('В архиве')
                    dismiss('/app/messages')
                  })
                }}>Архив</button>
          </ChatSheet>
        ) : null}

        {attachOpen ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setAttachOpen(false)}>
            <div
              className="w-full max-w-lg rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <p className="mb-3 text-center text-[15px] font-semibold text-white">Прикрепить</p>
              <button
                type="button"
                className="pressable mb-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  mediaRef.current?.click()
                }}
              >
                <span className="text-[20px]">🖼</span>
                <span>
                  <span className="block text-[15px] font-medium">Фото</span>
                  <span className="block text-[12px] text-[#8e8e93]">JPEG, PNG, WebP, GIF</span>
                </span>
              </button>
              <button
                type="button"
                className="pressable mb-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  videoFileRef.current?.click()
                }}
              >
                <span className="text-[20px]">🎬</span>
                <span>
                  <span className="block text-[15px] font-medium">Видео</span>
                  <span className="block text-[12px] text-[#8e8e93]">MP4, WebM, MOV</span>
                </span>
              </button>
              <button
                type="button"
                className="pressable mb-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  fileRef.current?.click()
                }}
              >
                <span className="text-[20px]">📄</span>
                <span>
                  <span className="block text-[15px] font-medium">Файл</span>
                  <span className="block text-[12px] text-[#8e8e93]">PDF, ZIP, документы</span>
                </span>
              </button>
              <button
                type="button"
                className="pressable mb-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  void startVoiceRecording()
                }}
              >
                <span className="text-[20px]">🎤</span>
                <span>
                  <span className="block text-[15px] font-medium">Голосовое</span>
                  <span className="block text-[12px] text-[#8e8e93]">Запись до 2 мин</span>
                </span>
              </button>
              <button
                type="button"
                className="pressable mb-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  setPollOpen(true)
                }}
              >
                <span className="text-[20px]">📊</span>
                <span>
                  <span className="block text-[15px] font-medium">Опрос</span>
                  <span className="block text-[12px] text-[#8e8e93]">Вопрос и варианты</span>
                </span>
              </button>
              <button
                type="button"
                className="pressable flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  videoNoteRef.current?.click()
                }}
              >
                <span className="text-[20px]">⭕️</span>
                <span>
                  <span className="block text-[15px] font-medium">Кружок</span>
                  <span className="block text-[12px] text-[#8e8e93]">Видеосообщение</span>
                </span>
              </button>
              <button
                type="button"
                className="pressable mb-2 mt-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  if (!id || !navigator.geolocation) {
                    showToast('Геолокация недоступна')
                    return
                  }
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      void apiSendMessageFull(id, {
                        msg_type: 'location',
                        meta: { lat: pos.coords.latitude, lng: pos.coords.longitude },
                      })
                        .then((msg) => setApiMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg])))
                        .catch((err) => showToast(err instanceof Error ? err.message : 'Не удалось отправить'))
                    },
                    () => showToast('Не удалось получить геолокацию'),
                    { enableHighAccuracy: false, timeout: 8000 },
                  )
                }}
              >
                <span className="text-[20px]">📍</span>
                <span>
                  <span className="block text-[15px] font-medium">Геолокация</span>
                  <span className="block text-[12px] text-[#8e8e93]">Текущее место</span>
                </span>
              </button>
              <button
                type="button"
                className="pressable flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-white"
                onClick={() => {
                  setAttachOpen(false)
                  if (!id) return
                  const name = window.prompt('Имя контакта')?.trim()
                  if (!name) return
                  const phone = window.prompt('Телефон')?.trim() || ''
                  void apiSendMessageFull(id, { msg_type: 'contact', meta: { name, phone } })
                    .then((msg) => setApiMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg])))
                    .catch((err) => showToast(err instanceof Error ? err.message : 'Не удалось отправить'))
                }}
              >
                <span className="text-[20px]">👤</span>
                <span>
                  <span className="block text-[15px] font-medium">Контакт</span>
                  <span className="block text-[12px] text-[#8e8e93]">Имя и телефон</span>
                </span>
              </button>
              <button
                type="button"
                className="mt-3 w-full py-2 text-center text-[14px] text-[#8e8e93]"
                onClick={() => setAttachOpen(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}
        {pollOpen ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setPollOpen(false)}>
            <div className="w-full max-w-lg rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <p className="mb-3 text-center text-[15px] font-semibold text-white">Новый опрос</p>
              <input
                value={pollQ}
                onChange={(e) => setPollQ(e.target.value)}
                placeholder="Вопрос"
                maxLength={200}
                className="mb-2 h-11 w-full rounded-2xl bg-black/40 px-3 text-[15px] text-white outline-none"
              />
              {pollOpts.map((o, i) => (
                <input
                  key={i}
                  value={o}
                  onChange={(e) => {
                    const next = [...pollOpts]
                    next[i] = e.target.value
                    setPollOpts(next)
                  }}
                  placeholder={`Вариант ${i + 1}`}
                  maxLength={100}
                  className="mb-2 h-11 w-full rounded-2xl bg-black/40 px-3 text-[15px] text-white outline-none"
                />
              ))}
              {pollOpts.length < 10 ? (
                <button type="button" className="mb-3 text-[13px] text-[#0a84ff]" onClick={() => setPollOpts((p) => [...p, ''])}>
                  Добавить вариант
                </button>
              ) : null}
              <label className="mb-2 flex items-center justify-between text-[14px] text-white">
                Несколько ответов
                <input type="checkbox" checked={pollMulti} onChange={(e) => setPollMulti(e.target.checked)} />
              </label>
              <label className="mb-4 flex items-center justify-between text-[14px] text-white">
                Анонимно
                <input type="checkbox" checked={pollAnon} onChange={(e) => setPollAnon(e.target.checked)} />
              </label>
              <button
                type="button"
                className="pressable h-11 w-full rounded-2xl bg-white text-[15px] font-semibold text-black"
                onClick={() => {
                  if (!id) return
                  const options = pollOpts.map((o) => o.trim()).filter(Boolean)
                  if (!pollQ.trim() || options.length < 2) {
                    showToast('Нужны вопрос и минимум 2 варианта')
                    return
                  }
                  void apiSendMessageFull(id, {
                    msg_type: 'poll',
                    body: pollQ.trim(),
                    poll: { question: pollQ.trim(), options, multiple: pollMulti, anonymous: pollAnon },
                  })
                    .then((msg) => {
                      setApiMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]))
                      setPollOpen(false)
                      setPollQ('')
                      setPollOpts(['', ''])
                      setPollMulti(false)
                      setPollAnon(true)
                    })
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось создать опрос'))
                }}
              >
                Создать опрос
              </button>
              <button type="button" className="mt-2 w-full py-2 text-center text-[14px] text-[#8e8e93]" onClick={() => setPollOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        ) : null}
        {suggestionOff ? <div className="px-3"><HonestBanner text={suggestionOff} /></div> : null}
        {suggestions.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-3 pb-1">
            {suggestions.map((line) => (
              <button
                key={line}
                type="button"
                className="shrink-0 rounded-full bg-[#2c2c2e] px-3 py-1.5 text-[13px] text-white"
                onClick={() => {
                  if (!id) return
                  void apiSendMessageFull(id, { body: line }).then((msg) => {
                    setApiMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]))
                    setSuggestions([])
                  }).catch((e) => showToast(e instanceof Error ? e.message : 'Не отправилось'))
                }}
              >
                {line}
              </button>
            ))}
          </div>
        ) : null}
        {dictationDock}
        {id ? <FileShelfHost conversationId={id} /> : null}
        {circlePreview ? (
          <CirclePreview
            url={circlePreview.url}
            onCancel={() => {
              URL.revokeObjectURL(circlePreview.url)
              setCirclePreview(null)
            }}
            onSend={() => {
              if (!id) return
              const shot = circlePreview
              setCirclePreview(null)
              void apiUploadMedia(shot.file)
                .then((media) => apiSendMessageFull(id, {
                  media_url: media.url,
                  msg_type: 'video_note',
                  duration_ms: Math.max(1, shot.durationMs),
                  body: '⭕️ Видеосообщение',
                }))
                .then((msg) => setApiMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg])))
                .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось отправить кружок'))
                .finally(() => URL.revokeObjectURL(shot.url))
            }}
          />
        ) : null}
        {onceUrl ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/90" onClick={() => setOnceUrl('')}>
            <img src={onceUrl} alt="" className="max-h-[70%] max-w-[90%] rounded-2xl" />
          </div>
        ) : null}
        {livePanel === 'summary' ? (
          <ToolSheet title="Что я пропустил" onClose={() => setLivePanel(null)}>
            <SummaryBody loading={summaryLoading} text={summaryText} off={summaryOff} />
          </ToolSheet>
        ) : null}
        {livePanel === 'disappear' && id ? (
          <ToolSheet title="Исчезающие" onClose={() => setLivePanel(null)}>
            <DisappearChoices
              current={disappearHours}
              afterRead={disappearAfterRead}
              onPick={(hours, after) => {
                void apiSetDisappear(id, { hours, after_read: after }).then((r) => {
                  setDisappearHours(r.disappear_hours)
                  setDisappearAfterRead(!!r.disappear_after_read)
                  showToast(hours ? `Исчезают · ${hours} ч` : 'Исчезающие выкл')
                  setLivePanel(null)
                }).catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
              }}
            />
          </ToolSheet>
        ) : null}
        {livePanel === 'sticker' ? (
          <ToolSheet title="Стикер" onClose={() => setLivePanel(null)}>
            <StickerForm
              off={features.ai ? stickerOff : 'AI не подключён. Задайте OPENAI_API_KEY или YANDEX_GPT_API_KEY и YANDEX_GPT_FOLDER'}
              onCreate={(prompt) => {
                if (!id) return
                void apiGenerateSticker(prompt, id).then((res) => {
                  if (res.disabled) {
                    setStickerOff(res.message || 'AI не подключён')
                    return
                  }
                  showToast('Стикер отправлен')
                  setLivePanel(null)
                  void loadApi()
                }).catch((e) => setStickerOff(e instanceof Error ? e.message : 'AI не подключён'))
              }}
            />
          </ToolSheet>
        ) : null}
        {livePanel === 'order' ? (
          <ToolSheet title="Заказ" onClose={() => setLivePanel(null)}>
            <OrderForm
              onCreate={(title, rub) => {
                if (!id) return
                void apiCreateChatOrder(id, title, rub * 100).then(() => {
                  showToast('Карточка в чате')
                  setLivePanel(null)
                  void loadApi()
                }).catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
              }}
            />
          </ToolSheet>
        ) : null}
        {livePanel === 'seller' ? (
          <ToolSheet title="Черновик ответа" onClose={() => setLivePanel(null)}>
            {sellerOff ? <HonestBanner text={sellerOff} /> : (
              <div className="flex flex-col gap-3">
                <p className="whitespace-pre-wrap text-[15px] text-white">{sellerBody || 'Готовлю…'}</p>
                {sellerId ? (
                  <div className="flex gap-2">
                    <button type="button" className="rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black" onClick={() => {
                      void apiApproveSellerDraft(sellerId).then(() => {
                        showToast('Отправлено')
                        setLivePanel(null)
                        void loadApi()
                      }).catch((e) => showToast(e instanceof Error ? e.message : 'Не отправилось'))
                    }}>Отправить</button>
                    <button type="button" className="rounded-full bg-[#2c2c2e] px-4 py-2 text-[14px] text-white" onClick={() => {
                      void apiDismissSellerDraft(sellerId).then(() => setLivePanel(null))
                    }}>Скрыть</button>
                  </div>
                ) : null}
              </div>
            )}
          </ToolSheet>
        ) : null}
        {threadRoot && id ? (
          <ToolSheet title="Ветка" onClose={() => setThreadRoot(null)}>
            <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
              {threadItems.map((m) => (
                <p key={m.id} className="rounded-2xl bg-[#2c2c2e] px-3 py-2 text-[14px] text-white">{m.body}</p>
              ))}
              {!threadItems.length ? <p className="text-[14px] text-[#8e8e93]">Пока нет ответов</p> : null}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={threadText}
                onChange={(e) => setThreadText(e.target.value)}
                placeholder="Ответ в ветке"
                className="min-w-0 flex-1 rounded-2xl bg-[#2c2c2e] px-3 py-2 text-[15px] text-white outline-none"
              />
              <button type="button" className="rounded-full bg-white px-4 text-[14px] font-semibold text-black" onClick={() => {
                const body = threadText.trim()
                if (!body) return
                void apiSendMessageFull(id, { body, thread_root_id: threadRoot }).then((msg) => {
                  setThreadItems((prev) => [...prev, msg])
                  setThreadText('')
                  setApiMessages((prev) => prev.map((m) => m.id === threadRoot ? { ...m, thread_count: (m.thread_count || 0) + 1 } : m))
                }).catch((e) => showToast(e instanceof Error ? e.message : 'Не отправилось'))
              }}>Ок</button>
            </div>
          </ToolSheet>
        ) : null}
        <ChatComposer
          text={text}
          setText={setText}
          onSubmit={(e) => void onSend(e)}
          sending={sending}
          pendingMedia={pendingMedia}
          pendingLabel={
            pendingMedia
              ? pendingMediaKind === 'file'
                ? `Файл: ${pendingFilename || 'документ'}`
                : 'Фото прикреплено'
              : null
          }
          onPickMedia={() => setAttachOpen(true)}
          onVideoNote={() => videoNoteRef.current?.click()}
          onTyping={() => {
            if (id) void apiTyping(id).catch(() => {})
          }}
          onVoice={() => {
            void startVoiceRecording()
          }}
          recording={recording}
          viewOnce={viewOncePending}
          onToggleViewOnce={() => setViewOncePending((v) => !v)}
          onCircle={() => {
            if (circleRef.current) void stopCircle()
            else void startCircle()
          }}
          circleRecording={circleRecording}
          onClearMedia={() => {
            setPendingMedia(null)
            setPendingFilename(null)
            setPendingMediaKind('image')
            setViewOncePending(false)
          }}
        />
      </div>
    )
  }

  const localGroup = !!conversation?.isGroup
  if (!conversation || (!other && !localGroup)) {
    return (
      <div className={`flex h-full items-center justify-center bg-black text-[#8e8e93] ${motionClass}`}>
        Диалог не найден
      </div>
    )
  }

  const onSend = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || !id) return
    sendMessage(id, text)
    setText('')
  }

  const memberCount = conversation.participantIds.length
  const bubbles: BubbleMsg[] = localMessages.map((m) => {
    const sender = users.find((u) => u.id === m.senderId)
    return {
      id: m.id,
      mine: m.senderId === uid,
      body: m.text,
      createdAt: m.createdAt,
      senderName: sender?.name,
      senderId: m.senderId,
      senderAvatar: sender?.avatar,
      read: m.read,
      receipt: true,
    }
  })
  const localTitle = localGroup ? (conversation.title || 'Группа') : (other?.name || '')
  const localUser = other?.username || ''

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <TopBar
        onBack={() => dismiss('/app/messages')}
        name={localTitle}
        username={localGroup ? localTitle : localUser}
        subtitle={localGroup ? ruParticipants(memberCount) : (other ? (formatPresence(other.lastSeenAt, other.gender) || (other.name && other.name !== other.username ? other.name : other.bio)) : undefined)}
        avatar={localGroup ? undefined : other?.avatar}
        id={localGroup ? conversation.id : (other?.id || conversation.id)}
        isGroup={localGroup}
        onSearch={() => showToast('Поиск в чате — при подключении к серверу')}
        onMenu={() => setHeaderMenuOpen(true)}
        onOpenInfo={localGroup && id ? () => navigate(`/app/messages/${id}/settings`) : (other ? () => navigate(`/app/profile/${other.id}`) : undefined)}
        onAudioCall={localGroup ? () => showToast('Групповые звонки недоступны') : () => showToast('Звонки — при подключении к серверу')}
        onVideoCall={localGroup ? () => showToast('Групповые звонки недоступны') : () => showToast('Звонки — при подключении к серверу')}
      />
      <ChatThread
        typing={!!typingUserId}
        messages={bubbles}
        peerName={localTitle}
        peerUsername={localGroup ? localTitle : localUser}
        peerAvatar={localGroup ? undefined : other?.avatar}
        peerId={localGroup ? conversation.id : (other?.id || conversation.id)}
        profileTo={localGroup && id ? `/app/messages/${id}/settings` : (other ? `/app/profile/${other.id}` : undefined)}
        profileLabel={localGroup ? 'О группе' : 'Посмотреть профиль'}
        peerSubtitle={localGroup ? ruParticipants(memberCount) : (other?.bio || (other && other.name !== other.username ? other.name : undefined))}
        isGroup={localGroup}
        bottomRef={bottomRef}
        scrollerRef={threadRef}
        contentRef={threadContentRef}
        onOpenActions={(msgId) => setActionMsgId(msgId)}
      />
      {actionMsgId ? (
        <ChatSheet title="Сообщение" onClose={() => setActionMsgId(null)}>
          <button type="button" className={chatMenuRow} onClick={() => { setActionMsgId(null); showToast('Кто прочитал — при подключении к серверу') }}>Кто прочитал</button>
          <button type="button" className={chatMenuRow} onClick={() => { setActionMsgId(null); showToast('Ответ — при подключении к серверу') }}>Ответить</button>
          <button type="button" className={chatMenuRow} onClick={() => { setActionMsgId(null); showToast('Реакция — при подключении к серверу') }}>Реакция</button>
          <button type="button" className={chatMenuRow} onClick={() => { setActionMsgId(null); showToast('Пересылка — при подключении к серверу') }}>Переслать</button>
          <button type="button" className={chatMenuRow} onClick={() => { setActionMsgId(null); showToast('Закрепление — при подключении к серверу') }}>Закрепить</button>
          <button type="button" className={chatMenuRow} onClick={() => { setActionMsgId(null); showToast('Архив — при подключении к серверу') }}>В архив</button>
          <button type="button" className="pressable rounded-2xl bg-[#2c2c2e] px-4 py-3.5 text-left text-[16px] text-[#ff453a]" onClick={() => { setActionMsgId(null); showToast('Удаление — при подключении к серверу') }}>Удалить у меня</button>
          <button type="button" className="pressable rounded-2xl bg-[#5c1f24] px-4 py-3.5 text-left text-[16px] text-[#ff453a]" onClick={() => { setActionMsgId(null); showToast('Удаление — при подключении к серверу') }}>Удалить у всех</button>
        </ChatSheet>
      ) : null}
      {headerMenuOpen ? (
        <ChatSheet title="Чат" onClose={() => setHeaderMenuOpen(false)}>
          <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Медиа — при подключении к серверу') }}>Медиа</button>
          <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Исчезающие — при подключении к серверу') }}>Исчезающие</button>
          <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Отложенные — при подключении к серверу') }}>Отложить</button>
          {localGroup ? (
            <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Групповые звонки недоступны') }}>Групповой аудиозвонок</button>
          ) : null}
          {localGroup ? (
            <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Групповые звонки недоступны') }}>Групповой видеозвонок</button>
          ) : null}
          <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Закрепление — при подключении к серверу') }}>Закрепить чат</button>
          <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Важные — при подключении к серверу') }}>В «Важные»</button>
          <button type="button" className={chatMenuRow} onClick={() => { setHeaderMenuOpen(false); showToast('Архив — при подключении к серверу') }}>Архив</button>
        </ChatSheet>
      ) : null}
      {dictationDock}
      {id ? <FileShelfHost conversationId={id} /> : null}
      <ChatComposer
        text={text}
        setText={setText}
        onSubmit={onSend}
        onPickMedia={() => showToast('Вложения — при подключении к серверу')}
        onVoice={() => showToast('Голосовые — при подключении к серверу')}
        onCircle={() => showToast('Кружки — при подключении к серверу')}
      />
    </div>
  )
}
