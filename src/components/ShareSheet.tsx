import { createPortal } from 'react-dom'
import { useMemo, useState } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  path: string // e.g. /app/u/филипп or /app/p/:id
}

export function publicAppUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const p = path.startsWith('/') ? path : `/${path}`
  return `${origin}${p}`
}

export function ShareSheet({ open, onClose, title, path }: Props) {
  const url = useMemo(() => publicAppUrl(path), [path])
  const [copied, setCopied] = useState(false)
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`

  if (!open) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url, text: title })
        return
      } catch {
        /* user cancel */
      }
    }
    await copy()
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Закрыть" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-3xl border border-white/[0.08] bg-[#111] px-5 pb-8 pt-4 sm:rounded-3xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h3 className="text-center text-[16px] font-semibold text-white">{title}</h3>
        <div className="mt-4 flex justify-center">
          <img src={qrSrc} alt="QR" width={180} height={180} className="rounded-xl bg-white p-2" />
        </div>
        <p className="mt-3 break-all text-center text-[12px] text-[#8e8e93]">{url}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-[#1c1c1e] text-[14px] font-semibold text-white"
          >
            {copied ? 'Скопировано' : 'Копировать ссылку'}
          </button>
          <button
            type="button"
            onClick={() => void share()}
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-white text-[14px] font-semibold text-black"
          >
            Поделиться
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
