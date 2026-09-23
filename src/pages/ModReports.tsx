import { useEffect, useState } from 'react'
import { apiListModReports, apiResolveModReport, isApiMode, type ModReport } from '../lib/api'
import { useNavMotion } from '../components/NavMotion'
import { IconChevron } from '../components/Icons'

export function ModReports() {
  const { motionClass, dismiss } = useNavMotion('push')
  const [reports, setReports] = useState<ModReport[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isApiMode()) {
        setError('Очередь модерации доступна только в API-режиме')
        setLoading(false)
        return
      }
      try {
        const res = await apiListModReports()
        if (!cancelled) setReports(res.reports ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top relative flex shrink-0 items-center justify-center bg-black px-2 pb-3 pt-2">
        <button
          type="button"
          onClick={() => dismiss('/app/settings')}
          className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
          aria-label="Назад"
        >
          <IconChevron size={22} className="-scale-x-100" />
        </button>
        <h1 className="text-[17px] font-bold text-white">Модерация</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8">
        {loading && <p className="py-10 text-center text-[15px] text-[#777]">Загрузка…</p>}
        {error && <p className="py-6 text-center text-[14px] text-red-400/90">{error}</p>}
        {!loading && !error && reports.length === 0 && (
          <p className="py-10 text-center text-[15px] text-[#777]">Жалоб пока нет</p>
        )}
        {reports.map((r) => (
          <div key={r.id} className="border-b border-white/10 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-[#777]">
                {new Date(r.created_at).toLocaleString('ru-RU')}
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[12px] text-white">
                {r.status}
              </span>
            </div>
            <p className="mt-1 text-[15px] text-white">{r.reason}</p>
            <p className="mt-1 text-[13px] text-[#777]">
              от @{r.reporter || r.reporter_id.slice(0, 8)}
              {r.target ? ` → @${r.target}` : ''}
              {r.post_id ? ` · пост ${r.post_id.slice(0, 8)}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['reviewing', 'resolved', 'rejected'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white active:opacity-70"
                  onClick={() => {
                    void apiResolveModReport(r.id, st)
                      .then(() =>
                        setReports((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, status: st } : x)),
                        ),
                      )
                      .catch(() => {})
                  }}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
