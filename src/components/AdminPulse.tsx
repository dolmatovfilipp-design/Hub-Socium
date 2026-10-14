import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { apiTelemetryAdmin, initTelemetry, trackEvent, type TelemetryAdmin } from '../lib/telemetry'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  })
}

function sourceLabel(source: string): string {
  if (source === 'panic') return 'паника'
  if (source === 'server') return 'сервер'
  return 'клиент'
}

export function TelemetryHost() {
  const location = useLocation()
  const isAdmin = useStore((s) => !!s.users.find((u) => u.id === s.currentUserId)?.isAdmin)

  useEffect(() => {
    initTelemetry()
  }, [])

  useEffect(() => {
    if (!location.pathname) return
    trackEvent('screen_view', location.pathname)
  }, [location.pathname])

  if (!isAdmin || !location.pathname.startsWith('/app')) return null
  return <AdminPulse />
}

function AdminPulse() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<TelemetryAdmin | null>(null)
  const [error, setError] = useState('')
  const [openStack, setOpenStack] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let gone = false
    setError('')
    void apiTelemetryAdmin()
      .then((res) => {
        if (!gone) setData(res)
      })
      .catch(() => {
        if (!gone) setError('Не удалось загрузить сводку')
      })
    return () => {
      gone = true
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        data-testid="admin-telemetry"
        onClick={() => setOpen(true)}
        className="absolute bottom-[5.25rem] right-3 z-[70] rounded-full border border-white/15 bg-[#1c1c1e]/90 px-3 py-2 text-[12px] font-semibold text-white shadow-lg backdrop-blur"
      >
        Сводка
      </button>
      {open ? (
        <div className="absolute inset-0 z-[80] flex items-end bg-black/55" role="presentation" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-labelledby="admin-telemetry-title"
            data-testid="admin-telemetry-sheet"
            className="max-h-[82%] w-full overflow-y-auto rounded-t-[26px] border-t border-white/[0.1] bg-[#111] px-5 pb-[max(20px,var(--hub-safe-bottom))] pt-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-start justify-between gap-3">
              <h2 id="admin-telemetry-title" className="text-[20px] font-bold text-white">
                Сводка
              </h2>
              <button
                type="button"
                aria-label="Закрыть"
                data-testid="admin-telemetry-close"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#aaa]"
              >
                ×
              </button>
            </div>
            {error ? <p className="mt-4 text-sm text-red-400/90">{error}</p> : null}
            {data ? (
              <div className="mt-4 space-y-5 pb-2">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Онлайн" value={data.online} testId="admin-online" />
                  <Stat label="За день" value={data.dau} testId="admin-dau" />
                  <Stat label="Новые" value={data.registrations_today} testId="admin-regs" />
                </div>
                <section>
                  <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#8e8e93]">Воронка</h3>
                  <ul className="mt-2 space-y-1.5" data-testid="admin-funnel">
                    {data.funnel.map((step) => (
                      <li key={step.step} className="flex items-center justify-between text-[14px] text-white">
                        <span>{step.label}</span>
                        <span className="tabular-nums text-[#d1d1d6]">{step.count}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#8e8e93]">Экраны</h3>
                  {data.screens.length === 0 ? (
                    <p className="mt-2 text-sm text-[#8e8e93]">Пока нет просмотров</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5" data-testid="admin-screens">
                      {data.screens.map((screen) => (
                        <li key={screen.route} className="flex items-center justify-between gap-3 text-[14px] text-white">
                          <span className="truncate">{screen.route}</span>
                          <span className="shrink-0 tabular-nums text-[#d1d1d6]">{screen.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#8e8e93]">Ошибки</h3>
                  {data.errors.length === 0 ? (
                    <p className="mt-2 text-sm text-[#8e8e93]">Ошибок нет</p>
                  ) : (
                    <ul className="mt-2 space-y-2" data-testid="admin-errors">
                      {data.errors.map((item) => {
                        const expanded = openStack === item.fingerprint
                        return (
                          <li key={item.fingerprint} className="rounded-2xl bg-white/[0.04] px-3 py-2.5" data-testid="admin-error-row">
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => setOpenStack(expanded ? null : item.fingerprint)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-[14px] leading-snug text-white">{item.message}</p>
                                <span className="shrink-0 tabular-nums text-[13px] text-[#d1d1d6]">×{item.count}</span>
                              </div>
                              <p className="mt-1 text-[12px] text-[#8e8e93]">
                                {sourceLabel(item.source)} · {formatWhen(item.last_seen)}
                                {item.route ? ` · ${item.route}` : ''}
                              </p>
                            </button>
                            {expanded ? (
                              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-[#c7c7cc]">
                                {item.stack || 'Стека нет'}
                                {item.user_id ? `\nПользователь ${item.user_id}` : ''}
                                {item.app_version ? `\nВерсия ${item.app_version}` : ''}
                              </pre>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] px-2 py-3 text-center" data-testid={testId}>
      <div className="text-[20px] font-bold tabular-nums text-white">{value}</div>
      <div className="mt-0.5 text-[11px] text-[#8e8e93]">{label}</div>
    </div>
  )
}
