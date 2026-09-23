/** S13 — shared skeleton blocks (true-black shimmer). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`hub-skel ${className}`} aria-hidden />
}

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3 px-4 py-4" aria-label="Загрузка">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="hub-card p-4">
          <div className="flex gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-4 py-3" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
