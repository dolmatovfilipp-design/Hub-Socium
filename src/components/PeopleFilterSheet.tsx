import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './Icons'
import { RU_CITIES as ruCities } from '../data/ru-cities'

export type PeopleGender = 'any' | 'male' | 'female'

export type PeopleFilters = {
  name: string
  ageMin: string
  ageMax: string
  gender: PeopleGender
  city: string
}

export const DEFAULT_PEOPLE_FILTERS: PeopleFilters = {
  name: '',
  ageMin: '',
  ageMax: '',
  gender: 'any',
  city: '',
}

const GENDER_SEGMENTS: { id: PeopleGender; label: string }[] = [
  { id: 'any', label: 'Любой' },
  { id: 'male', label: 'М' },
  { id: 'female', label: 'Ж' },
]

interface Props {
  open: boolean
  onClose: () => void
  value: PeopleFilters
  onApply: (next: PeopleFilters) => void
}

export function PeopleFilterSheet({ open, onClose, value, onApply }: Props) {
  const [mounted, setMounted] = useState(false)
  const [draft, setDraft] = useState<PeopleFilters>(value)
  const [cityQuery, setCityQuery] = useState('')
  const [cityOpen, setCityOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(value)
      setCityQuery(value.city)
      setCityOpen(false)
      setMounted(true)
      return
    }
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 240)
    return () => window.clearTimeout(t)
  }, [open, value, mounted])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const citySuggestions = useMemo(() => {
    const q = cityQuery.trim().toLowerCase()
    if (!q) return ruCities.slice(0, 12)
    return ruCities.filter((c) => c.toLowerCase().includes(q)).slice(0, 16)
  }, [cityQuery])

  const host =
    typeof document !== 'undefined'
      ? document.getElementById('hub-overlay-root')
      : null

  if (!mounted || !host) return null

  const reset = () => {
    setDraft({ ...DEFAULT_PEOPLE_FILTERS })
    setCityQuery('')
  }

  const apply = () => {
    const city = draft.city.trim()
    const normalized =
      city &&
      ruCities.find((c) => c.toLowerCase() === city.toLowerCase())
    onApply({
      ...draft,
      name: draft.name.trim(),
      city: normalized ?? '',
    })
    onClose()
  }

  const pickCity = (c: string) => {
    setDraft((d) => ({ ...d, city: c }))
    setCityQuery(c)
    setCityOpen(false)
  }

  return createPortal(
    <div
      className={`market-filter-root pointer-events-auto absolute inset-0 z-[90] flex flex-col ${
        open ? 'market-filter-open' : 'market-filter-closing'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Фильтры поиска людей"
    >
      <button
        type="button"
        className="market-filter-backdrop absolute inset-0"
        aria-label="Закрыть"
        onClick={onClose}
      />

      <div className="market-filter-sheet relative z-[1] mt-auto flex max-h-[92%] min-h-0 w-full flex-col rounded-t-[20px] bg-black">
        <header className="relative flex shrink-0 items-center justify-center border-b border-white/[0.08] px-2 pb-3 pt-3">
          <button
            type="button"
            className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <IconClose size={20} />
          </button>
          <h2 className="text-[17px] font-semibold text-white">Фильтры</h2>
          <button
            type="button"
            className="absolute right-3 text-[15px] text-[#8e8e93]"
            onClick={reset}
          >
            Сбросить
          </button>
        </header>

        <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-4 pt-4">
          <label className="block text-[13px] font-medium text-[#8e8e93]">Имя / ФИО</label>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Например, Анна"
            className="mt-2 h-11 w-full rounded-xl bg-[#1c1c1e] px-3 text-[15px] text-white placeholder:text-[#636366]"
            autoCapitalize="words"
          />

          <p className="mt-5 text-[13px] font-medium text-[#8e8e93]">Возраст</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft.ageMin}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  ageMin: e.target.value.replace(/\D/g, '').slice(0, 3),
                }))
              }
              placeholder="От"
              className="h-11 w-full rounded-xl bg-[#1c1c1e] px-3 text-[15px] text-white placeholder:text-[#636366]"
            />
            <span className="text-[#636366]">—</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft.ageMax}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  ageMax: e.target.value.replace(/\D/g, '').slice(0, 3),
                }))
              }
              placeholder="До"
              className="h-11 w-full rounded-xl bg-[#1c1c1e] px-3 text-[15px] text-white placeholder:text-[#636366]"
            />
          </div>

          <p className="mt-5 text-[13px] font-medium text-[#8e8e93]">Пол</p>
          <div className="mt-2 flex gap-2">
            {GENDER_SEGMENTS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, gender: g.id }))}
                className={`chip chip-invert flex-1 justify-center ${
                  draft.gender === g.id ? 'chip-active' : ''
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          <p className="mt-5 text-[13px] font-medium text-[#8e8e93]">Город</p>
          <div className="relative mt-2">
            <input
              value={cityQuery}
              onChange={(e) => {
                setCityQuery(e.target.value)
                setDraft((d) => ({ ...d, city: e.target.value }))
                setCityOpen(true)
              }}
              onFocus={() => setCityOpen(true)}
              placeholder="Выберите из списка"
              className="h-11 w-full rounded-xl bg-[#1c1c1e] px-3 text-[15px] text-white placeholder:text-[#636366]"
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
          <p className="mt-2 text-[12px] leading-snug text-[#636366]">
            Только города из списка РФ (без свободного ввода).
          </p>
        </div>

        <div className="safe-bottom shrink-0 border-t border-white/[0.08] px-4 pb-4 pt-3">
          <button
            type="button"
            className="btn-liquid-glass flex h-12 w-full items-center justify-center rounded-full text-[16px] font-semibold text-white"
            onClick={apply}
          >
            Применить
          </button>
        </div>
      </div>
    </div>,
    host,
  )
}

export function peopleFiltersActive(f: PeopleFilters): boolean {
  return Boolean(
    f.name.trim() ||
      f.ageMin.trim() ||
      f.ageMax.trim() ||
      (f.gender && f.gender !== 'any') ||
      f.city.trim(),
  )
}
