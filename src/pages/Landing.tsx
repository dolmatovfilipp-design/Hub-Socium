import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, apiJoinWaitlist, apiValidateInvite, isApiMode } from '../lib/api'
import { useStore } from '../store/useStore'
import { isValidEmail } from '../utils/validation'
import { SegmentedControl } from '../components/SegmentedControl'

const INVITE_STORAGE_KEY = 'hub_invite_code'
const REFERRER_STORAGE_KEY = 'hub_referrer'

/** Local-only fallback when VITE_USE_API is off (clearly labeled). */
function localValidateInvite(code: string): boolean {
  const trimmed = code.trim()
  if (!trimmed) return false
  return trimmed.toUpperCase() === 'HUB-BETA'
}

interface LandingProps {
  /** Force invite tab (e.g. /invite route). */
  forceInvite?: boolean
}

export function Landing({ forceInvite = false }: LandingProps) {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const showToast = useStore((s) => s.showToast)
  const codeFromUrl = (search.get('code') || search.get('invite') || '').trim()
  const refFromUrl = (search.get('ref') || '').trim()

  const [mode, setMode] = useState<'waitlist' | 'invite'>(
    forceInvite || Boolean(codeFromUrl) ? 'invite' : 'waitlist',
  )
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState(codeFromUrl)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const api = isApiMode()

  useEffect(() => {
    if (forceInvite || codeFromUrl || refFromUrl) {
      setMode('invite')
      if (codeFromUrl) setInvite(codeFromUrl)
    }
    if (refFromUrl) {
      try {
        sessionStorage.setItem(REFERRER_STORAGE_KEY, refFromUrl)
      } catch {
        /* ignore */
      }
    }
  }, [forceInvite, codeFromUrl, refFromUrl])

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
      showToast('Код принят — переходим к регистрации')
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
      showToast('Приглашение принято — создайте аккаунт')
      navigate('/register')
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Неверный код'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black px-6 safe-top safe-bottom">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-6 animate-fade-in">
        <h1 className="hub-wordmark" aria-label="Get Hub">
          Get Hub
        </h1>
        <p className="mt-4 max-w-[20rem] text-center text-[15px] leading-relaxed text-hub-muted">
          {mode === 'invite'
            ? 'Вас пригласили в закрытый beta Get Hub. Введите код — и зарегистрируйтесь.'
            : 'Социальная сеть в духе Threads. Закрытый private beta в России.'}
        </p>

        {!api && (
          <p className="mt-3 max-w-sm text-center text-xs text-amber-400/90" role="note">
            Локальный режим (без API): waitlist не сохраняется на сервер; invite — только HUB-BETA.
          </p>
        )}

        <div className="mt-8 w-full max-w-sm">
          <SegmentedControl
            ariaLabel="Способ доступа"
            value={mode}
            options={[
              { value: 'waitlist' as const, label: 'Лист ожидания' },
              { value: 'invite' as const, label: 'Приглашение' },
            ]}
            onChange={(next) => {
              setMode(next)
              setError('')
            }}
          />
        </div>

        {mode === 'waitlist' ? (
          <form onSubmit={onWaitlist} className="mt-5 w-full max-w-sm space-y-3" noValidate>
            <div>
              <label htmlFor="landing-email" className="mb-1.5 block text-sm text-hub-muted">
                Email для листа ожидания
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
            <button type="submit" className="btn-auth-pill" disabled={busy}>
              {busy ? 'Отправка…' : 'Оставить заявку'}
            </button>
            <Link to="/login" className="btn-auth-pill">
              Войти
            </Link>
          </form>
        ) : (
          <form onSubmit={onInvite} className="mt-5 w-full max-w-sm space-y-3" noValidate>
            <p className="text-center text-[13px] leading-snug text-hub-muted">
              Код приходит в письме или от друга, который уже в Get Hub.
            </p>
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
                placeholder="Например HUB-BETA"
                autoComplete="off"
                autoFocus={forceInvite || Boolean(codeFromUrl)}
                spellCheck={false}
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'landing-error' : undefined}
                className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] tracking-wide text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30 focus:outline-none disabled:opacity-60"
              />
            </div>
            {error && (
              <p id="landing-error" className="text-sm text-red-400/90" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-auth-pill" disabled={busy}>
              {busy ? 'Проверка…' : 'Продолжить с кодом'}
            </button>
            <p className="text-center text-[12px] text-hub-muted">
              Уже есть аккаунт?{' '}
              <Link to="/login" className="text-hub-silver hover:underline">
                Войти
              </Link>
            </p>
          </form>
        )}

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

/** Dedicated invite landing for shared links. */
export function InviteLanding() {
  return <Landing forceInvite />
}
