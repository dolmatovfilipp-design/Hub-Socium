import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import {
  isValidEmailOrPhone,
  isValidPassword,
  isValidUsername,
} from '../utils/validation'

export function Register() {
  const navigate = useNavigate()
  const register = useStore((s) => s.register)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [contact, setContact] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (name.trim().length < 2) {
      setError('Укажите имя')
      return
    }
    if (!isValidUsername(username)) {
      setError('Имя пользователя: 2–24 символа')
      return
    }
    if (!isValidEmailOrPhone(contact)) {
      setError('Укажите email или телефон')
      return
    }
    if (!isValidPassword(password)) {
      setError('Пароль не менее 4 символов')
      return
    }
    const res = await register({ name, username, contact, password })
    if (!res.ok) {
      setError(res.error ?? 'Ошибка')
      return
    }
    navigate('/app', { replace: true })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 safe-top animate-fade-in no-scrollbar">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mt-2 flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
        aria-label="Назад"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h1 className="mt-4 text-2xl font-bold text-hub-text">Регистрация</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4 pb-10">
        <Field label="Имя" value={name} onChange={setName} placeholder="Ваше имя" />
        <Field label="Имя пользователя" value={username} onChange={setUsername} placeholder="username" />
        <Field label="Email или телефон" value={contact} onChange={setContact} placeholder="email@… или +7…" />
        <Field label="Пароль" value={password} onChange={setPassword} placeholder="••••••••" type="password" />
        {error && <p className="text-sm text-red-400/90">{error}</p>}
        <button
          type="submit"
          className="flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#4a4a54] to-[#2c2c32] text-base font-semibold text-hub-text border border-white/10"
        >
          Создать аккаунт
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-hub-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30"
      />
    </div>
  )
}
