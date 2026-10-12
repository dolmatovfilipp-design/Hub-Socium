import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import { isApiMode } from '../lib/api'
import { isValidEmailOrPhone, isValidPassword } from '../utils/validation'

type Step = 'contact' | 'reset' | 'done'

/** Matches the server-side cooldown between two codes for one account. */
const RESEND_SECONDS = 60

export function PasswordReset() {
  const navigate = useNavigate()
  const requestReset = useStore((s) => s.requestReset)
  const confirmReset = useStore((s) => s.confirmReset)
  const shownCode = useStore((s) => s.resetCode)
  const apiMode = isApiMode()
  const codeInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('contact')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  const sendCode = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!isValidEmailOrPhone(contact) && contact.trim().length < 3) {
      setError('Укажите email, телефон или имя пользователя')
      return
    }
    setBusy(true)
    const res = await requestReset(contact)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Не удалось отправить код')
      return
    }
    setCode('')
    setPassword('')
    setCooldown(RESEND_SECONDS)
    setStep('reset')
  }

  const resend = async () => {
    if (cooldown > 0 || busy) return
    setError('')
    setInfo('')
    setBusy(true)
    const res = await requestReset(contact)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Не удалось отправить код')
      return
    }
    setCode('')
    setCooldown(RESEND_SECONDS)
    setInfo('Отправили код ещё раз. Действителен только последний.')
    codeInput.current?.focus()
  }

  const savePassword = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (code.length !== 6) {
      setError('Введите 6-значный код из письма')
      codeInput.current?.focus()
      return
    }
    if (!isValidPassword(password)) {
      setError('Пароль не менее 4 символов')
      return
    }
    setBusy(true)
    const res = await confirmReset(code, password)
    setBusy(false)
    if (!res.ok) {
      if (res.codeInvalid) {
        setCode('')
        setError('Код неверный или устарел. Введите код из последнего письма или запросите новый.')
        codeInput.current?.focus()
        return
      }
      setError(res.error ?? 'Ошибка')
      return
    }
    setStep('done')
  }

  return (
    <div className="flex h-full flex-col px-6 safe-top animate-fade-in">
      <button
        type="button"
        onClick={() => (step === 'done' ? navigate('/login') : navigate(-1))}
        className="mt-2 flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
        aria-label="Назад"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h1 className="mt-4 text-2xl font-bold text-hub-text">Сброс пароля</h1>

      {step === 'contact' && (
        <form onSubmit={(e) => void sendCode(e)} className="mt-8 space-y-4">
          <p className="text-sm text-hub-muted">
            {apiMode
              ? 'Введите email, телефон или имя пользователя. Мы отправим 6-значный код на почту, привязанную к аккаунту.'
              : 'Демо-режим: письма не отправляются, код появится на следующем экране.'}
          </p>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="email@… / +7… / username"
            className="hub-field h-14 w-full rounded-2xl px-4 text-[16px] text-hub-text"
            autoComplete="username"
          />
          {error && <p className="text-sm text-red-400/90">{error}</p>}
          <button type="submit" disabled={busy} className="btn-liquid-glass">
            {busy ? 'Отправка…' : 'Отправить код'}
          </button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={(e) => void savePassword(e)} className="mt-8 space-y-4">
          {shownCode ? (
            <div className="rounded-2xl border border-[color:var(--hub-app-border,rgba(255,255,255,0.1))] bg-[color:var(--hub-app-card,#111)] px-4 py-3 text-sm text-hub-silver">
              {apiMode ? 'DEV-код' : 'Демо-код'}:{' '}
              <span className="font-mono text-lg tracking-widest text-hub-text">{shownCode}</span>
            </div>
          ) : (
            <p className="text-sm text-hub-muted">
              Если аккаунт найден и к нему привязана почта, мы отправили на неё 6-значный код. Он действует
              15 минут. Проверьте папку «Спам».
            </p>
          )}
          <input
            ref={codeInput}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            aria-label="Код из письма"
            className="hub-field h-14 w-full rounded-2xl px-4 text-center text-xl tracking-[0.4em] text-hub-text"
            autoComplete="one-time-code"
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Новый пароль"
            aria-label="Новый пароль"
            className="hub-field h-14 w-full rounded-2xl px-4 text-[16px] text-hub-text"
            autoComplete="new-password"
          />
          {info && <p className="text-sm text-hub-silver">{info}</p>}
          {error && <p className="text-sm text-red-400/90">{error}</p>}
          <button type="submit" disabled={busy} className="btn-liquid-glass">
            {busy ? 'Сохранение…' : 'Сохранить пароль'}
          </button>
          <div className="flex flex-col items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void resend()}
              disabled={cooldown > 0 || busy}
              className="text-sm text-hub-silver disabled:text-hub-muted"
            >
              {cooldown > 0 ? `Отправить код ещё раз через ${cooldown} с` : 'Отправить код ещё раз'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError('')
                setInfo('')
                setStep('contact')
              }}
              className="text-sm text-hub-muted"
            >
              Изменить email, телефон или имя
            </button>
          </div>
          {apiMode && !shownCode && (
            <p className="text-center text-xs text-hub-muted">
              Письма нет? Код приходит только на почту, указанную в аккаунте. Если вы регистрировались по
              телефону, добавьте почту в профиле.
            </p>
          )}
        </form>
      )}

      {step === 'done' && (
        <div className="mt-8 space-y-4">
          <p className="text-hub-silver">
            Пароль обновлён.{apiMode ? ' Прежние сеансы завершены.' : ''} Теперь можно войти.
          </p>
          <button type="button" onClick={() => navigate('/login')} className="btn-liquid-glass">
            К входу
          </button>
        </div>
      )}
    </div>
  )
}
