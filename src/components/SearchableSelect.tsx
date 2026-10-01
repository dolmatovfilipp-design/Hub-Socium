import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevron } from './Icons'

export type SearchableSelectOption<T extends string> = {
  value: T
  label: string
  preview: string
}

type SearchableSelectProps<T extends string> = {
  options: readonly SearchableSelectOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  placeholder?: string
}

/** Compact searchable picker for longer visual theme lists. */
export function SearchableSelect<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder = 'Выберите вариант',
}: SearchableSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU')
    if (!normalized) return options
    return options.filter((option) => option.label.toLocaleLowerCase('ru-RU').includes(normalized))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    inputRef.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (next: T) => {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.05] px-3.5 text-left text-[14px] text-white transition-colors hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
      >
        {selected ? (
          <span
            className="h-5 w-9 shrink-0 rounded-full border border-white/25 shadow-inner"
            style={{ background: selected.preview }}
            aria-hidden
          />
        ) : (
          <span className="h-5 w-9 shrink-0 rounded-full border border-white/15 bg-white/[0.06]" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <IconChevron size={18} className={`shrink-0 text-[#8e8e93] transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#202024] p-2 shadow-2xl shadow-black/40">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск темы…"
            aria-label={`Поиск: ${ariaLabel}`}
            className="mb-2 h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.06] px-3 text-[14px] text-white outline-none placeholder:text-[#8e8e93] focus:border-white/25"
          />
          <div className="no-scrollbar max-h-64 space-y-0.5 overflow-y-auto" role="listbox" aria-label={ariaLabel}>
            {filtered.map((option) => {
              const active = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(option.value)}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[14px] transition-colors ${
                    active ? 'bg-white/[0.14] text-white' : 'text-[#c7c7cc] hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span
                    className="h-5 w-9 shrink-0 rounded-full border border-white/25 shadow-inner"
                    style={{ background: option.preview }}
                    aria-hidden
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              )
            })}
            {!filtered.length && <p className="px-2.5 py-3 text-[13px] text-[#8e8e93]">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </div>
  )
}
