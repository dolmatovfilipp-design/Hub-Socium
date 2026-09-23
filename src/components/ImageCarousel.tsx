import { useState } from 'react'

export function ImageCarousel({ urls, className = '' }: { urls: string[]; className?: string }) {
  const [i, setI] = useState(0)
  if (!urls.length) return null
  if (urls.length === 1) {
    return (
      <div className={`relative overflow-hidden rounded-[12px] border border-white/[0.08] ${className}`}>
        <img src={urls[0]} alt="" className="block max-h-[420px] w-full object-cover" loading="lazy" />
      </div>
    )
  }
  return (
    <div className={`relative overflow-hidden rounded-[12px] border border-white/[0.08] ${className}`}>
      <div
        className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar"
        onScroll={(e) => {
          const el = e.currentTarget
          const idx = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))
          setI(idx)
        }}
      >
        {urls.map((u) => (
          <img
            key={u}
            src={u}
            alt=""
            className="max-h-[420px] w-full shrink-0 snap-center object-cover"
            loading="lazy"
          />
        ))}
      </div>
      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
        {urls.map((_, idx) => (
          <span
            key={idx}
            className={`h-1.5 w-1.5 rounded-full ${idx === i ? 'bg-white' : 'bg-white/40'}`}
          />
        ))}
      </div>
      <p className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white">
        {i + 1}/{urls.length}
      </p>
    </div>
  )
}
