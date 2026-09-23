import { initials, avatarColor } from '../utils/validation'

interface Props {
  name: string
  id: string
  src?: string
  size?: number
  className?: string
}

export function Avatar({ name, id, src, size = 40, className = '' }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`avatar-ring rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 text-[#c8c8c8] font-medium ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, ${avatarColor(id)}, #0a0a0a)`,
        fontSize: size * 0.32,
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {initials(name)}
    </div>
  )
}
