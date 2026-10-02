import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import { isValidEmailOrPhone, isValidPassword } from '../utils/validation'
import { SegmentedControl } from '../components/SegmentedControl'
import { FormSelect } from '../components/FormSelect'
import {
  COUNTRIES,
  citiesForCountry,
  type CountryCode,
} from '../data/ru-cities'

const DEMO_CODE = '000000'
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

export function Register() {
  const navigate = useNavigate()
  const register = useStore((s) => s.register)
  const showToast = useStore((s) => s.showToast)
  const getCurrentUser = useStore((s) => s.getCurrentUser)
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
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [demoHint, setDemoHint] = useState('')
  const [error, setError] = useState('')

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

  const sendCode = () => {
    setError('')
    if (!isValidEmailOrPhone(contact)) {
      setError(channel === 'email' ? 'Укажите email' : 'Укажите телефон')
      return
    }
    if (channel === 'email' && !contact.includes('@')) {
      setError('Укажите корректный email')
      return
    }
    if (channel === 'phone' && contact.includes('@')) {
      setError('Укажите телефон')
      return
    }
    setCodeSent(true)
    setVerified(false)
    setCode('')
    setDemoHint(DEMO_CODE)
    showToast('Демо-код 000000 — без SMS/email в beta')
  }

  const confirmCode = () => {
    setError('')
    if (code !== DEMO_CODE) {
      setError('Неверный код')
      setVerified(false)
      return
    }
    setVerified(true)
    showToast('Контакт подтверждён')
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
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
    if (!verified) {
      setError('Подтвердите контакт кодом')
      return
    }
    if (!isValidPassword(password)) {
      setError('Пароль не менее 4 символов')
      return
    }
    const res = await register({
      name,
      contact: contact.trim(),
      password,
      gender,
      birthDate,
      country,
      city,
      contactVerified: true,
    })
    if (!res.ok) {
      setError(res.error ?? 'Ошибка')
      return
    }
    const me = getCurrentUser()
    if (me?.username) {
      showToast(`Аккаунт создан · @${me.username}`)
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
              setCodeSent(false)
              setCode('')
              setVerified(false)
              setDemoHint('')
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
          <div className="flex gap-2">
            <input
              type={channel === 'email' ? 'email' : 'tel'}
              value={contact}
              onChange={(e) => {
                setContact(e.target.value)
                setVerified(false)
                setCodeSent(false)
              }}
              placeholder={channel === 'email' ? 'email@…' : '+7… / +375…'}
              className="h-14 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50 focus:border-hub-silver/30"
            />
            <button
              type="button"
              onClick={sendCode}
              className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.06] px-3 text-[13px] font-semibold text-hub-text"
            >
              Код
            </button>
          </div>
        </div>

        {codeSent && (
          <div className="space-y-2">
            {demoHint && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
                Beta: SMS и email не отправляются. Демо-код{' '}
                <span className="font-mono text-lg tracking-widest text-white">{demoHint}</span>
                {' '}(только для локальной проверки).
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  setVerified(false)
                }}
                placeholder="000000"
                inputMode="numeric"
                className="h-14 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-center text-xl tracking-[0.4em] text-hub-text"
              />
              <button
                type="button"
                onClick={confirmCode}
                className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.06] px-3 text-[13px] font-semibold text-hub-text"
              >
                ОК
              </button>
            </div>
            {verified && (
              <p className="text-sm text-emerald-400/90">Контакт отмечен (демо, без реальной доставки)</p>
            )}
          </div>
        )}

        <Field
          label="Пароль"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          type="password"
        />
        {error && <p className="text-sm text-red-400/90">{error}</p>}
        <button type="submit" className="btn-liquid-glass">
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
