import { useStore } from '../store/useStore'

export function ToastHost() {
  const toasts = useStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-[80] flex flex-col items-center gap-2 px-4"
      style={{ bottom: 'calc(var(--hub-nav-height) + var(--hub-safe-bottom) + 8px)' }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast glass-strong max-w-[90%] rounded-2xl px-4 py-3 text-center text-sm text-hub-silver shadow-lg"
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
