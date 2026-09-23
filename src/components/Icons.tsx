import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number; filled?: boolean }

/** Threads-like thin stroke (~1.35). */
function base({ size = 24, className, filled, strokeWidth, ...rest }: IconProps) {
  const sw = filled ? 0 : (strokeWidth ?? 1.35)
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor',
    strokeWidth: sw,
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
        <path d="M4 10.2 12 3.5l8 6.7V20a1.2 1.2 0 0 1-1.2 1.2h-4.6v-5.8h-4.4v5.8H5.2A1.2 1.2 0 0 1 4 20V10.2z" />
      </svg>
    )
  }
  return (
    <svg {...base(rest)}>
      <path d="M4 10.2 12 3.5l8 6.7V20a1.2 1.2 0 0 1-1.2 1.2h-4.6v-5.8h-4.4v5.8H5.2A1.2 1.2 0 0 1 4 20V10.2z" />
    </svg>
  )
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6.25" />
      <path d="m16.15 16.15 4.35 4.35" />
    </svg>
  )
}

export function IconPlane(p: IconProps) {
  const { filled, ...rest } = p
  if (filled) {
    return (
      <svg {...base({ ...rest, filled: true, strokeWidth: 0 })}>
        <path d="M21.44 2.98 2.92 10.35c-.72.29-.7 1.32.04 1.57l7.55 2.55 2.55 7.55c.25.74 1.28.76 1.57.04L21.44 2.98z" />
      </svg>
    )
  }
  return (
    <svg {...base(rest)}>
      <path d="M21.44 2.98 2.92 10.35c-.72.29-.7 1.32.04 1.57l7.55 2.55 2.55 7.55c.25.74 1.28.76 1.57.04L21.44 2.98z" />
      <path d="m10.9 14.05 3.55-3.55" />
    </svg>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5.25v13.5M5.25 12h13.5" />
    </svg>
  )
}

export function IconHeart(p: IconProps) {
  const { filled, ...rest } = p
  return (
    <svg {...base({ ...rest, filled })}>
      <path
        d="M12 20.25S4.5 15.6 2.7 11.55C1.35 8.7 2.85 5.4 6.15 4.95c1.8-.25 3.45.55 4.35 1.85L12 8.1l1.5-1.3c.9-1.3 2.55-2.1 4.35-1.85 3.3.45 4.8 3.75 3.45 6.6C19.5 15.6 12 20.25 12 20.25z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.35}
      />
    </svg>
  )
}

export function IconUser(p: IconProps) {
  const { filled, ...rest } = p
  if (filled) {
    return (
      <svg {...base({ ...rest, filled: true, strokeWidth: 0 })}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5.2 19.2c.35-3.15 3.05-5.2 6.8-5.2s6.45 2.05 6.8 5.2" />
      </svg>
    )
  }
  return (
    <svg {...base(rest)}>
      <circle cx="12" cy="8" r="3.35" />
      <path d="M5.35 19c.4-3 3.05-4.95 6.65-4.95S18.25 16 18.65 19" />
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
    <svg {...base({ ...p, fill: 'currentColor', stroke: 'none', strokeWidth: 0 })}>
      <circle cx="6" cy="12" r="1.35" />
      <circle cx="12" cy="12" r="1.35" />
      <circle cx="18" cy="12" r="1.35" />
    </svg>
  )
}

/** Threads reply bubble — rounded rect + tail */
export function IconReply(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20.25 11.5a7.25 7.25 0 0 1-7.25 7.25H7.1L4.35 21.2V11.5a7.25 7.25 0 0 1 7.25-7.25h1.4A7.25 7.25 0 0 1 20.25 11.5z" />
    </svg>
  )
}

/** Threads repost — dual arrows */
export function IconRepost(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M16.75 3.75 20 7l-3.25 3.25" />
      <path d="M4.5 11.25V9.1A3.6 3.6 0 0 1 8.1 5.5H20" />
      <path d="M7.25 20.25 4 17l3.25-3.25" />
      <path d="M19.5 12.75v2.15a3.6 3.6 0 0 1-3.6 3.6H4" />
    </svg>
  )
}

/** Threads share — paper plane */
export function IconShare(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21.4 3.05 3.05 10.55c-.68.28-.66 1.25.04 1.48l7.35 2.4 2.4 7.35c.23.7 1.2.72 1.48.04L21.4 3.05z" />
      <path d="m10.75 13.85 3.65-3.65" />
    </svg>
  )
}

/** Rounded square + pencil (Messages compose). */
export function IconCompose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M13.2 8.4 15.6 10.8" />
      <path d="M8.2 15.8 14.4 9.6a1.35 1.35 0 0 1 1.9 0l.3.3a1.35 1.35 0 0 1 0 1.9L10.4 17.8H8.2v-2z" />
    </svg>
  )
}

export function IconTrash(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5.5 7.5h13" />
      <path d="M9.5 7.5V5.8A1.3 1.3 0 0 1 10.8 4.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M8 7.5l.7 11.2A1.5 1.5 0 0 0 10.2 20h3.6a1.5 1.5 0 0 0 1.5-1.3L16 7.5" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
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

/** Soft 6-lobed gear (Threads-style outline). */
export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8.572 6.062A3.45 3.45 0 0 1 15.428 6.062A3.45 3.45 0 0 1 18.856 12A3.45 3.45 0 0 1 15.428 17.938A3.45 3.45 0 0 1 8.572 17.938A3.45 3.45 0 0 1 5.144 12A3.45 3.45 0 0 1 8.572 6.062Z" />
      <circle cx="12" cy="12" r="2.9" />
    </svg>
  )
}

export function IconBookmark(p: IconProps) {
  const { filled, ...rest } = p
  return (
    <svg {...base({ ...rest, filled })}>
      <path
        d="M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v14.2L12 16.6 5.5 20.2V6A1.5 1.5 0 0 1 7 4.5z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.35}
      />
    </svg>
  )
}

export function IconPencil(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14.1 5.4 18.6 9.9" />
      <path d="M5.5 18.5 16.2 7.8a1.9 1.9 0 0 1 2.7 0l.3.3a1.9 1.9 0 0 1 0 2.7L8.5 21.5H5.5v-3z" />
    </svg>
  )
}

export function IconPlusCircle(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  )
}



export function IconBag(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.5 8.5h11l-.8 10.2A1.8 1.8 0 0 1 14.9 20H9.1a1.8 1.8 0 0 1-1.8-1.3L6.5 8.5z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  )
}

export function IconBell(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.25 16.75h11.5" />
      <path d="M8.35 16.75V10.2a3.65 3.65 0 0 1 7.3 0v6.55" />
      <path d="M10.2 16.75a1.8 1.8 0 0 0 3.6 0" />
      <path d="M12 4.55v1.35" />
    </svg>
  )
}

export function IconLock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2" />
      <path d="M8.4 10.5V8.1a3.6 3.6 0 0 1 7.2 0v2.4" />
    </svg>
  )
}

export function IconHelp(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M9.55 9.55a2.45 2.45 0 1 1 2.95 2.35c-.85.4-1.25.95-1.25 1.85" />
      <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconInfo(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 11.1v5.2" />
      <circle cx="12" cy="8.35" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconVerified({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.9" />
      <path
        d="M7.4 12.2 10.5 15.2 16.6 8.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}


export function IconPin(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9.5 4.5h5l1.2 5.2 2.8 2.3v1.5H13.5V20l-1.5-1.2L10.5 20v-6.5H5.5v-1.5l2.8-2.3L9.5 4.5z" />
    </svg>
  )
}

export function IconMoreCircle(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="8.2" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.8" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconPersonPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9.5" cy="8" r="3.1" />
      <path d="M3.8 18.5c.35-2.7 2.55-4.5 5.7-4.5s5.35 1.8 5.7 4.5" />
      <path d="M17.5 8.5v5M15 11h5" />
    </svg>
  )
}

export function IconPlusSmall(p: IconProps) {
  return (
    <svg {...base({ ...p, strokeWidth: p.strokeWidth ?? 2.4 })}>
      <path d="M12 7v10M7 12h10" />
    </svg>
  )
}

export function IconLink(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M10 13a5 5 0 0 0 7.07 0l1.76-1.76a5 5 0 0 0-7.07-7.07L10.5 5.4" />
      <path d="M14 11a5 5 0 0 0-7.07 0L5.17 12.76a5 5 0 0 0 7.07 7.07L13.5 18.6" />
    </svg>
  )
}

export function IconEye(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}

export function IconEyeOff(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2.6 2.6 0 0 0 3.7 3.7" />
      <path d="M7.1 7.3C4.7 8.7 3 12 3 12s3.5 5.5 9 5.5c1.5 0 2.9-.3 4.1-.8" />
      <path d="M14.1 6.7A9.4 9.4 0 0 1 12 6.5C6.5 6.5 3 12 3 12" />
      <path d="M16.8 9.2C19 10.5 21 12 21 12s-3.5 5.5-9 5.5" />
    </svg>
  )
}

export function IconHideUser(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="10" cy="8" r="3.1" />
      <path d="M3.6 18.5c.4-2.7 2.6-4.5 6.4-4.5 1.2 0 2.3.2 3.2.6" />
      <path d="M16.5 14.5l5 5M21.5 14.5l-5 5" />
    </svg>
  )
}

export function IconRestrict(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="10" cy="8" r="3.1" />
      <path d="M3.6 18.5c.4-2.7 2.6-4.5 6.4-4.5s6 1.8 6.4 4.5" />
      <path d="M15.5 9.5 21 15M21 9.5l-5.5 5.5" />
    </svg>
  )
}

export function IconBlock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M6.5 6.5 17.5 17.5" />
    </svg>
  )
}

export function IconReport(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20 11.5a7.25 7.25 0 0 1-7.25 7.25H7.1L4.35 21.2V11.5a7.25 7.25 0 0 1 7.25-7.25h1.4A7.25 7.25 0 0 1 20 11.5z" />
      <path d="M12 8.5v4M12 15.2h.01" />
    </svg>
  )
}

export function IconMention(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20.25 11.5a7.25 7.25 0 0 1-7.25 7.25H7.1L4.35 21.2V11.5a7.25 7.25 0 0 1 7.25-7.25h1.4A7.25 7.25 0 0 1 20.25 11.5z" />
      <circle cx="12" cy="11" r="2.4" />
      <path d="M8.6 16.2c.55-1.5 1.85-2.4 3.4-2.4s2.85.9 3.4 2.4" />
    </svg>
  )
}

export function IconUserStatus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="10" cy="8" r="3.1" />
      <path d="M3.6 18.5c.4-2.7 2.6-4.5 6.4-4.5 1.35 0 2.55.25 3.5.7" />
      <circle cx="17.5" cy="14.5" r="3.1" />
    </svg>
  )
}

export function IconFollowingList(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M2.8 18.3c.35-2.5 2.4-4.2 5.7-4.2s5.35 1.7 5.7 4.2" />
      <path d="M15.5 8.5h5.5M15.5 12.5h5.5M15.5 16.5h4" />
    </svg>
  )
}

export function IconFeedCard(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="5" width="16" height="14" rx="2.2" />
      <path d="M7.5 9.5h9M7.5 12.5h9M7.5 15.5h5.5" />
    </svg>
  )
}

export function IconHeartOff(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 19.5S5 15.2 3.4 11.4C2.2 8.8 3.55 5.85 6.5 5.45c1.55-.2 3 .5 3.9 1.7L12 8.9l1.6-1.75c.9-1.2 2.35-1.9 3.9-1.7 2.95.4 4.3 3.35 3.1 5.95-.5 1.2-1.7 2.55-3.15 3.95" />
      <path d="M4 4.5 20 19.5" />
    </svg>
  )
}

export function IconPersonLock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="10" cy="8" r="3.1" />
      <path d="M3.6 18.5c.4-2.7 2.6-4.5 6.4-4.5.85 0 1.65.1 2.35.3" />
      <rect x="14.2" y="13.2" width="6.3" height="5.2" rx="1.2" />
      <path d="M15.6 13.2v-1.2a1.55 1.55 0 0 1 3.1 0v1.2" />
    </svg>
  )
}
