export function HubEmptyState({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[17px] font-bold text-white">{title}</p>
      {subtitle ? (
        <p className="mt-2 max-w-[260px] text-[15px] leading-snug text-[#777]">{subtitle}</p>
      ) : null}
    </div>
  )
}
