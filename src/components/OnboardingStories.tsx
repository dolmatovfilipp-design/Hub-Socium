import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ONBOARDING_SLIDES,
  markOnboardingSeen,
  type OnboardingSlide,
} from '../lib/onboarding'

const SLIDE_MS = 5200

function ProgressBars({
  count,
  index,
  progress,
}: {
  count: number
  index: number
  progress: number
}) {
  return (
    <div className="flex gap-1 px-3 pt-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25"
        >
          <div
            className="h-full rounded-full bg-white transition-[width] duration-75 ease-linear"
            style={{
              width:
                i < index ? '100%' : i === index ? `${Math.round(progress * 100)}%` : '0%',
            }}
          />
        </div>
      ))}
    </div>
  )
}

function StoryCard({ slide }: { slide: OnboardingSlide }) {
  return (
    <div
      className="relative flex h-full w-full flex-col justify-end overflow-hidden rounded-[28px]"
      style={{ background: slide.vibe }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 20%, rgba(255,255,255,0.18), transparent 60%)',
        }}
      />
      <div className="pointer-events-none absolute -right-6 top-16 text-[120px] font-light leading-none text-white/10">
        {slide.emoji}
      </div>
      <div className="hub-onboard-float pointer-events-none absolute left-8 top-24 text-5xl text-white/30">
        {slide.emoji}
      </div>
      <div className="relative z-10 space-y-3 px-6 pb-10 pt-6">
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-white/55">
          Hub · обучение
        </p>
        <h2 className="text-[28px] font-bold leading-tight text-white">{slide.title}</h2>
        <p className="text-[16px] leading-snug text-white/85">{slide.body}</p>
        {slide.hint ? (
          <p className="inline-flex rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium text-white/90">
            {slide.hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function OnboardingStories({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const startRef = useRef(0)
  const rafRef = useRef(0)

  const finish = useCallback(() => {
    markOnboardingSeen()
    onClose()
  }, [onClose])

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= ONBOARDING_SLIDES.length - 1) {
        finish()
        return i
      }
      return i + 1
    })
    setProgress(0)
  }, [finish])

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
    setProgress(0)
  }, [])

  useEffect(() => {
    if (!open) return
    setIndex(0)
    setProgress(0)
    setPaused(false)
  }, [open])

  useEffect(() => {
    if (!open || paused) return
    startRef.current = performance.now() - progress * SLIDE_MS
    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / SLIDE_MS)
      setProgress(p)
      if (p >= 1) {
        goNext()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart timer on index/pause only
  }, [open, index, paused, goNext])

  if (!open) return null

  const slide = ONBOARDING_SLIDES[index]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="Обучение Hub"
    >
      <div className="relative flex h-full w-full max-w-[430px] flex-col px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(8px,env(safe-area-inset-top))]">
        <ProgressBars count={ONBOARDING_SLIDES.length} index={index} progress={progress} />

        <div className="mt-2 flex items-center justify-between px-1">
          <span className="text-[13px] font-semibold text-white/80">
            {index + 1} / {ONBOARDING_SLIDES.length}
          </span>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-[14px] font-semibold text-white/90"
            onClick={finish}
          >
            Пропустить
          </button>
        </div>

        <div
          className="relative mt-2 min-h-0 flex-1"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
        >
          <StoryCard slide={slide} />
          {/* Tap zones */}
          <button
            type="button"
            aria-label="Назад"
            className="absolute inset-y-0 left-0 z-20 w-[32%]"
            onClick={(e) => {
              e.stopPropagation()
              goPrev()
            }}
          />
          <button
            type="button"
            aria-label="Дальше"
            className="absolute inset-y-0 right-0 z-20 w-[32%]"
            onClick={(e) => {
              e.stopPropagation()
              goNext()
            }}
          />
        </div>

        <button
          type="button"
          className="mt-3 w-full rounded-2xl bg-white py-3.5 text-[16px] font-bold text-black"
          onClick={goNext}
        >
          {index >= ONBOARDING_SLIDES.length - 1 ? 'Начать' : 'Дальше'}
        </button>
      </div>
    </div>
  )
}
