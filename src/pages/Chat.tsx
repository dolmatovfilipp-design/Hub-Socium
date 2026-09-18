import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mic, Send } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { formatTimeAgo } from '../utils/validation'
import {
  apiListConversations,
  apiListMessages,
  apiMarkConversationRead,
  apiSendMessage,
  isApiMode,
  type ApiConversation,
  type ApiMessage,
} from '../lib/api'

export function Chat() {
  const { id } = useParams<{ id: string }>()
  const uid = useStore((s) => s.currentUserId)!
  const conversation = useStore((s) => s.conversations.find((c) => c.id === id))
  const allMessages = useStore((s) => s.messages)
  const localMessages = useMemo(
    () =>
      allMessages
        .filter((m) => m.conversationId === id)
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [allMessages, id],
  )
  const other = useStore((s) => {
    if (!conversation) return undefined
    const oid = conversation.participantIds.find((x) => x !== uid)
    return s.users.find((u) => u.id === oid)
  })
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
        // ignore mark-read errors
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
      if (!text.trim() || !id || sending) return
      const body = text.trim()
      setText('')
      setSending(true)
      try {
        const msg = await apiSendMessage(id, body)
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
        <div className="flex h-full items-center justify-center bg-black text-[#777]">
          Загрузка…
        </div>
      )
    }
    if (error || !peer) {
      return (
        <div className="flex h-full flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[#777]">{error ?? 'Диалог не найден'}</p>
          <Link to="/app/messages" className="mt-6 text-sm text-white underline">
            Назад
          </Link>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col">
        <header className="safe-top glass-strong z-10 flex shrink-0 items-center gap-3 border-b border-white/5 px-2 pb-3 pt-2">
          <Link
            to="/app/messages"
            className="flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
            aria-label="Назад"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Avatar
            name={peer.display_name || peer.username}
            id={peer.id}
            src={peer.avatar_url || undefined}
            size={36}
          />
          <div className="min-w-0">
            <div className="truncate font-semibold text-hub-text">
              {peer.display_name || peer.username}
            </div>
            <div className="text-xs text-hub-muted">@{peer.username}</div>
          </div>
        </header>

        <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {apiMessages.map((m) => {
            const mine = m.sender_id === uid
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${
                    mine
                      ? 'rounded-br-md bg-gradient-to-b from-[#3a3a44] to-[#25252a] text-hub-text border border-white/10'
                      : 'rounded-bl-md bg-white/[0.06] text-hub-silver border border-white/5'
                  }`}
                >
                  {m.body}
                  <div className={`mt-1 text-[10px] ${mine ? 'text-hub-muted' : 'text-hub-muted/80'}`}>
                    {formatTimeAgo(m.created_at)}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => void onSend(e)}
          className="safe-bottom glass-strong flex shrink-0 items-end gap-2 border-t border-white/5 px-3 pt-2"
        >
          <button
            type="button"
            onClick={() => showToast('Голосовые сообщения — скоро (заглушка)')}
            className="mb-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-hub-muted"
            aria-label="Голосовое"
          >
            <Mic className="h-5 w-5" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Сообщение…"
            className="mb-2 min-h-[44px] flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[16px] text-hub-text placeholder:text-hub-muted/50"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="mb-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#4a4a54] to-[#2c2c32] text-hub-text disabled:opacity-40 border border-white/10"
            aria-label="Отправить"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    )
  }

  if (!conversation || !other) {
    return (
      <div className="flex h-full items-center justify-center text-hub-muted">
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

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top glass-strong z-10 flex shrink-0 items-center gap-3 border-b border-white/5 px-2 pb-3 pt-2">
        <Link
          to="/app/messages"
          className="flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Avatar name={other.name} id={other.id} src={other.avatar} size={36} />
        <div className="min-w-0">
          <div className="truncate font-semibold text-hub-text">{other.name}</div>
          <div className="text-xs text-hub-muted">@{other.username}</div>
        </div>
      </header>

      <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {localMessages.map((m) => {
          const mine = m.senderId === uid
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${
                  mine
                    ? 'rounded-br-md bg-gradient-to-b from-[#3a3a44] to-[#25252a] text-hub-text border border-white/10'
                    : 'rounded-bl-md bg-white/[0.06] text-hub-silver border border-white/5'
                }`}
              >
                {m.text}
                <div className={`mt-1 text-[10px] ${mine ? 'text-hub-muted' : 'text-hub-muted/80'}`}>
                  {formatTimeAgo(m.createdAt)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSend}
        className="safe-bottom glass-strong flex shrink-0 items-end gap-2 border-t border-white/5 px-3 pt-2"
      >
        <button
          type="button"
          onClick={() => showToast('Голосовые сообщения — скоро (заглушка)')}
          className="mb-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-hub-muted"
          aria-label="Голосовое"
        >
          <Mic className="h-5 w-5" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Сообщение…"
          className="mb-2 min-h-[44px] flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[16px] text-hub-text placeholder:text-hub-muted/50"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="mb-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#4a4a54] to-[#2c2c32] text-hub-text disabled:opacity-40 border border-white/10"
          aria-label="Отправить"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
