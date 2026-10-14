import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { apiMe, apiUploadMedia, apiPatchProfileCard, apiListWidgets, apiUpsertWidget, isApiMode } from '../lib/api'
import { useNavMotion } from '../components/NavMotion'
import { SegmentedControl } from '../components/SegmentedControl'
import { FormSelect } from '../components/FormSelect'
import {
  COUNTRIES,
  citiesForCountry,
  type CountryCode,
} from '../data/ru-cities'

const LOCAL_DATA_URL_MAX = 100 * 1024
const MONTHS = [
  { value: '01', label: 'Января' },
  { value: '02', label: 'Февраля' },
  { value: '03', label: 'Марта' },
  { value: '04', label: 'Апреля' },
  { value: '05', label: 'Мая' },
  { value: '06', label: 'Июня' },
  { value: '07', label: 'Июля' },
  { value: '08', label: 'Августа' },
  { value: '09', label: 'Сентября' },
  { value: '10', label: 'Октября' },
  { value: '11', label: 'Ноября' },
  { value: '12', label: 'Декабря' },
]

type GenderOpt = '' | 'male' | 'female'

function daysInMonth(month: string, year: string): number {
  const m = Number(month)
  const y = Number(year) || 2000
  if (!m) return 31
  return new Date(y, m, 0).getDate()
}

function splitDate(iso: string): { day: string; month: string; year: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return { day: '', month: '', year: '' }
  return { year: m[1], month: m[2], day: m[3] }
}

export function EditProfile() {
  const { motionClass, dismiss } = useNavMotion('sheet')
  const currentUserId = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  const user = currentUserId ? users.find((u) => u.id === currentUserId) : undefined
  const upsertCurrentUser = useStore((s) => s.upsertCurrentUser)
  const updateProfile = useStore((s) => s.updateProfile)
  const showToast = useStore((s) => s.showToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [avatar, setAvatar] = useState(user?.avatar)
  const initialBirth = splitDate(user?.birthDate ?? '')
  const [birthDay, setBirthDay] = useState(initialBirth.day)
  const [birthMonth, setBirthMonth] = useState(initialBirth.month)
  const [birthYear, setBirthYear] = useState(initialBirth.year)
  const [gender, setGender] = useState<GenderOpt>((user?.gender as GenderOpt) ?? '')
  const [country, setCountry] = useState<CountryCode | ''>(
    user?.country === 'RU' || user?.country === 'BY' ? user.country : '',
  )
  const [city, setCity] = useState(user?.city ?? '')
  const [channel, setChannel] = useState<'email' | 'phone'>(() =>
    user?.phone && !(user?.email && user.email.includes('@')) ? 'phone' : 'email',
  )
  const [contact, setContact] = useState(() => {
    if (user?.phone && !(user?.email && user.email.includes('@'))) return user.phone
    return user?.email ?? ''
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [about, setAbout] = useState('')
  const [services, setServices] = useState('')
  const [linksText, setLinksText] = useState('')
  const [showCity, setShowCity] = useState(true)
  const [showBirth, setShowBirth] = useState(false)
  const [showGender, setShowGender] = useState(false)
  const [showCountry, setShowCountry] = useState(true)
  const [showContact, setShowContact] = useState(false)
  const [priceText, setPriceText] = useState('')
  const [portfolioText, setPortfolioText] = useState('')
  const [widgetIds, setWidgetIds] = useState<{ price?: string; portfolio?: string }>({})

  useEffect(() => {
    if (user || !isApiMode()) return
    void apiMe()
      .then((me) => {
        upsertCurrentUser(me)
        setName(me.display_name || me.username)
        setUsername(me.username)
        setBio(me.bio ?? '')
        setAvatar(me.avatar_url || undefined)
        const bd = splitDate(me.birth_date ?? '')
        setBirthDay(bd.day)
        setBirthMonth(bd.month)
        setBirthYear(bd.year)
        setGender(me.gender === 'male' || me.gender === 'female' ? me.gender : '')
        setCountry(me.country === 'RU' || me.country === 'BY' ? me.country : '')
        setCity(me.city ?? '')
        const usePhone = !!(me.phone && !(me.email && String(me.email).includes('@')))
        setChannel(usePhone ? 'phone' : 'email')
        setContact(usePhone ? (me.phone ?? '') : (me.email ?? ''))
        setIsPrivate(!!me.is_private)
        setAbout((me as any).about ?? '')
        setServices((me as any).services ?? '')
        const links = (me as any).links
        if (Array.isArray(links)) {
          setLinksText(links.map((l: any) => (typeof l === 'string' ? l : l?.url || '')).filter(Boolean).join('\n'))
        }
        setShowCity((me as any).show_city !== false)
        setShowBirth(!!(me as any).show_birth_date)
        setShowGender(!!(me as any).show_gender)
        setShowCountry((me as any).show_country !== false)
        setShowContact(!!(me as any).show_contact)
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Профиль недоступен'))
  }, [user, upsertCurrentUser, showToast])

  useEffect(() => {
    if (!user) return
    setName(user.name)
    setUsername(user.username)
    setBio(user.bio ?? '')
    setAvatar(user.avatar)
    const bd = splitDate(user.birthDate ?? '')
    setBirthDay(bd.day)
    setBirthMonth(bd.month)
    setBirthYear(bd.year)
    setGender((user.gender as GenderOpt) ?? '')
    setCountry(user.country === 'RU' || user.country === 'BY' ? user.country : '')
    setCity(user.city ?? '')
    const usePhone = !!(user.phone && !(user.email && user.email.includes('@')))
    setChannel(usePhone ? 'phone' : 'email')
    setContact(usePhone ? (user.phone ?? '') : (user.email ?? ''))
  }, [user?.id])

  const years = useMemo(() => {
    const now = new Date().getFullYear()
    const list: string[] = []
    for (let y = now - 14; y >= now - 100; y--) list.push(String(y))
    return list
  }, [])

  const dayOptions = useMemo(() => {
    const n = daysInMonth(birthMonth, birthYear)
    return Array.from({ length: n }, (_, i) => {
      const d = String(i + 1).padStart(2, '0')
      return { value: d, label: String(i + 1) }
    })
  }, [birthMonth, birthYear])

  const cityOptions = useMemo(() => citiesForCountry(country), [country])

  const birthDate =
    birthDay && birthMonth && birthYear ? `${birthYear}-${birthMonth}-${birthDay}` : ''

  useEffect(() => {
    if (!isApiMode() || !currentUserId) return
    void apiListWidgets(currentUserId)
      .then((d) => {
        const price = (d.items ?? []).find((w: any) => w.kind === 'price_list')
        const port = (d.items ?? []).find((w: any) => w.kind === 'portfolio')
        setWidgetIds({ price: price?.id, portfolio: port?.id })
        if (price && Array.isArray(price.payload)) {
          setPriceText(
            price.payload
              .map((r: any) => (typeof r === 'string' ? r : `${r.label || ''}|${r.price ?? ''}`))
              .join('\n'),
          )
        }
        if (port && Array.isArray(port.payload)) {
          setPortfolioText(
            port.payload
              .map((r: any) => (typeof r === 'string' ? r : r.url || r.label || ''))
              .join('\n'),
          )
        }
      })
      .catch(() => {})
  }, [currentUserId])

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-sm text-[#777]">
        Загрузка профиля…
      </div>
    )
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Нужен файл изображения (jpeg/png/webp/gif)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Максимум 2 МБ')
      return
    }

    if (isApiMode()) {
      setUploading(true)
      void apiUploadMedia(file)
        .then((media) => {
          setAvatar(media.url)
          showToast('Фото загружено')
        })
        .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка загрузки'))
        .finally(() => setUploading(false))
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      if (dataUrl.length > LOCAL_DATA_URL_MAX) {
        showToast('Фото слишком большое для локального режима (~100 КБ)')
        return
      }
      setAvatar(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (city && !cityOptions.includes(city)) {
      showToast('Выберите город из списка')
      return
    }
    setSaving(true)
    const isEmail = channel === 'email'
    const res = await updateProfile({
      name: name.trim(),
      username: username.trim(),
      bio: bio.trim(),
      avatar,
      birthDate: birthDate.trim(),
      gender,
      country: country || '',
      city: city || '',
      email: isEmail ? contact.trim() : undefined,
      phone: isEmail ? undefined : contact.trim(),
      isPrivate,
    })
    setSaving(false)
    if (!res.ok) {
      showToast(res.error ?? 'Ошибка сохранения')
      return
    }
    if (isApiMode()) {
      try {
        const links = linksText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((url) => ({ url }))
        await apiPatchProfileCard({
          about: about.trim(),
          services: services.trim(),
          links,
          show_city: showCity,
          show_birth_date: showBirth,
          show_gender: showGender,
          show_country: showCountry,
          show_contact: showContact,
        })
        const pricePayload = priceText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const [label, price] = line.split('|').map((x) => x.trim())
            return price ? { label, price } : { label: line }
          })
        const portPayload = portfolioText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((url) => ({ url }))
        if (pricePayload.length) {
          await apiUpsertWidget({
            id: widgetIds.price,
            kind: 'price_list',
            title: 'Прайс',
            payload: pricePayload,
          })
        }
        if (portPayload.length) {
          await apiUpsertWidget({
            id: widgetIds.portfolio,
            kind: 'portfolio',
            title: 'Портфолио',
            payload: portPayload,
          })
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Карточка не сохранилась')
        setSaving(false)
        return
      }
    }
    showToast('Профиль сохранён')
    dismiss('/app/profile')
  }

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="hub-screen-header relative flex shrink-0 items-center justify-center px-3 pb-2">
        <button
          type="button"
          onClick={() => dismiss('/app/profile')}
          className="hub-circle-btn absolute left-3 text-[15px]"
          aria-label="Отмена"
        >
          ✕
        </button>
        <h1 className="text-[17px] font-bold text-hub-text">Редактировать</h1>
      </header>
      <form
        onSubmit={save}
        className="flex min-h-0 flex-1 flex-col"
      >
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-2 pt-2">
        <div className="flex flex-col items-center gap-3">
          <Avatar name={name || user.name} id={user.id} src={avatar} size={76} />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-[#2c2c2e] px-4 py-2 text-[14px] text-white disabled:opacity-60"
            >
              {uploading ? 'Загрузка…' : 'Изменить фото'}
            </button>
            {avatar && (
              <button
                type="button"
                onClick={() => setAvatar(undefined)}
                className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-2 text-sm text-hub-muted"
              >
                <Trash2 className="h-3.5 w-3.5" /> Удалить
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>

        <div className="mt-4 space-y-3">
          <Field label="Имя" value={name} onChange={setName} />
          <Field label="Имя пользователя" value={username} onChange={setUsername} />
          <div>
            <label className="mb-1.5 block text-[13px] text-[#8e8e93]">О себе</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              className="min-h-[72px] w-full resize-none rounded-2xl border-0 bg-[#2c2c2e] px-4 py-3 text-[16px] text-white outline-none"
            />
          </div>

          <div>
            <p className="mb-1.5 text-[13px] text-[#8e8e93]">Дата рождения</p>
            <div className="grid grid-cols-3 gap-2">
              <FormSelect
                ariaLabel="День"
                value={birthDay}
                onChange={setBirthDay}
                options={dayOptions}
                placeholder="День"
                filled
              />
              <FormSelect
                ariaLabel="Месяц"
                value={birthMonth}
                onChange={(v) => {
                  setBirthMonth(v)
                  const max = daysInMonth(v, birthYear)
                  if (birthDay && Number(birthDay) > max) setBirthDay(String(max).padStart(2, '0'))
                }}
                options={MONTHS}
                placeholder="Месяц"
                filled
              />
              <FormSelect
                ariaLabel="Год"
                value={birthYear}
                onChange={(v) => {
                  setBirthYear(v)
                  const max = daysInMonth(birthMonth, v)
                  if (birthDay && Number(birthDay) > max) setBirthDay(String(max).padStart(2, '0'))
                }}
                options={years}
                placeholder="Год"
                filled
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] text-[#8e8e93]">Пол</p>
            <SegmentedControl
              ariaLabel="Пол"
              value={gender || 'male'}
              onChange={(v) => setGender(v)}
              options={[
                { value: 'male' as const, label: 'Мужской' },
                { value: 'female' as const, label: 'Женский' },
              ]}
            />
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
            filled
          />

          <FormSelect
            label="Город"
            value={city}
            onChange={setCity}
            options={cityOptions}
            placeholder={country ? 'Город' : 'Сначала страна'}
            disabled={!country}
            filled
          />

          <div>
            <p className="mb-1.5 text-[13px] text-[#8e8e93]">Контакт</p>
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
            <label className="mb-1.5 block text-[13px] text-[#8e8e93]">
              {channel === 'email' ? 'Email' : 'Телефон'}
            </label>
            <input
              type={channel === 'email' ? 'email' : 'tel'}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={channel === 'email' ? 'email@…' : '+7… / +375…'}
              className="h-14 w-full rounded-2xl border-0 bg-[#2c2c2e] px-4 text-[16px] text-white outline-none"
            />
            <p className="mt-2 text-[12px] leading-snug text-[#8e8e93]">
              {channel === 'email'
                ? 'Новая почта не подтверждена, пока вы не введёте код в настройках.'
                : 'Телефон не подтверждается: SMS не подключены.'}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div>
            <p className="text-[15px] font-semibold text-white">Закрытый профиль</p>
            <p className="mt-0.5 text-[12px] text-[#8e8e93]">Подписка только по запросу</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            onClick={() => setIsPrivate((v) => !v)}
            className={`relative h-7 w-12 rounded-full transition ${isPrivate ? 'bg-white' : 'bg-[#3a3a3c]'}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full transition ${
                isPrivate ? 'left-5 bg-black' : 'left-0.5 bg-white'
              }`}
            />
          </button>
        </div>


        <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[15px] font-semibold text-white">Карточка профиля</p>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} placeholder="О себе / услуги подробно"
            rows={3} className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none" />
          <textarea value={services} onChange={(e) => setServices(e.target.value)} placeholder="Услуги (через запятую или с новой строки)"
            rows={2} className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none" />
          <textarea value={linksText} onChange={(e) => setLinksText(e.target.value)} placeholder="Ссылки (по одной на строку)"
            rows={2} className="w-full rounded-xl bg-[#1c1c1e] px-3 py-2 text-[14px] text-white outline-none" />
          <label className="flex items-center justify-between text-[14px] text-white">
            Публиковать пол
            <input type="checkbox" checked={showGender} onChange={(e) => setShowGender(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-[14px] text-white">
            Публиковать дату рождения
            <input type="checkbox" checked={showBirth} onChange={(e) => setShowBirth(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-[14px] text-white">
            Публиковать страну
            <input type="checkbox" checked={showCountry} onChange={(e) => setShowCountry(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-[14px] text-white">
            Публиковать город
            <input type="checkbox" checked={showCity} onChange={(e) => setShowCity(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-[14px] text-white">
            Публиковать email/телефон
            <input type="checkbox" checked={showContact} onChange={(e) => setShowContact(e.target.checked)} />
          </label>
        </div>


        <div className="mt-4 space-y-3 hub-card p-4">
          <p className="text-[15px] font-semibold text-white">Виджеты (S19)</p>
          <p className="text-[12px] text-[#8e8e93]">До 2 виджетов без verify. Прайс: «услуга|цена» по строкам. Портфолио: URL по строкам.</p>
          <textarea value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="Консультация|3000"
            rows={3} className="hub-input" />
          <textarea value={portfolioText} onChange={(e) => setPortfolioText(e.target.value)} placeholder="https://…"
            rows={2} className="hub-input" />
        </div>

      </div>
        <div className="shrink-0 bg-black px-4 pt-2 pb-[max(16px,var(--hub-safe-bottom))]">
          <button
            type="submit"
            disabled={saving || uploading}
            className="h-12 w-full rounded-2xl bg-[#3a3a3c] text-[16px] font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] text-[#8e8e93]">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-14 w-full rounded-2xl border-0 bg-[#2c2c2e] px-4 text-[16px] text-white outline-none"
      />
    </div>
  )
}
