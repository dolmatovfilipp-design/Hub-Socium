import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
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

  const sendCode = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!isValidEmailOrPhone(contact) && contact.trim().length < 3) {
      setError('Укажите email или телефон')
      return
    }
    requestReset(contact)
    setStep('code')
  }

  const verifyCode = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (code.length !== 6) {
      setError('Введите 6-значный код')
      return
    }
    if (demoCode && code !== demoCode) {
      setError('Неверный код')
      return
    }
    setStep('password')
  }

  const savePassword = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!isValidPassword(password)) {
      setError('Пароль не менее 4 символов')
      return
    }
    const res = confirmReset(code, password)
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
        <form onSubmit={sendCode} className="mt-8 space-y-4">
          <p className="text-sm text-hub-muted">Введите email или телефон — пришлём код (демо).</p>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="email@… или +7…"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text"
          />
          {error && <p className="text-sm text-red-400/90">{error}</p>}
          <button type="submit" className="btn-primary">
            Отправить код
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyCode} className="mt-8 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-hub-silver">
            Демо-код: <span className="font-mono text-lg tracking-widest text-hub-text">{demoCode}</span>
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-center text-xl tracking-[0.4em] text-hub-text"
          />
          {error && <p className="text-sm text-red-400/90">{error}</p>}
          <button type="submit" className="btn-primary">
            Подтвердить
          </button>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={savePassword} className="mt-8 space-y-4">
          <p className="text-sm text-hub-muted">Придумайте новый пароль</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Новый пароль"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text"
          />
          {error && <p className="text-sm text-red-400/90">{error}</p>}
          <button type="submit" className="btn-primary">
            Сохранить
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="mt-8 space-y-4">
          <p className="text-hub-silver">Пароль обновлён. Теперь можно войти.</p>
          <button type="button" onClick={() => navigate('/login')} className="btn-primary">
            К входу
          </button>
        </div>
      )}

      <style>{`
        .btn-primary {
          display: flex;
          height: 3.5rem;
          width: 100%;
          align-items: center;
          justify-content: center;
          border-radius: 1rem;
          background: linear-gradient(to bottom, #4a4a54, #2c2c32);
          border: 1px solid rgba(255,255,255,0.1);
          font-size: 1rem;
          font-weight: 600;
          color: #f2f2f4;
        }
      `}</style>
    </div>
  )
}
