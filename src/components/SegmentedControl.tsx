import type { ReactNode } from 'react'

type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
}

type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

/** Shared dark capsule switcher used by the landing page and settings. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`flex w-full flex-wrap gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`min-h-10 flex-1 rounded-full px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/50 ${
              active ? 'bg-white/10 text-hub-text shadow-sm' : 'text-hub-muted hover:text-hub-text'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
