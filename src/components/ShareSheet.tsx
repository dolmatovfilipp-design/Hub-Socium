import { createPortal } from 'react-dom'
import { useMemo, useState } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  path: string // e.g. /app/u/филипп or /app/p/:id
  /** Profile sheet sits above the tab bar, matching the phone frame. */
  floatAboveNav?: boolean
}

export function publicAppUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const p = path.startsWith('/') ? path : `/${path}`
  return `${origin}${p}`
}

export function ShareSheet({ open, onClose, title, path, floatAboveNav }: Props) {
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

  const portalRoot =
    (typeof document !== 'undefined' && document.getElementById('hub-overlay-root')) ||
    document.body

  return createPortal(
    <div
      className={`pointer-events-auto absolute inset-0 z-[var(--hub-z-sheet)] flex items-end justify-center ${floatAboveNav ? '' : 'sm:items-center'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hub-share-sheet-title"
    >
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Закрыть" onClick={onClose} />
      <div
        className={`relative z-[var(--hub-z-base)] w-full max-w-md border border-white/[0.08] bg-[#1c1c1e] px-4 pt-3 ${
          floatAboveNav
            ? 'mb-[calc(var(--hub-nav-height)+var(--hub-nav-inset-b)+6px)] rounded-3xl pb-4'
            : 'rounded-t-3xl pb-[max(2rem,var(--hub-safe-bottom))] sm:rounded-3xl'
        }`}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h3 id="hub-share-sheet-title" className="text-center text-[16px] font-semibold text-white">
          {title}
        </h3>
        <div className="mt-4 flex justify-center">
          <img src={qrSrc} alt={`QR-код: ${title}`} width={180} height={180} className="rounded-xl bg-white p-2" />
        </div>
        <p className="mt-3 break-all text-center text-[12px] text-[#8e8e93]">{url}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className={`flex flex-1 items-center justify-center rounded-xl bg-[#2c2c2e] text-center font-semibold leading-tight text-white ${
              floatAboveNav ? 'min-h-12 px-1.5 text-[13px]' : 'h-11 text-[14px]'
            }`}
          >
            {copied ? 'Скопировано' : 'Копировать ссылку'}
          </button>
          <button
            type="button"
            onClick={() => {
              const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`
              window.open(tg, '_blank', 'noopener,noreferrer')
            }}
            className={`flex flex-1 items-center justify-center rounded-xl font-semibold text-white ${
              floatAboveNav ? 'min-h-12 bg-[#2AABEE] px-1.5 text-[13px]' : 'h-11 bg-[#2AABEE]/80 text-[14px]'
            }`}
          >
            Telegram
          </button>
          <button
            type="button"
            onClick={() => void share()}
            className={`flex flex-1 items-center justify-center rounded-xl bg-white font-semibold text-black ${
              floatAboveNav ? 'min-h-12 px-1.5 text-[13px]' : 'h-11 text-[14px]'
            }`}
          >
            Поделиться
          </button>
        </div>
      </div>
    </div>,
    portalRoot,
  )
}
