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

/** Shared single-row segment track used by the landing page and settings. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-[#2c2c2e] p-1 ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      <div className="no-scrollbar flex w-full min-w-0 gap-1 overflow-x-auto">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(option.value)}
              className={`min-h-10 min-w-max flex-1 shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/50 ${
                active
                  ? 'bg-[#3a3a3c] text-hub-text'
                  : 'text-hub-muted hover:bg-white/[0.04] hover:text-hub-text'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
