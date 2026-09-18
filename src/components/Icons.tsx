import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number; filled?: boolean }

function base({ size = 24, className, filled, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor',
    strokeWidth: filled ? 0 : 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true as const,
    ...rest,
  }
}

export function IconHome(p: IconProps) {
  const { filled, ...rest } = p
  if (filled) {
    return (
      <svg {...base({ ...rest, filled: true, strokeWidth: 0 })}>
        <path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5H14v-6h-4v6H4.5A1.5 1.5 0 0 1 3 20V10.5z" />
      </svg>
    )
  }
  return (
    <svg {...base(rest)}>
      <path d="M3.5 10.8 12 3.5l8.5 7.3V20a1.2 1.2 0 0 1-1.2 1.2H14.2v-5.6h-4.4v5.6H4.7A1.2 1.2 0 0 1 3.5 20V10.8z" />
    </svg>
  )
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16.2 16.2 4.3 4.3" />
    </svg>
  )
}

export function IconPlane(p: IconProps) {
  const { filled, ...rest } = p
  if (filled) {
    return (
      <svg {...base({ ...rest, filled: true, strokeWidth: 0 })}>
        <path d="M21.5 3.2 2.8 10.4c-.7.3-.7 1.3.1 1.5l8.2 2.1 2.1 8.2c.2.8 1.2.8 1.5.1L21.5 3.2z" />
      </svg>
    )
  }
  return (
    <svg {...base(rest)}>
      <path d="M21.5 3.2 2.8 10.4c-.7.3-.7 1.3.1 1.5l8.2 2.1 2.1 8.2c.2.8 1.2.8 1.5.1L21.5 3.2z" />
      <path d="m11.1 14 3.3-3.3" />
    </svg>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconHeart(p: IconProps) {
  const { filled, ...rest } = p
  return (
    <svg {...base({ ...rest, filled })}>
      <path
        d="M12 20.4s-7.2-4.4-9.2-8.2C1.2 9.2 2.4 5.8 5.6 5.2c1.9-.4 3.7.5 4.7 1.9.3.4.6.7.7.9.1-.2.4-.5.7-.9 1-1.4 2.8-2.3 4.7-1.9 3.2.6 4.4 4 2.8 7 -2 3.8-9.2 8.2-9.2 8.2z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
      />
    </svg>
  )
}

export function IconUser(p: IconProps) {
  const { filled, ...rest } = p
  if (filled) {
    return (
      <svg {...base({ ...rest, filled: true, strokeWidth: 0 })}>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 19.2c0-3.2 3-5.4 7-5.4s7 2.2 7 5.4" />
      </svg>
    )
  }
  return (
    <svg {...base(rest)}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.2 19c.4-3 3.1-5 6.8-5s6.4 2 6.8 5" />
    </svg>
  )
}

export function IconMenu(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 9h14M5 15h14" />
    </svg>
  )
}

export function IconMore(p: IconProps) {
  return (
    <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </svg>
  )
}

export function IconReply(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21 12a8.2 8.2 0 0 1-8.2 8.2H5.5L3 22.5V12a8.2 8.2 0 0 1 8.2-8.2H12A8.2 8.2 0 0 1 21 12z" />
    </svg>
  )
}

export function IconRepost(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M17 3.5 20.5 7 17 10.5" />
      <path d="M4 11.5V9.2A3.7 3.7 0 0 1 7.7 5.5H20.5" />
      <path d="M7 20.5 3.5 17 7 13.5" />
      <path d="M20 12.5v2.3a3.7 3.7 0 0 1-3.7 3.7H3.5" />
    </svg>
  )
}

export function IconShare(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21.5 3.2 2.8 10.4c-.7.3-.7 1.3.1 1.5l8.2 2.1 2.1 8.2c.2.8 1.2.8 1.5.1L21.5 3.2z" />
      <path d="m11.1 14 3.3-3.3" />
    </svg>
  )
}

export function IconCompose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14.2 4.5h5.3v5.3" />
      <path d="M20 4 11.2 12.8" />
      <path d="M10 5.5H6.2A2.2 2.2 0 0 0 4 7.7v10.1A2.2 2.2 0 0 0 6.2 20h10.1a2.2 2.2 0 0 0 2.2-2.2V14" />
    </svg>
  )
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function IconImage(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10.5" r="1.6" />
      <path d="m7.5 17 3.2-3.5 2.3 2.2 3-3.7 3.5 5" />
    </svg>
  )
}

export function IconGif(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="M8.2 14.5V9.5h2.2M8.2 12h1.6M12.2 9.5v5M14.8 9.5h2.6v2.2h-1.8v3.8" />
    </svg>
  )
}

export function IconSticker(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5a8.5 8.5 0 1 0 6 14.5L20.5 12A8.5 8.5 0 0 0 12 3.5z" />
      <path d="M14.5 14.5c0 0 1.8-1.2 4-1.2" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d="M9 13.2c.8.9 2 1.4 3.2 1.4" />
    </svg>
  )
}

export function IconMusic(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9 18.5V7.2l10-2.2v11.3" />
      <circle cx="7" cy="18.5" r="2.2" />
      <circle cx="17" cy="16.3" r="2.2" />
    </svg>
  )
}

export function IconFilter(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  )
}

export function IconSliders(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 8h8M16 8h4M14 6v4M4 16h4M12 16h8M10 14v4" />
    </svg>
  )
}

export function IconDraft(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z" />
      <path d="M14 3.5V8h4.8" />
    </svg>
  )
}

export function IconChevron(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.6l1.6 1.6M17.5 15.8l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.4l1.6-1.6M17.5 8.2l1.6-1.6" />
    </svg>
  )
}

export function IconHubMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-label="Hub"
    >
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 21.5V10.5h2.4v4.2h5.2v-4.2H20V21.5h-2.4v-4.8h-5.2v4.8H10z"
        fill="currentColor"
      />
    </svg>
  )
}
