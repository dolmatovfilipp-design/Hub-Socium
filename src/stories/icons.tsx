type GlyphProps = { size?: number }

function svg(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
}

export function StoryIconClose({ size = 26 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function StoryIconFlash({ size = 26 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M13 2.5 5.5 13.5h5.2L10.2 21.5 18.5 10h-5.1L13 2.5z" />
    </svg>
  )
}

export function StoryIconFlip({ size = 26 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M7 8.5h9.2a3.3 3.3 0 0 1 3.3 3.3v.4" />
      <path d="M16.2 6.2 19.5 8.5 16.2 10.8" />
      <path d="M17 15.5H7.8A3.3 3.3 0 0 1 4.5 12.2v-.4" />
      <path d="M7.8 17.8 4.5 15.5l3.3-2.3" />
    </svg>
  )
}

export function StoryIconImage({ size = 26 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <circle cx="9" cy="10.2" r="1.4" />
      <path d="m7.2 16.8 3.3-3.4 2.2 2.1 2.6-3.2 3.4 4.5" />
    </svg>
  )
}

export function StoryIconText({ size = 26 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M5 6.5h14" />
      <path d="M12 6.5v12" />
      <path d="M8.5 18.5h7" />
    </svg>
  )
}

export function StoryIconPin({ size = 26 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M12 21s6-5.1 6-10a6 6 0 1 0-12 0c0 4.9 6 10 6 10z" />
      <circle cx="12" cy="11" r="1.8" />
    </svg>
  )
}

export function StoryIconMusic({ size = 26 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M9 17.2V6.2l9-1.8v10.6" />
      <circle cx="6.6" cy="17.2" r="2.3" />
      <circle cx="15.6" cy="15" r="2.3" />
    </svg>
  )
}
