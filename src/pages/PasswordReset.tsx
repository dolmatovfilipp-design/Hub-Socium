import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import { isApiMode } from '../lib/api'
import { isValidEmailOrPhone, isValidPassword } from '../utils/validation'

type Step = 'contact' | 'code' | 'password' | 'done'

export function PasswordReset() {
  const navigate = useNavigate()
  const requestReset = useStore((s) => s.requestReset)
  const confirmReset = useStore((s) => s.confirmReset)
  const demoCode = useStore((s) => s.resetCode)
  const [step, setStep] = useState<Step>('contact')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sendCode = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
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
    setStep('code')
  }

  const verifyCode = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (code.length !== 6) {
      setError('Введите 6-значный код')
      return
    }
    // In local demo without API, check against shown code.
    // In API mode the server validates on confirm — skip client mismatch.
    if (!isApiMode() && demoCode && code !== demoCode) {
      setError('Неверный код')
      return
    }
    setStep('password')
  }

  const savePassword = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!isValidPassword(password)) {
      setError('Пароль не менее 4 символов')
      return
    }
    setBusy(true)
    const res = await confirmReset(code, password)
    setBusy(false)
    if (!res.ok) {
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
            Введите email, телефон или имя пользователя. Без SMTP код придёт в ответе API (DEV).
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

      {step === 'code' && (
        <form onSubmit={verifyCode} className="mt-8 space-y-4">
          {demoCode ? (
            <div className="rounded-2xl border border-[color:var(--hub-app-border,rgba(255,255,255,0.1))] bg-[color:var(--hub-app-card,#111)] px-4 py-3 text-sm text-hub-silver">
              DEV-код: <span className="font-mono text-lg tracking-widest text-hub-text">{demoCode}</span>
            </div>
          ) : (
            <p className="text-sm text-hub-muted">
              Код отправлен{isApiMode() ? ' (проверьте почту/SMS или ответ API)' : ''}.
            </p>
          )}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            className="hub-field h-14 w-full rounded-2xl px-4 text-center text-xl tracking-[0.4em] text-hub-text"
            autoComplete="one-time-code"
          />
          {error && <p className="text-sm text-red-400/90">{error}</p>}
          <button type="submit" className="btn-liquid-glass">
            Подтвердить
          </button>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={(e) => void savePassword(e)} className="mt-8 space-y-4">
          <p className="text-sm text-hub-muted">Придумайте новый пароль</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Новый пароль"
            className="hub-field h-14 w-full rounded-2xl px-4 text-[16px] text-hub-text"
            autoComplete="new-password"
          />
          {error && <p className="text-sm text-red-400/90">{error}</p>}
          <button type="submit" disabled={busy} className="btn-liquid-glass">
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="mt-8 space-y-4">
          <p className="text-hub-silver">Пароль обновлён. Теперь можно войти.</p>
          <button type="button" onClick={() => navigate('/login')} className="btn-liquid-glass">
            К входу
          </button>
        </div>
      )}
    </div>
  )
}
