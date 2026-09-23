import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useNavMotion } from '../components/NavMotion'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { IconChevron, IconPlane, IconUser } from '../components/Icons'
import { formatFollowers } from '../utils/validation'
import {
  apiListConversations,
  apiListMessages,
  apiDeleteMessage,
  apiUploadMedia,
  apiSendMessageMedia,
  apiMarkConversationRead,
  isApiMode,
  type ApiConversation,
  type ApiMessage,
} from '../lib/api'

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

type BubbleMsg = { id: string; mine: boolean; body: string; createdAt: string; mediaUrl?: string }

function ChatThread({
  messages,
  peerName,
  peerUsername,
  peerAvatar,
  peerId,
  peerFollowers,
  bottomRef,
  onDeleteMessage,
}: {
  messages: BubbleMsg[]
  peerName: string
  peerUsername: string
  peerAvatar?: string
  peerId: string
  peerFollowers: number
  bottomRef: RefObject<HTMLDivElement | null>
  onDeleteMessage?: (id: string) => void
}) {
  let lastDate = ''

  return (
    <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-4 pt-2">
      {/* Profile header block */}
      <div className="mb-6 flex flex-col items-center px-4 pt-4 text-center">
        <Avatar name={peerName} id={peerId} src={peerAvatar} size={88} />
        <p className="mt-3 text-[20px] font-bold leading-tight text-white">{peerUsername}</p>
        <p className="mt-0.5 text-[14px] text-[#8e8e93]">{peerUsername}</p>
        <p className="mt-2 text-[14px] text-[#8e8e93]">
          {formatFollowers(peerFollowers)} подписчиков
        </p>
        <p className="mt-1 text-[13px] text-[#8e8e93]">
          Вы подписаны друг на друга в Hub
        </p>
        <Link
          to={`/app/profile/${peerId}`}
          className="pressable mt-4 flex flex-col items-center gap-1 text-white"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25">
            <IconUser size={18} />
          </span>
          <span className="text-[13px]">Посмотреть профиль</span>
        </Link>
      </div>

      {messages.map((m) => {
        const dk = dateKey(m.createdAt)
        const showDate = dk !== lastDate
        lastDate = dk
        return (
          <div key={m.id}>
            {showDate && (
              <p className="mb-3 mt-4 text-center text-[11px] font-medium tracking-wide text-[#8e8e93]">
                {formatChatDate(m.createdAt)}
              </p>
            )}
            <div className={`mb-2.5 flex items-end gap-2 ${m.mine ? 'justify-end' : 'justify-start'}`}>
              {!m.mine && (
                <Avatar name={peerName} id={peerId} src={peerAvatar} size={28} />
              )}
              <div
                className={`msg-bubble ${m.mine ? 'msg-bubble-mine' : 'msg-bubble-theirs'}`}
                onDoubleClick={() => {
                  if (m.mine && onDeleteMessage && confirm('Удалить сообщение?')) {
                    onDeleteMessage(m.id)
                  }
                }}
              >
                {m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="" className="mb-1 max-h-48 rounded-xl" />
                ) : null}
                {m.body ? (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}

      {messages.length > 0 && (
        <p className="mt-1 text-right text-[12px] text-[#8e8e93]">Просмотрено</p>
      )}
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
  onPickMedia,
  onClearMedia,
}: {
  text: string
  setText: (v: string) => void
  onSubmit: (e: FormEvent) => void
  disabled?: boolean
  sending?: boolean
  pendingMedia?: string | null
  onPickMedia?: () => void
  onClearMedia?: () => void
}) {
  const canSend = (text.trim().length > 0 || !!pendingMedia) && !disabled && !sending

  return (
    <form
      onSubmit={onSubmit}
      className="flex shrink-0 flex-col gap-1 bg-black px-3 pt-2"
      style={{ paddingBottom: 'max(12px, var(--hub-safe-bottom))' }}
    >
      {pendingMedia ? (
        <div className="flex items-center justify-between rounded-xl bg-[#1c1c1e] px-3 py-2 text-[13px] text-[#8e8e93]">
          <span>Фото прикреплено</span>
          <button type="button" className="text-white" onClick={onClearMedia}>
            Убрать
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {onPickMedia ? (
          <button
            type="button"
            className="pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1c1c1e] text-white"
            aria-label="Фото"
            onClick={onPickMedia}
          >
            +
          </button>
        ) : null}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Сообщение…"
          className="min-h-[40px] flex-1 rounded-full bg-[#1c1c1e] px-4 py-2.5 text-[15px] text-white placeholder:text-[#8e8e93]"
        />
        {canSend && (
          <button
            type="submit"
            className="pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black"
            aria-label="Отправить"
          >
            <IconPlane size={18} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </form>
  )
}

function TopBar({
  name,
  username,
  avatar,
  id,
  onBack,
}: {
  name: string
  username: string
  avatar?: string
  id: string
  onBack: () => void
}) {
  return (
    <header className="safe-top z-10 shrink-0 bg-black px-2 pb-2 pt-1">
      <div className="relative flex h-12 items-center">
        <button
          type="button"
          onClick={onBack}
          className="pressable relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center text-white"
          aria-label="Назад"
        >
          <IconChevron size={22} className="-scale-x-100" />
        </button>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <Avatar name={name} id={id} src={avatar} size={28} />
          <div className="mt-0.5 max-w-[55%] truncate text-[13px] font-semibold leading-tight text-white">
            {username}
          </div>
        </div>
        <div className="flex-1" aria-hidden />
      </div>
    </header>
  )
}

export function Chat() {
  const { id } = useParams<{ id: string }>()
  const { motionClass, dismiss } = useNavMotion('push')
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
  const mediaRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const loadApi = useCallback(async () => {
    if (!isApiMode() || !id) return
    setLoading(true)
    setError(null)
    try {
      const [convs, msgs] = await Promise.all([
        apiListConversations(),
        apiListMessages(id, 50),
      ])
      const found = (convs.items ?? []).find((c) => c.id === id) ?? null
      setApiConv(found)
      setApiMessages(msgs.items ?? [])
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
    void loadApi()
  }, [loadApi])

  // Soft realtime: poll open chat every 2.5s (API mode only)
  useEffect(() => {
    if (!api || !id) return
    const POLL_MS = 2500
    const tick = async () => {
      try {
        const msgs = await apiListMessages(id, 50)
        const items = msgs.items ?? []
        setApiMessages((prev) => {
          if (prev.length === items.length && prev.every((m, i) => m.id === items[i]?.id)) {
            return prev
          }
          return items
        })
      } catch {
        // ignore transient poll errors
      }
    }
    const h = window.setInterval(() => void tick(), POLL_MS)
    return () => window.clearInterval(h)
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
      if ((!text.trim() && !pendingMedia) || !id || sending) return
      const body = text.trim()
      const media = pendingMedia
      setText('')
      setPendingMedia(null)
      setSending(true)
      try {
        const msg = await apiSendMessageMedia(id, body, media || undefined)
        setApiMessages((prev) => [...prev, msg])
      } catch (err) {
        setText(body)
        showToast(err instanceof Error ? err.message : 'Не отправилось')
      } finally {
        setSending(false)
      }
    }

    if (loading) {
      return (
        <div className={`flex h-full items-center justify-center bg-black text-[#8e8e93] ${motionClass}`}>
          Загрузка…
        </div>
      )
    }
    if (error || !peer) {
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
    }))

    return (
      <div className={`flex h-full flex-col bg-black ${motionClass}`}>
        <TopBar
          onBack={() => dismiss('/app/messages')}
          name={peer.display_name || peer.username}
          username={peer.username}
          avatar={peer.avatar_url || undefined}
          id={peer.id}
        />
        <ChatThread
          messages={bubbles}
          peerName={peer.display_name || peer.username}
          peerUsername={peer.username}
          peerAvatar={peer.avatar_url || undefined}
          peerId={peer.id}
          peerFollowers={0}
          bottomRef={bottomRef}
          onDeleteMessage={(msgId) => {
            if (!id) return
            void apiDeleteMessage(id, msgId)
              .then(() => setApiMessages((prev) => prev.filter((m) => m.id !== msgId)))
              .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось удалить'))
          }}
        />
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
                showToast('Фото прикреплено')
              })
              .catch((err) => showToast(err instanceof Error ? err.message : 'Ошибка фото'))
          }}
        />
        <ChatComposer
          text={text}
          setText={setText}
          onSubmit={(e) => void onSend(e)}
          sending={sending}
          pendingMedia={pendingMedia}
          onPickMedia={() => mediaRef.current?.click()}
          onClearMedia={() => setPendingMedia(null)}
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
        avatar={other.avatar}
        id={other.id}
      />
      <ChatThread
        messages={bubbles}
        peerName={other.name}
        peerUsername={other.username}
        peerAvatar={other.avatar}
        peerId={other.id}
        peerFollowers={other.followers}
        bottomRef={bottomRef}
      />
      <ChatComposer text={text} setText={setText} onSubmit={onSend} />
    </div>
  )
}
