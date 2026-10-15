import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { IconMusic, IconPin } from '../components/Icons'
import { filterCss, textStyleClass } from './filters'

export type StoryFrameMedia = 'image' | 'video' | 'audio' | 'text' | ''

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function StoryFrame({
  mediaUrl,
  mediaKind,
  filterId,
  mirrored,
  body,
  textStyle,
  textX = 50,
  textY = 42,
  placeName,
  placeX = 50,
  placeY = 76,
  videoMuted = false,
  draggable = false,
  onTextMove,
  onPlaceMove,
  onFilterStep,
}: {
  mediaUrl?: string
  mediaKind?: StoryFrameMedia
  filterId?: string
  mirrored?: boolean
  body?: string
  textStyle?: string
  textX?: number
  textY?: number
  placeName?: string
  placeX?: number
  placeY?: number
  videoMuted?: boolean
  draggable?: boolean
  onTextMove?: (x: number, y: number) => void
  onPlaceMove?: (x: number, y: number) => void
  onFilterStep?: (dir: -1 | 1) => void
}) {
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const mediaStyle = {
    filter: filterCss(filterId),
    transform: mirrored ? 'scaleX(-1)' : undefined,
  }
  const mediaClass = 'h-full w-full object-cover transition-[filter] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none'
  const visual = mediaKind === 'image' || mediaKind === 'video'

  const drag = (
    event: ReactPointerEvent,
    read: () => { x: number; y: number },
    write?: (x: number, y: number) => void,
  ) => {
    if (!draggable || !write) return
    event.stopPropagation()
    event.preventDefault()
    const frame = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
    if (!frame) return
    const origin = read()
    const x0 = event.clientX
    const y0 = event.clientY
    const move = (ev: PointerEvent) => {
      write(
        clamp(origin.x + ((ev.clientX - x0) / frame.width) * 100, 8, 92),
        clamp(origin.y + ((ev.clientY - y0) / frame.height) * 100, 12, 88),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-black"
      onPointerDown={(event) => {
        if (!onFilterStep) return
        if ((event.target as HTMLElement).closest('[data-sticker]')) return
        swipe.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        const start = swipe.current
        swipe.current = null
        if (!start || !onFilterStep) return
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return
        onFilterStep(dx < 0 ? 1 : -1)
      }}
      onPointerCancel={() => {
        swipe.current = null
      }}
    >
      {mediaUrl && mediaKind === 'video' ? (
        <video
          data-testid="story-media"
          data-filter={filterId || 'none'}
          src={mediaUrl}
          autoPlay
          loop
          muted={videoMuted}
          playsInline
          className={mediaClass}
          style={mediaStyle}
        />
      ) : null}
      {mediaUrl && mediaKind === 'image' ? (
        <img
          data-testid="story-media"
          data-filter={filterId || 'none'}
          src={mediaUrl}
          alt=""
          className={mediaClass}
          style={mediaStyle}
        />
      ) : null}
      {mediaUrl && mediaKind === 'audio' ? (
        <div className="flex h-full items-center justify-center text-white">
          <IconMusic size={42} />
          <audio src={mediaUrl} autoPlay controls className="absolute bottom-28 w-[80%]" />
        </div>
      ) : null}
      {!visual && !mediaUrl && body ? (
        <p className="flex h-full items-center justify-center px-8 text-center text-[28px] font-semibold leading-snug tracking-[0.01em] text-white">
          {body}
        </p>
      ) : null}
      {visual && body ? (
        <p
          data-sticker
          data-testid="story-text"
          data-style={textStyle || 'classic'}
          className={`absolute z-10 max-w-[78%] -translate-x-1/2 -translate-y-1/2 break-words text-center text-[28px] font-semibold leading-snug tracking-[0.01em] ${draggable ? 'cursor-grab touch-none' : ''} ${textStyleClass(textStyle)}`}
          style={{ left: `${textX}%`, top: `${textY}%` }}
          onPointerDown={(event) => drag(event, () => ({ x: textX, y: textY }), onTextMove)}
        >
          {body}
        </p>
      ) : null}
      {placeName ? (
        <div
          data-sticker
          data-testid="story-place"
          className={`glass-pill absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[length:var(--hub-text-sm)] font-medium text-hub-text ${draggable ? 'cursor-grab touch-none' : ''}`}
          style={{ left: `${placeX}%`, top: `${placeY}%` }}
          onPointerDown={(event) => drag(event, () => ({ x: placeX, y: placeY }), onPlaceMove)}
        >
          <IconPin size={16} />
          <span>{placeName}</span>
        </div>
      ) : null}
    </div>
  )
}
