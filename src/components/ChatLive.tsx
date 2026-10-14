import { useState, type ReactNode } from 'react'
import { Bell, Clock, Languages, ShoppingBag, Sparkles, Sticker, Timer } from 'lucide-react'

const row = 'pressable flex w-full items-center gap-3 rounded-2xl bg-[#2c2c2e] px-4 py-3.5 text-left text-[16px] text-white'

function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1c1c1e] text-white">
      {children}
    </span>
  )
}

export function HonestBanner({ text }: { text: string }) {
  return (
    <p data-ai-off="" className="rounded-2xl bg-[#2c2c2e] px-4 py-3 text-[14px] leading-snug text-[#e5e5ea]">
      {text}
    </p>
  )
}

export function ToolSheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl bg-[#1c1c1e] px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <p className="mb-3 text-center text-[15px] font-semibold text-white">{title}</p>
        {children}
      </div>
    </div>
  )
}

export function SummaryBody({
  loading,
  text,
  off,
}: {
  loading: boolean
  text: string
  off: string
}) {
  if (off) return <HonestBanner text={off} />
  if (loading) return <p className="py-6 text-center text-[14px] text-[#8e8e93]">Собираю пересказ…</p>
  return <p className="whitespace-pre-wrap text-[15px] leading-snug text-white">{text || 'Новых сообщений нет.'}</p>
}

export function ScheduleFields({
  onSchedule,
  onRemind,
}: {
  onSchedule: (body: string, iso: string) => void
  onRemind: (iso: string) => void
}) {
  const [body, setBody] = useState('')
  const [when, setWhen] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Текст сообщения"
        rows={3}
        className="w-full resize-none rounded-2xl bg-[#2c2c2e] px-3 py-2 text-[15px] text-white outline-none placeholder:text-[#8e8e93]"
      />
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="rounded-2xl bg-[#2c2c2e] px-3 py-2 text-[15px] text-white"
      />
      <button
        type="button"
        className={row}
        onClick={() => {
          if (!body.trim() || !when) return
          onSchedule(body.trim(), new Date(when).toISOString())
        }}
      >
        <Glyph><Clock size={16} strokeWidth={2} /></Glyph>
        Запланировать
      </button>
      <button
        type="button"
        className={row}
        onClick={() => {
          const iso = when ? new Date(when).toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString()
          onRemind(iso)
        }}
      >
        <Glyph><Bell size={16} strokeWidth={2} /></Glyph>
        Напомнить ответить
      </button>
    </div>
  )
}

export const DISAPPEAR_CHOICES = [
  { hours: null as number | null, label: 'Выкл' },
  { hours: 1, label: '1 час' },
  { hours: 6, label: '6 часов' },
  { hours: 24, label: '24 часа' },
  { hours: 168, label: '7 дней' },
]

export function DisappearChoices({
  current,
  afterRead,
  onPick,
}: {
  current: number | null
  afterRead: boolean
  onPick: (hours: number | null, afterRead: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {DISAPPEAR_CHOICES.map((choice) => (
        <button key={choice.label} type="button" className={row} onClick={() => onPick(choice.hours, afterRead)}>
          <Glyph><Timer size={16} strokeWidth={2} /></Glyph>
          {choice.label}
          {current === choice.hours ? <span className="ml-auto text-[13px] text-[#8e8e93]">сейчас</span> : null}
        </button>
      ))}
      <button type="button" className={row} onClick={() => onPick(current, !afterRead)}>
        После прочтения: {afterRead ? 'вкл' : 'выкл'}
      </button>
    </div>
  )
}

export function StickerForm({
  onCreate,
  off,
}: {
  onCreate: (prompt: string) => void
  off: string
}) {
  const [prompt, setPrompt] = useState('')
  if (off) return <HonestBanner text={off} />
  return (
    <div className="flex flex-col gap-3">
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Опишите стикер"
        className="rounded-2xl bg-[#2c2c2e] px-3 py-3 text-[15px] text-white outline-none placeholder:text-[#8e8e93]"
      />
      <button type="button" className={row} onClick={() => prompt.trim() && onCreate(prompt.trim())}>
        <Glyph><Sticker size={16} strokeWidth={2} /></Glyph>
        Создать
      </button>
    </div>
  )
}

export function OrderForm({ onCreate }: { onCreate: (title: string, rub: number) => void }) {
  const [title, setTitle] = useState('')
  const [rub, setRub] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Что покупают"
        className="rounded-2xl bg-[#2c2c2e] px-3 py-3 text-[15px] text-white outline-none placeholder:text-[#8e8e93]"
      />
      <input
        value={rub}
        inputMode="numeric"
        onChange={(e) => setRub(e.target.value.replace(/[^\d]/g, ''))}
        placeholder="Сумма, ₽"
        className="rounded-2xl bg-[#2c2c2e] px-3 py-3 text-[15px] text-white outline-none placeholder:text-[#8e8e93]"
      />
      <button
        type="button"
        className={row}
        onClick={() => {
          const n = Number(rub)
          if (!title.trim() || n < 1) return
          onCreate(title.trim(), n)
        }}
      >
        <Glyph><ShoppingBag size={16} strokeWidth={2} /></Glyph>
        Карточка заказа
      </button>
    </div>
  )
}

export function menuGlyph(kind: 'ai' | 'lang' | 'clock' | 'timer' | 'sticker' | 'order') {
  const icon =
    kind === 'ai' ? <Sparkles size={16} strokeWidth={2} /> :
    kind === 'lang' ? <Languages size={16} strokeWidth={2} /> :
    kind === 'clock' ? <Clock size={16} strokeWidth={2} /> :
    kind === 'timer' ? <Timer size={16} strokeWidth={2} /> :
    kind === 'sticker' ? <Sticker size={16} strokeWidth={2} /> :
    <ShoppingBag size={16} strokeWidth={2} />
  return <Glyph>{icon}</Glyph>
}
