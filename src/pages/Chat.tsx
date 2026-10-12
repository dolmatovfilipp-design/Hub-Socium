import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useNavMotion } from '../components/NavMotion'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { ChatPollCard } from '../components/ChatPollCard'
import { IconChevron, IconPin, IconPlane, IconSearch, IconUser } from '../components/Icons'
import { DmVideoSession } from '../lib/webrtcCall'
import { chatWsSubscribe, chatWsConnected } from '../lib/chatWs'
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
  apiReactMessage,
  apiEditMessage,
  apiPinChatMessage,
  apiAddArchive,
  apiScheduleDM,
  apiStartCall,
  apiEndCall,
  apiPostCallSignal,
  apiPollCallSignals,

  apiSetDisappear,
  apiGetDisappear,
  apiListChatMedia,
  apiForwardMessage,
  apiPatchConversation,
  isApiMode,
  type ApiConversation,
  type ApiLinkPreview,
  type ApiMessage,
  type ApiMessageEdits,
  type ApiMessageReader,
  type ChatPoll,
} from '../lib/api'
import { ruParticipants } from '../utils/ru'
import { enqueueOffline, isBrowserOffline } from '../lib/offlineQueue'
import { cacheGet, cacheSet } from '../lib/listCache'

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
  const t = msgType || 'text'
  return t === 'text' || t === 'image' || t === 'video' || t === 'file'
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


function VoiceBubble({ url, durationMs }: { url: string; durationMs: number }) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sec = Math.max(1, Math.round(durationMs / 1000))
  return (
    <div className="flex items-center gap-2 py-1">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white"
        onClick={() => {
          if (!audioRef.current) audioRef.current = new Audio(url)
          const a = audioRef.current
          if (playing) {
            a.pause()
            setPlaying(false)
          } else {
            void a.play()
            setPlaying(true)
            a.onended = () => setPlaying(false)
          }
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="text-[13px] text-white/90">Голосовое · {sec}с</span>
    </div>
  )
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
  typing,
  onOpenActions,
  isGroup,
  highlightId,
  onShowEdits,
  conversationId,
  onPollUpdate,
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
  onDeleteMessage?: (id: string) => void
  typing?: boolean
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
}) {
  let lastDate = ''
  const title = isGroup ? (peerName || 'Группа') : (peerUsername || peerName)
  const subtitle = isGroup ? (peerSubtitle || '') : (peerSubtitle || (peerName && peerName !== peerUsername ? peerName : ''))

  return (
    <div className="no-scrollbar flex-1 overflow-y-auto bg-black px-4 pb-4 pt-2">
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
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25">
              <IconUser size={18} />
            </span>
            <span className="text-[13px]">{profileLabel || 'Посмотреть профиль'}</span>
          </Link>
        ) : null}
      </div>

      {messages.map((m) => {
        const dk = dateKey(m.createdAt)
        const showDate = dk !== lastDate
        lastDate = dk
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
                  <VoiceBubble url={m.mediaUrl} durationMs={m.durationMs ?? 0} />
                ) : m.msgType === 'video_note' && m.mediaUrl ? (
                  <video src={m.mediaUrl} className="mb-1 h-40 w-40 rounded-full object-cover" controls playsInline preload="metadata" />
                ) : m.msgType === 'video' && m.mediaUrl ? (
                  <video src={m.mediaUrl} className="mb-1 max-h-56 w-full rounded-xl" controls playsInline preload="metadata" />
                ) : m.msgType === 'file' && m.mediaUrl ? (
                  <FileBubble url={m.mediaUrl} filename={m.body || 'Файл'} />
                ) : m.msgType === 'sticker' && m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="Стикер" className="h-28 w-28 object-contain" />
                ) : m.msgType === 'gif' && m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="GIF" className="mb-1 max-h-48 rounded-xl" />
                ) : m.msgType === 'location' ? (
                  <LocationBubble meta={m.meta} />
                ) : m.msgType === 'contact' ? (
                  <ContactBubble meta={m.meta} body={m.body} />
                ) : m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="" className="mb-1 max-h-48 rounded-xl" loading="lazy" decoding="async" />
                ) : null}
                {m.poll && conversationId ? (
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
  )
}

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
}) {
  const canSend = (text.trim().length > 0 || !!pendingMedia) && !disabled && !sending

  return (
    <form
      onSubmit={onSubmit}
      className="flex shrink-0 flex-col gap-2 bg-black px-3 pt-2"
      style={{ paddingBottom: 'max(12px, var(--hub-safe-bottom))' }}
    >
      {pendingMedia ? (
        <div className="flex items-center justify-between rounded-2xl bg-[#1c1c1e] px-3 py-2 text-[13px] text-[#8e8e93]">
          <span className="truncate">{pendingLabel || 'Фото прикреплено'}</span>
          <button type="button" className="shrink-0 text-white" onClick={onClearMedia}>
            Убрать
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {onPickMedia ? (
          <button
            type="button"
            className="hub-circle-btn text-[22px] leading-none"
            aria-label="Прикрепить"
            onClick={onPickMedia}
          >
            +
          </button>
        ) : null}
        <div className="hub-composer-pill">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              onTyping?.()
            }}
            placeholder="Сообщение…"
            className="min-h-[40px] w-full flex-1 bg-transparent py-2.5 text-[15px] text-white placeholder:text-[#8e8e93]"
          />
        </div>
        {canSend ? (
          <button
            type="submit"
            className="hub-circle-btn bg-white text-black"
            aria-label="Отправить"
          >
            <IconPlane size={18} strokeWidth={1.5} />
          </button>
        ) : null}
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
}) {
  const title = isGroup ? name : (username || name)
  const sub = subtitle || (!isGroup && name && name !== username ? name : '')
  return (
    <header className="safe-top z-10 shrink-0 bg-black px-3 pb-2 pt-1">
      <div className="flex h-12 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="hub-circle-btn"
          aria-label="Назад"
        >
          <IconChevron size={20} className="-scale-x-100" />
        </button>
        <button
          type="button"
          disabled={!onOpenInfo && !isGroup}
          onClick={onOpenInfo}
          className={`hub-title-pill min-w-0 flex-1 ${onOpenInfo ? 'pressable' : 'pointer-events-none'}`}
          aria-label={isGroup ? 'О группе' : 'Профиль'}
        >
          <Avatar name={name || username} id={id} src={avatar} size={32} />
          <div className="min-w-0 flex-1 pr-1">
            <div className="truncate text-[14px] font-bold leading-tight text-white">
              {title}
            </div>
            {sub ? (
              <div className="truncate text-[11px] leading-tight text-[#8e8e93]">{sub}</div>
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
            <IconSearch size={18} />
          </button>
        ) : null}
        {onMenu ? (
          <button
            type="button"
            className="hub-circle-btn text-[18px] leading-none"
            onClick={onMenu}
            aria-label="Ещё"
          >
            ⋯
          </button>
        ) : (
          <span className="hub-circle-btn opacity-0 pointer-events-none" aria-hidden />
        )}
      </div>
    </header>
  )
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
  const api = isApiMode()

  const [apiConv, setApiConv] = useState<ApiConversation | null>(null)
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([])
  const [loading, setLoading] = useState(api)
  const [sending, setSending] = useState(false)
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
  const [scheduleLocal, setScheduleLocal] = useState('')
  const [callOpen, setCallOpen] = useState(false)
  const [callStatus, setCallStatus] = useState('')
  const [callMicMuted, setCallMicMuted] = useState(false)
  const [callCamOff, setCallCamOff] = useState(false)
  const [callFailed, setCallFailed] = useState(false)
  const callRef = useRef<DmVideoSession | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
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
    const ctx = recRef.current
    if (!ctx) return
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (ctx.rec.state === 'recording') ctx.rec.stop()
    ctx.stream.getTracks().forEach((tr) => tr.stop())
    setRecording(false)
    const blob = await ctx.stopped
    const durationMs = Math.min(120000, Date.now() - ctx.started)
    recRef.current = null
    setRecSeconds(0)
    if (!id) return
    if (durationMs < 400) {
      showToast('Слишком коротко')
      return
    }
    try {
      const file = new File([blob], 'voice.webm', { type: blob.type || 'audio/webm' })
      const media = await apiUploadMedia(file)
      const msg = await apiSendVoice(id, media.url, durationMs)
      setApiMessages((prev) => [...prev, msg])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось записать')
    }
  }, [id, showToast])

  const startVoiceRecording = useCallback(async () => {
    if (!id || !navigator.mediaDevices?.getUserMedia) {
      showToast('Микрофон недоступен')
      return
    }
    if (recording) {
      await stopVoiceRecording()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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

  useEffect(() => {
    setApiConv(null)
    const cached = id ? cacheGet<{ items?: ApiMessage[]; pinned_message?: { id: string; body?: string } }>('msgs_' + id, 30_000) : null
    if (cached?.items?.length) {
      setApiMessages(cached.items)
      setLoading(false)
    } else {
      setApiMessages([])
      setLoading(true)
    }
    void loadApi()
  }, [loadApi, id])

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
              !!m.poll?.closed === !!n?.poll?.closed
            )
          })
        ) {
          return prev
        }
        const byId = new Map(items.map((m) => [m.id, m]))
        const merged: typeof items = []
        const seen = new Set<string>()
        for (const m of items) {
          merged.push(m)
          seen.add(m.id)
        }
        for (const m of prev) {
          if (!seen.has(m.id) && !byId.has(m.id) && m.id.startsWith('tmp_')) {
            merged.push(m)
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
        mergeItems(items)
      } catch {
        // ignore transient poll errors
      }
    }
    const unsub = chatWsSubscribe(id, (ev) => {
      if (cancelled) return
      if (ev.type === 'message' && ev.conversation_id === id && ev.message) {
        const msg = ev.message as ApiMessage
        setApiMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) {
            return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
          }
          const withoutTmp = prev.filter((m) => !(m.id.startsWith('tmp_') && m.body === msg.body))
          return [...withoutTmp, msg]
        })
      } else if (ev.type === 'typing' && ev.conversation_id === id && (ev as any).user_id) {
        setTypingUserId(String((ev as any).user_id))
      }
    })
    void tick()
    // Backup poll: fast if WS down, slower when connected
    const h = window.setInterval(() => {
      const msOk = chatWsConnected()
      // always tick; interval itself is 450ms — cheap merge when unchanged
      void tick()
      void msOk
    }, 450)
    return () => {
      cancelled = true
      unsub()
      window.clearInterval(h)
    }
  }, [api, id])

  useEffect(() => {
    if (!api && id) markRead(id)
  }, [api, id, markRead, localMessages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [api ? apiMessages.length : localMessages.length])

  if (api) {
    const peer = apiConv?.peer
    const onSend = async (e: FormEvent) => {
      e.preventDefault()
      if (editing && id) {
        const next = text.trim()
        if (!next || sending) return
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
          setSending(false)
        }
        return
      }
      if ((!text.trim() && !pendingMedia) || !id || sending) return
      const body = text.trim()
      const media = pendingMedia
      const sendKind = pendingMediaKind
      const sendName = pendingFilename
      setText('')
      setPendingMedia(null)
      setSending(true)
      const replyId = replyTo?.id
      setReplyTo(null)
      try {
        if (isBrowserOffline()) {
          enqueueOffline(
            'message',
            { conversationId: id, body: body || (media ? ' ' : ''), media_url: media || undefined },
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
        })
        setPendingMediaKind('image')
        setPendingFilename(null)
        setApiMessages((prev) => {
          if (prev.some((x) => x.id === msg.id)) return prev
          return [...prev, msg]
        })
      } catch (err) {
        setText(body)
        if (replyId) {
          const found = apiMessages.find((m) => m.id === replyId)
          if (found) setReplyTo(found)
        }
        showToast(err instanceof Error ? err.message : 'Не отправилось')
      } finally {
        setSending(false)
      }
    }

    if (!peer) {
      if (loading || apiMessages.length > 0) {
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
      mine: m.sender_id === uid,
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
    }))

    const showingSearchHits = searchOpen && searchQ.trim().length >= 2
    // Threads DM: always pure black (ignore chat wallpaper themes)
    return (
      <div className={`flex h-full flex-col bg-black ${motionClass}`}>
        <TopBar
          onBack={() => dismiss('/app/messages')}
          name={apiConv?.is_group ? (apiConv.title || peer.display_name || 'Группа') : (peer.display_name || peer.username)}
          username={peer.username}
          subtitle={apiConv?.is_group ? (apiConv.member_count != null ? ruParticipants(apiConv.member_count) : undefined) : (peer.display_name && peer.display_name !== peer.username ? peer.display_name : undefined)}
          avatar={(apiConv?.is_group ? (apiConv.avatar_url || peer.avatar_url) : peer.avatar_url) || undefined}
          id={apiConv?.is_group ? (apiConv.id) : peer.id}
          isGroup={!!apiConv?.is_group}
          onOpenInfo={apiConv?.is_group && id ? () => navigate(`/app/messages/${id}/settings`) : (peer.id ? () => navigate(`/app/profile/${peer.id}`) : undefined)}
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
        {scheduleOpen ? (
          <div className="glass flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
            <input
              type="datetime-local"
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[13px] text-white"
              value={scheduleLocal}
              onChange={(e) => setScheduleLocal(e.target.value)}
            />
            <button
              type="button"
              className="pressable shrink-0 text-[13px] font-medium text-white"
              onClick={() => {
                if (!id || !scheduleLocal) return
                const body = window.prompt('Текст') || ''
                if (!body.trim()) return
                const iso = new Date(scheduleLocal).toISOString()
                void apiScheduleDM(id, body.trim(), iso)
                  .then(() => {
                    showToast('Запланировано')
                    setScheduleOpen(false)
                    setScheduleLocal('')
                  })
                  .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
              }}
            >Готово</button>
          </div>
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
          peerName={apiConv?.is_group ? (apiConv.title || peer.display_name || 'Группа') : (peer.display_name || peer.username)}
          peerUsername={apiConv?.is_group ? (apiConv.title || 'Группа') : peer.username}
          peerAvatar={(apiConv?.is_group ? (apiConv.avatar_url || peer.avatar_url) : peer.avatar_url) || undefined}
          peerId={apiConv?.is_group ? apiConv.id : peer.id}
          profileTo={apiConv?.is_group && id ? `/app/messages/${id}/settings` : `/app/profile/${peer.id}`}
          profileLabel={apiConv?.is_group ? 'О группе' : 'Посмотреть профиль'}
          peerSubtitle={apiConv?.is_group ? (apiConv.member_count != null ? ruParticipants(apiConv.member_count) : undefined) : (peer.display_name && peer.display_name !== peer.username ? peer.display_name : undefined)}
          isGroup={!!apiConv?.is_group}
          highlightId={highlightId}
          onShowEdits={(msgId) => setEditsFor(msgId)}
          conversationId={id}
          onPollUpdate={(mid, next) => {
            setApiMessages((prev) => prev.map((m) => (m.id === mid ? { ...m, poll: next } : m)))
          }}
          bottomRef={bottomRef}
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
                <button key={e} type="button" className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-[20px]" onClick={() => {
                  if (!id || !reactPickerMsgId) return
                  const mid = reactPickerMsgId
                  setReactPickerMsgId(null)
                  void apiReactMessage(id, mid, e).then(() => loadApi())
                }}>{e}</button>
              ))}
            </div>
            <button type="button" className="mt-2 w-full text-center text-[13px] text-[#8e8e93]" onClick={() => setReactPickerMsgId(null)}>Отмена</button>
          </div>
        ) : null}
        
        {callOpen ? (
          <div className="fixed inset-0 z-[60] flex flex-col bg-black">
            <div className="safe-top flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[15px] font-medium text-white">{peer?.display_name || peer?.username || 'Видео'}</p>
                <p className="text-[13px] text-[#a8a8a8]">{callStatus || 'Звоним…'}</p>
              </div>
              <button
                type="button"
                className="pressable rounded-full bg-[#ff3040] px-3 py-1.5 text-[13px] font-medium text-white"
                onClick={() => {
                  callRef.current?.stop()
                  callRef.current = null
                  if (id) void apiEndCall(id).catch(() => {})
                  setCallOpen(false)
                  setCallFailed(false)
                }}
              >
                Сбросить
              </button>
            </div>
            <div className="relative min-h-0 flex-1 bg-[#0a0a0a]">
              <video ref={remoteVideoRef} className="h-full w-full object-cover" playsInline autoPlay />
              {callFailed ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
                  <p className="text-[16px] font-semibold text-white">Не достучались</p>
                  <p className="text-[13px] text-[#8e8e93]">Сеть или NAT. Можно повторить.</p>
                </div>
              ) : null}
              <video
                ref={localVideoRef}
                className="absolute bottom-24 right-4 h-36 w-28 rounded-2xl border border-white/20 object-cover"
                playsInline
                autoPlay
                muted
              />
              <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-4">
                <button
                  type="button"
                  className={`pressable h-12 w-12 rounded-full text-[11px] font-medium ${callMicMuted ? 'bg-white text-black' : 'bg-white/15 text-white'}`}
                  onClick={() => {
                    const next = !callMicMuted
                    setCallMicMuted(next)
                    callRef.current?.setMicMuted(next)
                  }}
                >
                  Mic
                </button>
                <button
                  type="button"
                  className={`pressable h-12 w-12 rounded-full text-[11px] font-medium ${callCamOff ? 'bg-white text-black' : 'bg-white/15 text-white'}`}
                  onClick={() => {
                    const next = !callCamOff
                    setCallCamOff(next)
                    callRef.current?.setCamOff(next)
                  }}
                >
                  Cam
                </button>
                <button
                  type="button"
                  className="pressable h-12 rounded-full bg-[#ff3040] px-5 text-[13px] font-semibold text-white"
                  onClick={() => {
                    callRef.current?.stop()
                    callRef.current = null
                    if (id) void apiEndCall(id).catch(() => {})
                    setCallOpen(false)
                  }}
                >
                  Конец
                </button>
              </div>
            </div>
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
          <div className="flex items-center justify-between gap-3 bg-[#1c1c1e] px-4 py-3 text-[14px] text-white">
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
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setActionMsgId(null)}>
            <div className="w-full max-w-lg rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <p className="mb-3 text-center text-[15px] font-semibold text-white">Сообщение</p>
              {(() => {
                const m = apiMessages.find((x) => x.id === actionMsgId)
                const mine = m?.sender_id === uid
                const mid = actionMsgId
                const row = 'pressable rounded-2xl bg-[#2c2c2e] px-4 py-3.5 text-left text-[16px] text-white'
                return (
                  <div className="flex flex-col gap-2">
                    <button type="button" className={row} onClick={() => { setActionMsgId(null); setReaders([]); setReadersFor(mid) }}>Кто прочитал</button>
                    <button type="button" className={row} onClick={() => { setActionMsgId(null); setEditing(null); setReplyTo(m ?? null) }}>Ответить</button>
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
                    {mine && m && canEditType(m.msg_type) ? (
                      <button type="button" className={row} onClick={() => {
                        setActionMsgId(null)
                        setReplyTo(null)
                        setEditing(m)
                        setText(m.body || '')
                      }}>Редактировать</button>
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
                    <button type="button" className="mt-1 w-full py-2 text-center text-[15px] text-[#8e8e93]" onClick={() => setActionMsgId(null)}>Отмена</button>
                  </div>
                )
              })()}
            </div>
          </div>
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
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setHeaderMenuOpen(false)}>
            <div className="w-full max-w-lg rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <p className="mb-3 text-center text-[15px] font-semibold text-white">Чат</p>
              <div className="flex flex-col gap-2">
                <button type="button" className="pressable rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-[15px] text-white" onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiListChatMedia(id).then((r) => { setMediaItems(r.items ?? []); setMediaOpen(true) })
                }}>Медиа</button>
                <button type="button" className="pressable rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-[15px] text-white" onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  const pick = window.prompt('Исчезающие: часы 0/1/6/24/168', String(disappearHours ?? 0))
                  if (pick == null) return
                  const n = Number(pick)
                  const hours = !n ? null : n
                  const after = window.confirm('Удалять после прочтения?')
                  void apiSetDisappear(id, { hours, after_read: after }).then((r) => {
                    setDisappearHours(r.disappear_hours)
                    setDisappearAfterRead(!!r.disappear_after_read)
                    showToast(hours ? `Исчезают · ${hours} ч` : 'Исчезающие выкл')
                  }).catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка'))
                }}>Исчезающие{disappearHours ? ` · ${disappearHours}ч` : ''}{disappearAfterRead ? ' · чтение' : ''}</button>
                <button type="button" className="pressable rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-[15px] text-white" onClick={() => {
                  setHeaderMenuOpen(false)
                  setScheduleOpen(true)
                }}>Отложить</button>
                {!apiConv?.is_group ? (
                  <button type="button" className="pressable rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-[15px] text-white" onClick={() => {
                    setHeaderMenuOpen(false)
                    if (!id || !peer?.id) return
                    void (async () => {
                      try {
                        const started = await apiStartCall(id)
                        setCallOpen(true)
                        setCallStatus('Звонок…')
                        await new Promise((r) => setTimeout(r, 80))
                        const ice = started.ice_servers || [{ urls: 'stun:stun.l.google.com:19302' }]
                        setCallMicMuted(false)
                        setCallCamOff(false)
                        setCallFailed(false)
                        const session = new DmVideoSession({
                          localUserId: uid,
                          peerId: peer.id,
                          iceServers: ice,
                          localVideo: localVideoRef.current,
                          remoteVideo: remoteVideoRef.current,
                          onStatus: setCallStatus,
                          onFailed: (m) => {
                            setCallFailed(true)
                            showToast(m)
                          },
                          sendSignal: (to, kind, payload) => apiPostCallSignal(id, to, kind, payload),
                          pollSignals: async () => {
                            const r = await apiPollCallSignals(id)
                            return (r.items || []) as any
                          },
                        })
                        callRef.current = session
                        await session.start()
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : 'Звонок не удался')
                        setCallOpen(false)
                        setCallFailed(true)
                      }
                    })()
                  }}>Видеозвонок</button>
                ) : null}
                <button type="button" className="pressable rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-[15px] text-white" onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiPatchConversation(id, { pinned: !apiConv?.pinned }).then(() => {
                    showToast(apiConv?.pinned ? 'Чат откреплён' : 'Чат закреплён')
                    void loadApi()
                  })
                }}>{apiConv?.pinned ? 'Открепить чат' : 'Закрепить чат'}</button>
                <button type="button" className="pressable rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-[15px] text-white" onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiPatchConversation(id, { folder: 'important' }).then(() => showToast('В «Важные»'))
                }}>В «Важные»</button>
                <button type="button" className="pressable rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left text-[15px] text-white" onClick={() => {
                  setHeaderMenuOpen(false)
                  if (!id) return
                  void apiPatchConversation(id, { archived: true, folder: 'archive' }).then(() => {
                    showToast('В архиве')
                    dismiss('/app/messages')
                  })
                }}>Архив</button>
                <button type="button" className="mt-1 w-full py-2 text-center text-[14px] text-[#8e8e93]" onClick={() => setHeaderMenuOpen(false)}>Отмена</button>
              </div>
            </div>
          </div>
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
          onClearMedia={() => {
            setPendingMedia(null)
            setPendingFilename(null)
            setPendingMediaKind('image')
          }}
        />
      </div>
    )
  }

  if (!conversation || !other) {
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

  const bubbles: BubbleMsg[] = localMessages.map((m) => ({
    id: m.id,
    mine: m.senderId === uid,
    body: m.text,
    createdAt: m.createdAt,
  }))

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <TopBar
        onBack={() => dismiss('/app/messages')}
        name={other.name}
        username={other.username}
        subtitle={other.name && other.name !== other.username ? other.name : other.bio}
        avatar={other.avatar}
        id={other.id}
        onOpenInfo={() => navigate(`/app/profile/${other.id}`)}
      />
      <ChatThread
        typing={!!typingUserId}
        messages={bubbles}
        peerName={other.name}
        peerUsername={other.username}
        peerAvatar={other.avatar}
        peerId={other.id}
        profileTo={`/app/profile/${other.id}`}
        peerSubtitle={other.bio || (other.name !== other.username ? other.name : undefined)}
        bottomRef={bottomRef}
      />
      <ChatComposer text={text} setText={setText} onSubmit={onSend} />
    </div>
  )
}
