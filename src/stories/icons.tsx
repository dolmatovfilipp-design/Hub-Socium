type GlyphProps = { size?: number }

/** Flash and flip are not in the shared icon set. Stroke matches Icons.tsx. */
function svg(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.35,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
}

export function StoryIconFlash({ size = 22 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M13 2.5 5.5 13.5h5.2L10.2 21.5 18.5 10h-5.1L13 2.5z" />
    </svg>
  )
}

export function StoryIconFlip({ size = 22 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M7 8.5h9.2a3.3 3.3 0 0 1 3.3 3.3v.4" />
      <path d="M16.2 6.2 19.5 8.5 16.2 10.8" />
      <path d="M17 15.5H7.8A3.3 3.3 0 0 1 4.5 12.2v-.4" />
      <path d="M7.8 17.8 4.5 15.5l3.3-2.3" />
    </svg>
  )
}
