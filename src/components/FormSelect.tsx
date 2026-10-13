type Option = { value: string; label: string }

type FormSelectProps = {
  label?: string
  value: string
  onChange: (value: string) => void
  options: readonly Option[] | readonly string[]
  placeholder?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  /** Solid field used by the profile editor. Registration keeps the outline field. */
  filled?: boolean
}

function normalize(options: readonly Option[] | readonly string[]): Option[] {
  return options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
}

/** Styled native select for registration / profile forms. */
export function FormSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Выберите',
  ariaLabel,
  className = '',
  disabled,
  filled = false,
}: FormSelectProps) {
  const opts = normalize(options)
  return (
    <div className={className}>
      {label ? (
        <label className={filled ? 'mb-1.5 block text-[13px] text-[#8e8e93]' : 'mb-1.5 block text-sm text-hub-muted'}>
          {label}
        </label>
      ) : null}
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        onChange={(e) => onChange(e.target.value)}
        className={
          filled
            ? 'h-14 w-full appearance-none rounded-2xl border-0 bg-[#2c2c2e] px-4 text-[16px] text-white disabled:opacity-50'
            : 'h-14 w-full appearance-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text disabled:opacity-50'
        }
      >
        <option value="">{placeholder}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
