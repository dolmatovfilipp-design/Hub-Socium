import { useRef, useState } from 'react'

/** Round video note with a drag-to-seek ring. */
export function VideoCirclePlayer({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)

  const seek = (clientX: number, clientY: number, el: HTMLElement) => {
    const video = ref.current
    if (!video || !video.duration) return
    const box = el.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    let angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2
    if (angle < 0) angle += Math.PI * 2
    video.currentTime = (angle / (Math.PI * 2)) * video.duration
  }

  const r = 74
  const c = 2 * Math.PI * r

  return (
    <div className="relative h-40 w-40">
      <video
        ref={ref}
        src={url}
        playsInline
        preload="metadata"
        className="h-40 w-40 rounded-full object-cover"
        onTimeUpdate={() => {
          const video = ref.current
          if (!video || !video.duration) return
          setProgress(video.currentTime / video.duration)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <svg className="pointer-events-none absolute inset-0 h-40 w-40 -rotate-90" viewBox="0 0 160 160" aria-hidden>
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeDasharray={`${c * progress} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <button
        type="button"
        aria-label={playing ? 'Пауза' : 'Смотреть кружок'}
        className="absolute inset-0 rounded-full"
        onClick={() => {
          const video = ref.current
          if (!video) return
          if (video.paused) void video.play()
          else video.pause()
        }}
        onPointerDown={(e) => {
          if (!ref.current?.duration) return
          seek(e.clientX, e.clientY, e.currentTarget)
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1 || !ref.current?.duration) return
          seek(e.clientX, e.clientY, e.currentTarget)
        }}
      />
    </div>
  )
}

export function CirclePreview({
  url,
  onSend,
  onCancel,
}: {
  url: string
  onSend: () => void
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90">
      <VideoCirclePlayer url={url} />
      <div className="mt-6 flex gap-3">
        <button type="button" className="rounded-full bg-[#2c2c2e] px-5 py-2 text-[15px] text-white" onClick={onCancel}>
          Отмена
        </button>
        <button type="button" className="rounded-full bg-white px-5 py-2 text-[15px] font-semibold text-black" onClick={onSend}>
          Отправить
        </button>
      </div>
    </div>
  )
}
