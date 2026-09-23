import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { apiMe, apiUploadMedia, apiPatchProfileCard, apiListWidgets, apiUpsertWidget, isApiMode } from '../lib/api'
import { useNavMotion } from '../components/NavMotion'
import { RU_CITIES as ruCities } from '../data/ru-cities'

const LOCAL_DATA_URL_MAX = 100 * 1024

type GenderOpt = '' | 'male' | 'female'

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
  const [birthDate, setBirthDate] = useState(user?.birthDate ?? '')
  const [gender, setGender] = useState<GenderOpt>((user?.gender as GenderOpt) ?? '')
  const [cityQuery, setCityQuery] = useState(user?.city ?? '')
  const [cityOpen, setCityOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [about, setAbout] = useState('')
  const [services, setServices] = useState('')
  const [linksText, setLinksText] = useState('')
  const [showCity, setShowCity] = useState(true)
  const [showBirth, setShowBirth] = useState(false)
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
        setBirthDate(me.birth_date ?? '')
        setGender(me.gender === 'male' || me.gender === 'female' ? me.gender : '')
        setCityQuery(me.city ?? '')
        setIsPrivate(!!me.is_private)
        setAbout((me as any).about ?? '')
        setServices((me as any).services ?? '')
        const links = (me as any).links
        if (Array.isArray(links)) {
          setLinksText(links.map((l: any) => (typeof l === 'string' ? l : l?.url || '')).filter(Boolean).join('\n'))
        }
        setShowCity((me as any).show_city !== false)
        setShowBirth(!!(me as any).show_birth_date)
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Профиль недоступен'))
  }, [user, upsertCurrentUser, showToast])

  useEffect(() => {
    if (!user) return
    setName(user.name)
    setUsername(user.username)
    setBio(user.bio ?? '')
    setAvatar(user.avatar)
    setBirthDate(user.birthDate ?? '')
    setGender((user.gender as GenderOpt) ?? '')
    setCityQuery(user.city ?? '')
  }, [user?.id])

  const citySuggestions = useMemo(() => {
    const q = cityQuery.trim().toLowerCase()
    if (!q) return ruCities.slice(0, 12)
    return ruCities.filter((c) => c.toLowerCase().includes(q)).slice(0, 16)
  }, [cityQuery])

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

  const pickCity = (c: string) => {
    setCityQuery(c)
    setCityOpen(false)
  }


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

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedCity = cityQuery.trim()
    const normalized =
      trimmedCity &&
      ruCities.find((c) => c.toLowerCase() === trimmedCity.toLowerCase())
    if (trimmedCity && !normalized) {
      showToast('Выберите город из списка РФ')
      return
    }
    setSaving(true)
    const res = await updateProfile({
      name: name.trim(),
      username: username.trim(),
      bio: bio.trim(),
      avatar,
      birthDate: birthDate.trim(),
      gender,
      city: normalized ?? '',
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
      <header className="safe-top flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 pb-2.5 pt-2">
        <button
          type="button"
          onClick={() => dismiss('/app/profile')}
          className="pressable min-h-[40px] text-[16px] font-medium text-white"
        >
          Отмена
        </button>
        <h1 className="text-[16px] font-bold text-white">Редактировать</h1>
        <span className="min-w-[64px]" />
      </header>
      <form
        onSubmit={save}
        className="no-scrollbar flex-1 overflow-y-auto px-4 py-6 scroll-pad-safe"
      >
        <div className="flex flex-col items-center gap-3">
          <Avatar name={name || user.name} id={user.id} src={avatar} size={88} />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-hub-silver disabled:opacity-60"
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

        <div className="mt-8 space-y-4">
          <Field label="Имя" value={name} onChange={setName} />
          <Field label="Имя пользователя" value={username} onChange={setUsername} />
          <div>
            <label className="mb-1.5 block text-sm text-hub-muted">О себе</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[16px] text-hub-text"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-hub-muted">Дата рождения</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text"
            />
          </div>

          <div>
            <p className="mb-1.5 text-sm text-hub-muted">Пол</p>
            <div className="flex gap-2">
              {(
                [
                  ['', 'Не указывать'],
                  ['male', 'М'],
                  ['female', 'Ж'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id || 'any'}
                  type="button"
                  onClick={() => setGender(id)}
                  className={`chip chip-invert flex-1 justify-center ${
                    gender === id ? 'chip-active' : ''
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-hub-muted">Город</label>
            <div className="relative">
              <input
                value={cityQuery}
                onChange={(e) => {
                  setCityQuery(e.target.value)
                  setCityOpen(true)
                }}
                onFocus={() => setCityOpen(true)}
                placeholder="Выберите из списка"
                className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text placeholder:text-hub-muted/50"
                autoCapitalize="words"
                autoComplete="off"
              />
              {cityOpen && citySuggestions.length > 0 && (
                <ul className="absolute left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#111] py-1 shadow-xl">
                  {citySuggestions.map((c) => (
                    <li key={c}>
                      <button
                        type="button"
                        className="w-full px-3 py-2.5 text-left text-[15px] text-white hover:bg-white/[0.06]"
                        onClick={() => pickCity(c)}
                      >
                        {c}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-1.5 text-[12px] text-[#636366]">
              Только города из списка РФ (как в фильтре людей).
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
            Показывать город
            <input type="checkbox" checked={showCity} onChange={(e) => setShowCity(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-[14px] text-white">
            Показывать дату рождения
            <input type="checkbox" checked={showBirth} onChange={(e) => setShowBirth(e.target.checked)} />
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

        <button
          type="submit"
          disabled={saving || uploading}
          className="hub-btn hub-btn-secondary mt-8 h-14 w-full rounded-2xl border border-white/10 bg-gradient-to-b from-[#4a4a54] to-[#2c2c32] text-base font-semibold"
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
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
      <label className="mb-1.5 block text-sm text-hub-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text"
      />
    </div>
  )
}
