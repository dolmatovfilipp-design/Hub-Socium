import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import { apiConfirmEmailVerify, apiMe, apiRequestEmailVerify } from '../lib/api'
import { trackEvent } from '../lib/telemetry'
import { isValidEmailOrPhone, isValidPassword } from '../utils/validation'
import { PasswordInput } from '../components/PasswordInput'
import { SegmentedControl } from '../components/SegmentedControl'
import { FormSelect } from '../components/FormSelect'
import {
  COUNTRIES,
  citiesForCountry,
  type CountryCode,
} from '../data/ru-cities'

const INVITE_STORAGE_KEY = 'hub_invite_code'
const REFERRER_STORAGE_KEY = 'hub_referrer'
const MONTHS = [
  { value: '01', label: 'января' },
  { value: '02', label: 'февраля' },
  { value: '03', label: 'марта' },
  { value: '04', label: 'апреля' },
  { value: '05', label: 'мая' },
  { value: '06', label: 'июня' },
  { value: '07', label: 'июля' },
  { value: '08', label: 'августа' },
  { value: '09', label: 'сентября' },
  { value: '10', label: 'октября' },
  { value: '11', label: 'ноября' },
  { value: '12', label: 'декабря' },
]

function daysInMonth(month: string, year: string): number {
  const m = Number(month)
  const y = Number(year) || 2000
  if (!m) return 31
  return new Date(y, m, 0).getDate()
}

function readStoredInvite(): string {
  try {
    return sessionStorage.getItem(INVITE_STORAGE_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function Register() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const register = useStore((s) => s.register)
  const showToast = useStore((s) => s.showToast)
  const getCurrentUser = useStore((s) => s.getCurrentUser)
  const [inviteReady, setInviteReady] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [gender, setGender] = useState<'male' | 'female'>('male')
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [country, setCountry] = useState<CountryCode | ''>('RU')
  const [city, setCity] = useState('')
  const [channel, setChannel] = useState<'email' | 'phone'>('email')
  const [contact, setContact] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const codeFromUrl = (search.get('code') || search.get('invite') || '').trim()
    const refFromUrl = (search.get('ref') || '').trim()
    try {
      if (codeFromUrl) {
        sessionStorage.setItem(INVITE_STORAGE_KEY, codeFromUrl.toUpperCase())
      }
      if (refFromUrl) {
        sessionStorage.setItem(REFERRER_STORAGE_KEY, refFromUrl)
      }
    } catch {
      /* ignore */
    }
    setInviteReady(Boolean(codeFromUrl || readStoredInvite()))
  }, [search])

  useEffect(() => {
    if (inviteReady) trackEvent('register_open')
  }, [inviteReady])

  const years = useMemo(() => {
    const now = new Date().getFullYear()
    const list: string[] = []
    for (let y = now - 14; y >= now - 100; y--) list.push(String(y))
    return list
  }, [])

  const dayOptions = useMemo(() => {
    const n = daysInMonth(month, year)
    return Array.from({ length: n }, (_, i) => {
      const d = String(i + 1).padStart(2, '0')
      return { value: d, label: String(i + 1) }
    })
  }, [month, year])

  const cityOptions = useMemo(() => citiesForCountry(country), [country])

  const birthDate =
    day && month && year ? `${year}-${month}-${day}` : ''

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!readStoredInvite()) {
      setError('Регистрация только по приглашению')
      setInviteReady(false)
      return
    }
    if (name.trim().length < 2) {
      setError('Укажите имя')
      return
    }
    if (!birthDate) {
      setError('Укажите дату рождения')
      return
    }
    if (!country) {
      setError('Выберите страну')
      return
    }
    if (!city) {
      setError('Выберите город')
      return
    }
    if (!isValidEmailOrPhone(contact)) {
      setError(channel === 'email' ? 'Укажите email' : 'Укажите телефон')
      return
    }
    if (!isValidPassword(password)) {
      setError('Пароль не менее 4 символов')
      return
    }
    trackEvent('register_submit')
    const res = await register({
      name,
      contact: contact.trim(),
      password,
      gender,
      birthDate,
      country,
      city,
    })
    if (!res.ok) {
      setError(res.error ?? 'Ошибка')
      return
    }
    const me = getCurrentUser()
    if (res.needsEmailCode) {
      showToast(me?.username ? `Аккаунт создан · @${me.username}` : 'Аккаунт создан')
      navigate('/verify-email', { replace: true })
      return
    }
    if (me?.username) {
      showToast(`Аккаунт создан · @${me.username}. Телефон не подтверждён.`)
    }
    navigate('/app', { replace: true })
  }

  if (!inviteReady) {
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
        <p className="mt-4 text-[15px] leading-relaxed text-hub-muted">
          Регистрация только по приглашению. Попросите ссылку у друга, который уже в Get Hub.
        </p>
        <div className="mt-8 space-y-3">
          <Link to="/login" className="btn-liquid-glass">
            Войти
          </Link>
          <Link to="/" className="btn-auth-pill">
            Лист ожидания / код
          </Link>
        </div>
      </div>
    )
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
      <p className="mt-2 text-sm text-hub-muted">
        Имя пользователя создастся автоматически из вашего имени
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4 pb-10">
        <Field label="Имя и фамилия" value={name} onChange={setName} placeholder="Анна Котова" />

        <div>
          <p className="mb-1.5 text-sm text-hub-muted">Пол</p>
          <SegmentedControl
            ariaLabel="Пол"
            value={gender}
            onChange={setGender}
            options={[
              { value: 'male' as const, label: 'Мужской' },
              { value: 'female' as const, label: 'Женский' },
            ]}
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm text-hub-muted">Дата рождения</p>
          <div className="grid grid-cols-3 gap-2">
            <FormSelect
              ariaLabel="День"
              value={day}
              onChange={(v) => {
                setDay(v)
              }}
              options={dayOptions}
              placeholder="День"
            />
            <FormSelect
              ariaLabel="Месяц"
              value={month}
              onChange={(v) => {
                setMonth(v)
                const max = daysInMonth(v, year)
                if (day && Number(day) > max) setDay(String(max).padStart(2, '0'))
              }}
              options={MONTHS}
              placeholder="Месяц"
            />
            <FormSelect
              ariaLabel="Год"
              value={year}
              onChange={(v) => {
                setYear(v)
                const max = daysInMonth(month, v)
                if (day && Number(day) > max) setDay(String(max).padStart(2, '0'))
              }}
              options={years}
              placeholder="Год"
            />
          </div>
        </div>

        <FormSelect
          label="Страна"
          value={country}
          onChange={(v) => {
            setCountry((v as CountryCode) || '')
            setCity('')
          }}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))}
          placeholder="Страна"
        />

        <FormSelect
          label="Город"
          value={city}
          onChange={setCity}
          options={cityOptions}
          placeholder={country ? 'Город' : 'Сначала страна'}
          disabled={!country}
        />

        <div>
          <p className="mb-1.5 text-sm text-hub-muted">Контакт</p>
          <SegmentedControl
            ariaLabel="Канал связи"
            value={channel}
            onChange={(v) => {
              setChannel(v)
              setContact('')
            }}
            options={[
              { value: 'email' as const, label: 'Email' },
              { value: 'phone' as const, label: 'Телефон' },
            ]}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-hub-muted">
            {channel === 'email' ? 'Email' : 'Телефон'}
          </label>
          <input
            type={channel === 'email' ? 'email' : 'tel'}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={channel === 'email' ? 'email@…' : '+7… / +375…'}
            data-testid="register-contact"
            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30"
          />
          <p className="mt-2 text-[13px] leading-snug text-hub-muted">
            {channel === 'email'
              ? 'После регистрации придёт код на почту. Он действует 10 минут.'
              : 'Телефон не подтверждается: SMS не подключены. Писать и публиковать можно после подтверждения email.'}
          </p>
        </div>

        <Field
          label="Пароль"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          type="password"
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-red-400/90">{error}</p>}
        <button type="submit" data-testid="register-submit" className="btn-liquid-glass">
          Создать аккаунт
        </button>
      </form>
    </div>
  )
}

export function EmailVerify() {
  const navigate = useNavigate()
  const showToast = useStore((s) => s.showToast)
  const upsertCurrentUser = useStore((s) => s.upsertCurrentUser)
  const email = useStore((s) => s.users.find((u) => u.id === s.currentUserId)?.email ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(60)

  useEffect(() => {
    trackEvent('register_code')
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  const confirmCode = () => {
    setError('')
    if (code.length !== 6) {
      setError('Введите 6 цифр из письма')
      return
    }
    setBusy(true)
    void apiConfirmEmailVerify(code)
      .then(async () => {
        try {
          upsertCurrentUser(await apiMe())
        } catch {
          /* settings can reload the profile */
        }
        try { sessionStorage.removeItem('hub_pending_email_verify') } catch { /* ignore */ }
        showToast('Почта подтверждена')
        trackEvent('register_done')
        navigate('/app', { replace: true })
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Неверный код'))
      .finally(() => setBusy(false))
  }

  const resendCode = () => {
    if (resendIn > 0 || busy) return
    setError('')
    setBusy(true)
    void apiRequestEmailVerify()
      .then((res) => {
        setResendIn(60)
        showToast(res.message || 'Код отправлен на почту')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось отправить код'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 safe-top animate-fade-in no-scrollbar">
      <h1 className="mt-8 text-2xl font-bold text-hub-text">Код из письма</h1>
      <p className="mt-2 text-sm text-hub-muted">
        Мы отправили 6 цифр{email ? ` на ${email}` : ''}. Код действует 10 минут. Без подтверждения нельзя писать и публиковать.
      </p>
      <div className="mt-8 space-y-4" data-testid="register-code">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Код"
          inputMode="numeric"
          autoComplete="one-time-code"
          data-testid="verify-code"
          className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-center text-xl tracking-[0.4em] text-hub-text"
        />
        {error ? <p className="text-sm text-red-400/90">{error}</p> : null}
        <button type="button" data-testid="verify-submit" disabled={busy} onClick={confirmCode} className="btn-liquid-glass disabled:opacity-50">
          Подтвердить
        </button>
        <button type="button" data-testid="verify-resend" disabled={busy || resendIn > 0} onClick={resendCode} className="btn-auth-pill disabled:opacity-50">
          {resendIn > 0 ? `Отправить снова через ${resendIn} с` : 'Отправить код снова'}
        </button>
        <button type="button" onClick={() => {
          try { sessionStorage.removeItem('hub_pending_email_verify') } catch { /* ignore */ }
          navigate('/app', { replace: true })
        }} className="w-full py-2 text-sm text-hub-muted">
          Позже
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
  autoComplete?: string
}) {
  const id = useId()
  const className =
    'h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30'
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-hub-muted">
        {label}
      </label>
      {type === 'password' ? (
        <PasswordInput
          id={id}
          fieldLabel={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete ?? 'new-password'}
          className={className}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={className}
        />
      )}
    </div>
  )
}
