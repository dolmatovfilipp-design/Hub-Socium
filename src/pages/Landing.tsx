import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, apiJoinWaitlist, apiValidateInvite, isApiMode } from '../lib/api'
import { useStore } from '../store/useStore'
import { isValidEmail } from '../utils/validation'

const INVITE_STORAGE_KEY = 'hub_invite_code'

/** Local-only fallback when VITE_USE_API is off (clearly labeled). */
function localValidateInvite(code: string): boolean {
  const trimmed = code.trim()
  if (!trimmed) return false
  return trimmed.toUpperCase() === 'HUB-BETA'
}

export function Landing() {
  const navigate = useNavigate()
  const showToast = useStore((s) => s.showToast)
  const [mode, setMode] = useState<'waitlist' | 'invite'>('waitlist')
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const api = isApiMode()

  const onWaitlist = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const value = email.trim()
    if (!isValidEmail(value)) {
      setError('Введите корректный email')
      return
    }
    if (!api) {
      setEmail('')
      showToast('Заявка принята (локально, без API)')
      return
    }
    setBusy(true)
    try {
      const res = await apiJoinWaitlist(value)
      setEmail('')
      showToast(res.created === false ? 'Вы уже в waitlist' : 'Заявка принята')
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Ошибка waitlist'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const onInvite = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const code = invite.trim()
    if (!code) {
      setError('Введите код приглашения')
      return
    }
    if (!api) {
      if (!localValidateInvite(code)) {
        setError('Неверный код (локальный режим: только HUB-BETA)')
        return
      }
      try {
        sessionStorage.setItem(INVITE_STORAGE_KEY, code.toUpperCase())
      } catch {
        /* ignore */
      }
      showToast('Код принят (локально) — регистрация')
      navigate('/register')
      return
    }
    setBusy(true)
    try {
      const res = await apiValidateInvite(code)
      try {
        sessionStorage.setItem(INVITE_STORAGE_KEY, res.code)
      } catch {
        /* ignore */
      }
      showToast('Код принят — зарегистрируйтесь')
      navigate('/register')
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Ошибка invite'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black px-6 safe-top safe-bottom">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-6 animate-fade-in">
        <h1 className="hub-wordmark">Hub</h1>
        <p className="mt-4 max-w-[20rem] text-center text-[15px] leading-relaxed text-hub-muted">
          Социальная сеть в духе Threads. Закрытый private beta в России.
        </p>

        {!api && (
          <p className="mt-3 max-w-sm text-center text-xs text-amber-400/90" role="note">
            Локальный режим (без API): waitlist не сохраняется на сервер; invite — только HUB-BETA.
          </p>
        )}

        <div
          className="mt-8 flex w-full max-w-sm rounded-full border border-white/10 bg-white/[0.04] p-1"
          role="tablist"
          aria-label="Способ доступа"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'waitlist'}
            onClick={() => {
              setMode('waitlist')
              setError('')
            }}
            className={`flex-1 rounded-full py-2.5 text-sm font-medium transition-colors ${
              mode === 'waitlist' ? 'bg-white/10 text-hub-text' : 'text-hub-muted'
            }`}
          >
            Waitlist
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'invite'}
            onClick={() => {
              setMode('invite')
              setError('')
            }}
            className={`flex-1 rounded-full py-2.5 text-sm font-medium transition-colors ${
              mode === 'invite' ? 'bg-white/10 text-hub-text' : 'text-hub-muted'
            }`}
          >
            Invite
          </button>
        </div>

        {mode === 'waitlist' ? (
          <form onSubmit={onWaitlist} className="mt-5 w-full max-w-sm space-y-3" noValidate>
            <div>
              <label htmlFor="landing-email" className="mb-1.5 block text-sm text-hub-muted">
                Email для waitlist
              </label>
              <input
                id="landing-email"
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'landing-error' : undefined}
                className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30 focus:outline-none disabled:opacity-60"
              />
            </div>
            {error && (
              <p id="landing-error" className="text-sm text-red-400/90" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-liquid-glass" disabled={busy}>
              {busy ? 'Отправка…' : 'Оставить заявку'}
            </button>
          </form>
        ) : (
          <form onSubmit={onInvite} className="mt-5 w-full max-w-sm space-y-3" noValidate>
            <div>
              <label htmlFor="landing-invite" className="mb-1.5 block text-sm text-hub-muted">
                Код приглашения
              </label>
              <input
                id="landing-invite"
                type="text"
                name="invite"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="HUB-BETA"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'landing-error' : undefined}
                className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30 focus:outline-none disabled:opacity-60"
              />
            </div>
            {error && (
              <p id="landing-error" className="text-sm text-red-400/90" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-liquid-glass" disabled={busy}>
              {busy ? 'Проверка…' : 'Проверить код'}
            </button>
          </form>
        )}

        <div className="mt-8 w-full max-w-sm space-y-3">
          <Link to="/login" className="btn-liquid-glass">
            Войти
          </Link>
          <Link to="/register" className="btn-liquid-glass">
            Регистрация
          </Link>
        </div>
      </div>

      <footer className="shrink-0 pb-6 pt-2 text-center text-sm text-hub-muted">
        <Link to="/legal/privacy" className="text-hub-silver hover:underline">
          Политика
        </Link>
        <span className="mx-2 text-hub-muted/60" aria-hidden>
          ·
        </span>
        <Link to="/legal/terms" className="text-hub-silver hover:underline">
          Оферта
        </Link>
      </footer>
    </div>
  )
}
