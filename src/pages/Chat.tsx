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
  apiTyping,
  apiSendVoice,
  apiSendMessageFull,
  apiMarkConversationRead,
  apiReactMessage,
  apiForwardMessage,
  apiPatchConversation,
  apiGetChatPrefs,
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

type BubbleMsg = {
  id: string
  mine: boolean
  body: string
  createdAt: string
  mediaUrl?: string
  msgType?: string
  durationMs?: number
  read?: boolean
  replyToId?: string
  forwardOf?: string
  reactions?: { emoji: string; count: number; mine?: boolean }[]
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

function ChatThread({
  messages,
  peerName,
  peerUsername,
  peerAvatar,
  peerId,
  peerFollowers,
  bottomRef,
  onDeleteMessage,
  typing,
  onReply,
  onReact,
  onForward,
}: {
  messages: BubbleMsg[]
  peerName: string
  peerUsername: string
  peerAvatar?: string
  peerId: string
  peerFollowers: number
  bottomRef: RefObject<HTMLDivElement | null>
  onDeleteMessage?: (id: string) => void
  typing?: boolean
  onReply?: (id: string) => void
  onReact?: (id: string, emoji: string) => void
  onForward?: (id: string) => void
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
                {m.forwardOf ? (
                  <p className="mb-1 text-[11px] text-[#8e8e93]">↗ Переслано</p>
                ) : null}
                {m.replyToId ? (
                  <p className="mb-1 rounded-lg bg-black/20 px-2 py-1 text-[11px] text-[#8e8e93]">↩ ответ</p>
                ) : null}
                {m.msgType === 'voice' && m.mediaUrl ? (
                  <VoiceBubble url={m.mediaUrl} durationMs={m.durationMs ?? 0} />
                ) : m.msgType === 'video_note' && m.mediaUrl ? (
                  <video src={m.mediaUrl} className="mb-1 h-40 w-40 rounded-full object-cover" controls playsInline />
                ) : m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="" className="mb-1 max-h-48 rounded-xl" />
                ) : null}
                {m.body && m.msgType !== 'voice' && m.msgType !== 'video_note' ? (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                ) : null}
                {m.reactions && m.reactions.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        className={`rounded-full px-1.5 text-[12px] ${r.mine ? 'bg-white/25' : 'bg-white/10'}`}
                        onClick={() => onReact?.(m.id, r.emoji)}
                      >
                        {r.emoji} {r.count}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-1 flex gap-2 text-[10px] text-[#8e8e93]">
                  {onReply ? <button type="button" onClick={() => onReply(m.id)}>Ответить</button> : null}
                  {onReact ? <button type="button" onClick={() => onReact(m.id, '❤️')}>❤️</button> : null}
                  {onReact ? <button type="button" onClick={() => onReact(m.id, '🔥')}>🔥</button> : null}
                  {onForward ? <button type="button" onClick={() => onForward(m.id)}>↗</button> : null}
                </div>
                {m.mine && m.read ? (
                  <p className="mt-1 text-right text-[10px] text-[#8e8e93]">прочитано</p>
                ) : null}
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
  onPickMedia,
  onClearMedia,
  onTyping,
  onVoice,
  onVideoNote,
  recording,
}: {
  text: string
  setText: (v: string) => void
  onSubmit: (e: FormEvent) => void
  disabled?: boolean
  sending?: boolean
  pendingMedia?: string | null
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
        {onVoice ? (
          <button
            type="button"
            className={`pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${recording ? 'bg-red-600' : 'bg-[#1c1c1e]'}`}
            aria-label={recording ? 'Стоп' : 'Голос'}
            onClick={onVoice}
          >
            {recording ? '⏹' : '🎤'}
          </button>
        ) : null}
        {onVideoNote ? (
          <button
            type="button"
            className="pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1c1c1e] text-[11px] text-white"
            aria-label="Кружок"
            onClick={onVideoNote}
          >
            ⭕️
          </button>
        ) : null}
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onTyping?.()
          }}
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
  onPin,
  onArchive,
  onImportant,
}: {
  name: string
  username: string
  avatar?: string
  id: string
  onBack: () => void
  onPin?: () => void
  onArchive?: () => void
  onImportant?: () => void
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
        <div className="relative z-[1] ml-auto flex items-center">
          {onImportant ? (
            <button type="button" className="pressable h-9 px-1.5 text-[12px] text-[#8e8e93]" onClick={onImportant} aria-label="Важные">★</button>
          ) : null}
          {onPin ? (
            <button type="button" className="pressable h-9 px-1.5 text-[12px] text-[#8e8e93]" onClick={onPin} aria-label="Закрепить">📌</button>
          ) : null}
          {onArchive ? (
            <button type="button" className="pressable h-9 px-1.5 text-[12px] text-[#8e8e93]" onClick={onArchive} aria-label="Архив">📥</button>
          ) : null}
        </div>
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
  const [chatTheme, setChatTheme] = useState<{ gradient: string[] } | null>(null)
  const videoNoteRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!api) return
    void apiGetChatPrefs()
      .then((prefs) => {
        const th = (prefs.themes ?? []).find((x) => x.id === prefs.theme_id)
        if (th) setChatTheme({ gradient: th.gradient })
      })
      .catch(() => {})
  }, [api])

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
    const POLL_MS = 1500
    const tick = async () => {
      try {
        const msgs = await apiListMessages(id, 50)
        const items = msgs.items ?? []
        setTypingUserId(msgs.typing_user_id ?? null)
        setApiMessages((prev) => {
          const same =
            prev.length === items.length &&
            prev.every((m, i) => m.id === items[i]?.id && m.read === items[i]?.read)
          return same ? prev : items
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
      const replyId = replyTo?.id
      setReplyTo(null)
      try {
        const msg = await apiSendMessageFull(id, {
          body: body || (media ? ' ' : ''),
          media_url: media || undefined,
          msg_type: media ? 'image' : 'text',
          reply_to_id: replyId,
        })
        setApiMessages((prev) => [...prev, msg])
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
      msgType: m.msg_type,
      durationMs: m.duration_ms,
      read: m.read,
      replyToId: m.reply_to_id,
      forwardOf: m.forward_of,
      reactions: m.reactions,
    }))

    const themeStyle = chatTheme
      ? { background: `linear-gradient(180deg, ${chatTheme.gradient[0]}, ${chatTheme.gradient[1] || chatTheme.gradient[0]})` }
      : undefined

    return (
      <div className={`flex h-full flex-col bg-black ${motionClass}`} style={themeStyle}>
        <TopBar
          onBack={() => dismiss('/app/messages')}
          name={peer.display_name || peer.username}
          username={peer.username}
          avatar={peer.avatar_url || undefined}
          id={peer.id}
          onPin={() => {
            if (!id) return
            void apiPatchConversation(id, { pinned: !apiConv?.pinned }).then(() => {
              showToast(apiConv?.pinned ? 'Чат откреплён' : 'Чат закреплён')
              void loadApi()
            })
          }}
          onArchive={() => {
            if (!id) return
            void apiPatchConversation(id, { archived: true, folder: 'archive' }).then(() => {
              showToast('В архиве')
              dismiss('/app/messages')
            })
          }}
          onImportant={() => {
            if (!id) return
            void apiPatchConversation(id, { folder: 'important' }).then(() => showToast('В «Важные»'))
          }}
        />
        <ChatThread
          typing={!!typingUserId}
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
          onReply={(msgId) => {
            const m = apiMessages.find((x) => x.id === msgId)
            if (m) setReplyTo(m)
          }}
          onReact={(msgId, emoji) => {
            if (!id) return
            void apiReactMessage(id, msgId, emoji)
              .then(() => loadApi())
              .catch((e) => showToast(e instanceof Error ? e.message : 'Реакция не добавилась'))
          }}
          onForward={(msgId) => {
            if (!id) return
            const target = window.prompt('ID чата для пересылки (откройте другой диалог и скопируйте id из URL):')
            if (!target?.trim()) return
            void apiForwardMessage(id, msgId, target.trim())
              .then(() => showToast('Переслано'))
              .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось переслать'))
          }}
        />
        {recording ? (
          <div className="flex items-center justify-between gap-3 bg-[#1c1c1e] px-4 py-3 text-[14px] text-white">
            <span className="text-red-400">● Запись {recSeconds}с</span>
            <button type="button" className="rounded-full bg-white px-4 py-1.5 font-semibold text-black" onClick={() => void stopVoiceRecording()}>
              Стоп
            </button>
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
                showToast('Фото прикреплено')
              })
              .catch((err) => showToast(err instanceof Error ? err.message : 'Ошибка фото'))
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
        <ChatComposer
          text={text}
          setText={setText}
          onSubmit={(e) => void onSend(e)}
          sending={sending}
          pendingMedia={pendingMedia}
          onPickMedia={() => mediaRef.current?.click()}
          onVideoNote={() => videoNoteRef.current?.click()}
          onTyping={() => {
            if (id) void apiTyping(id).catch(() => {})
          }}
          onVoice={() => {
            void startVoiceRecording()
          }}
          recording={recording}
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
              typing={!!typingUserId}
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
