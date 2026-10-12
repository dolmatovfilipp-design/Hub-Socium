import { useState, type InputHTMLAttributes } from 'react'
import { IconEye, IconEyeOff } from './Icons'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Lowercase field name used in the toggle's accessible label, e.g. "пароль". */
  fieldLabel?: string
}

/**
 * Password field with an in-field visibility toggle.
 * The button is absolutely positioned so showing or hiding the value
 * does not change the input's size or the surrounding layout.
 */
export function PasswordInput({
  className = '',
  fieldLabel = 'пароль',
  disabled,
  style,
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const name = fieldLabel.trim().toLocaleLowerCase('ru-RU') || 'пароль'
  const action = visible ? 'Скрыть' : 'Показать'

  return (
    <div className="relative">
      <input
        {...rest}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        style={{ ...style, paddingRight: '3rem' }}
        className={`hub-password-input ${className}`}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={`${action} ${name}`}
        aria-pressed={visible}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
        className="absolute top-1/2 right-1 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-hub-muted transition-colors hover:text-hub-text focus-visible:text-hub-text disabled:pointer-events-none disabled:opacity-40"
      >
        {visible ? <IconEyeOff size={20} /> : <IconEye size={20} />}
      </button>
    </div>
  )
}
