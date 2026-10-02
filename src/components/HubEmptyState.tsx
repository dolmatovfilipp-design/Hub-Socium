import type { ReactNode } from 'react'

export function HubEmptyState({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[17px] font-bold text-hub-text">{title}</p>
      {subtitle ? (
        <p className="mt-2 max-w-[280px] text-[15px] leading-snug text-hub-muted">{subtitle}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
