import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import { isValidEmailOrPhone, isValidPassword } from '../utils/validation'

export function Login() {
  const navigate = useNavigate()
  const login = useStore((s) => s.login)
  const [contact, setContact] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!isValidEmailOrPhone(contact) && contact.trim().length < 3) {
      setError('Введите телефон, email или имя пользователя')
      return
    }
    if (!isValidPassword(password)) {
      setError('Пароль не менее 4 символов')
      return
    }
    const res = await login(contact, password)
    if (!res.ok) {
      setError(res.error ?? 'Ошибка входа')
      return
    }
    navigate('/app', { replace: true })
  }

  return (
    <div className="flex h-full flex-col px-6 safe-top animate-fade-in">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mt-2 flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
        aria-label="Назад"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h1 className="mt-4 text-2xl font-bold text-hub-text">Вход</h1>
      <p className="mt-2 text-sm text-hub-muted">
        Демо: любые правдоподобные данные работают, или аккаунт{' '}
        <span className="text-hub-silver">филипп / demo</span>
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-hub-muted">Телефон или email</label>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="+7… или email"
            autoComplete="username"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-hub-muted">Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30"
          />
        </div>
        {error && <p className="text-sm text-red-400/90">{error}</p>}
        <button type="submit" className="btn-liquid-glass">
          Войти
        </button>
      </form>
      <Link to="/reset" className="mt-5 text-center text-sm text-hub-silver">
        Забыли пароль?
      </Link>
    </div>
  )
}
