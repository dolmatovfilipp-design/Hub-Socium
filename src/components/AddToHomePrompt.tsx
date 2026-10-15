import { useEffect, useState } from 'react'
import { ONBOARDING_STORAGE_KEY } from '../lib/onboarding'
import { SHOW_A2HS_EVENT, dismissA2HS, isStandalone, shouldAutoShowA2HS } from '../lib/pwa'
import { enableWebPush, PUSH_DISMISS_KEY, syncGrantedPush } from '../lib/webPush'

function onboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

function ShareGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="text-white">
      <rect x="6" y="10" width="16" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 16V4M14 4l-4 4M14 4l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HomeGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="text-white">
      <rect x="4" y="4" width="20" height="20" rx="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 18.5V13.2L14 9.5l5 3.7v5.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function AddToHomePrompt() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const openSheet = () => setOpen(true)
    window.addEventListener(SHOW_A2HS_EVENT, openSheet)
    let timer = 0
    const arm = () => {
      if (!shouldAutoShowA2HS() || !onboardingDone()) return
      timer = window.setTimeout(() => setOpen(true), 900)
    }
    arm()
    const onClosed = () => arm()
    window.addEventListener('hub:onboarding-closed', onClosed)
    return () => {
      window.removeEventListener(SHOW_A2HS_EVENT, openSheet)
      window.removeEventListener('hub:onboarding-closed', onClosed)
      window.clearTimeout(timer)
    }
  }, [])

  if (!open) return null

  const close = () => {
    dismissA2HS()
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/55" role="presentation" onClick={close}>
      <div
        role="dialog"
        aria-labelledby="a2hs-title"
        data-testid="a2hs-sheet"
        className="w-full rounded-t-[26px] border-t border-white/[0.1] bg-[#111] px-5 pb-[max(20px,var(--hub-safe-bottom))] pt-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <div className="flex items-start justify-between gap-3">
          <h2 id="a2hs-title" className="text-[20px] font-bold leading-tight text-white">
            На экран «Домой»
          </h2>
          <button
            type="button"
            aria-label="Закрыть"
            data-testid="a2hs-dismiss"
            onClick={close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#aaa]"
          >
            ×
          </button>
        </div>
        <p className="mt-2 text-[14px] leading-snug text-[#aaa]">
          В Safari или Яндекс Браузере Get Hub открывается как приложение и может присылать уведомления.
        </p>
        <ol className="mt-4 space-y-3">
          <li className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06]">
              <ShareGlyph />
            </span>
            <span className="text-[15px] leading-snug text-white">
              Нажмите <span className="font-semibold">Поделиться</span>
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06]">
              <HomeGlyph />
            </span>
            <span className="text-[15px] leading-snug text-white">
              Выберите <span className="font-semibold">«На экран Домой»</span>
            </span>
          </li>
        </ol>
        <button
          type="button"
          data-testid="a2hs-ok"
          onClick={close}
          className="mt-5 h-12 w-full rounded-2xl bg-white text-[16px] font-semibold text-black"
        >
          Понятно
        </button>
      </div>
    </div>
  )
}

export function PushEnablePrompt() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!isStandalone()) return
    void syncGrantedPush().catch(() => {})
    const ask = () => {
      if (!onboardingDone()) return
      if (!isStandalone()) return
      if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
      try {
        if (localStorage.getItem(PUSH_DISMISS_KEY) === '1') return
      } catch {
        /* ignore */
      }
      setOpen(true)
    }
    ask()
    window.addEventListener('hub:onboarding-closed', ask)
    return () => window.removeEventListener('hub:onboarding-closed', ask)
  }, [])

  if (!open) return null

  const later = () => {
    try {
      localStorage.setItem(PUSH_DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/55" role="presentation">
      <div
        role="dialog"
        aria-labelledby="push-ask-title"
        data-testid="push-enable"
        className="w-full rounded-t-[26px] border-t border-white/[0.1] bg-[#111] px-5 pb-[max(20px,var(--hub-safe-bottom))] pt-4"
      >
        <h2 id="push-ask-title" className="text-[20px] font-bold text-white">
          Уведомления
        </h2>
        <p className="mt-2 text-[14px] leading-snug text-[#aaa]">
          Сообщения, звонки и упоминания придут, даже когда Get Hub закрыт.
        </p>
        {hint ? <p className="mt-2 text-[13px] text-[#f5c16c]">{hint}</p> : null}
        <button
          type="button"
          data-testid="push-allow"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setHint('')
            void enableWebPush()
              .then(() => setOpen(false))
              .catch((error) => {
                setHint(error instanceof Error ? error.message : 'Не удалось включить уведомления')
              })
              .finally(() => setBusy(false))
          }}
          className="mt-5 h-12 w-full rounded-2xl bg-white text-[16px] font-semibold text-black disabled:opacity-60"
        >
          Разрешить
        </button>
        <button type="button" data-testid="push-later" onClick={later} className="mt-2 h-11 w-full text-[15px] text-[#aaa]">
          Не сейчас
        </button>
      </div>
    </div>
  )
}
