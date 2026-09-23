import { useCallback, useState, type ReactNode } from 'react'
import { useNavigate, useNavigationType } from 'react-router-dom'

export type NavMotionKind = 'push' | 'sheet'

const EXIT_MS = 260

/**
 * Threads-style route motion:
 * - push: slide in from right; dismiss slides out to right
 * - sheet: full-screen slide up; dismiss slides down
 * Tab switches stay instantaneous (no NavMotion).
 */
export function useNavMotion(kind: NavMotionKind) {
  const navigate = useNavigate()
  const navType = useNavigationType()
  const [exiting, setExiting] = useState(false)

  const motionClass = exiting
    ? kind === 'sheet'
      ? 'nav-sheet-exit'
      : 'nav-push-exit'
    : navType === 'POP'
      ? ''
      : kind === 'sheet'
        ? 'nav-sheet-enter'
        : 'nav-push-enter'

  const dismiss = useCallback(
    (to?: string | number) => {
      if (exiting) return
      setExiting(true)
      window.setTimeout(() => {
        if (typeof to === 'number') {
          navigate(to)
        } else if (typeof to === 'string') {
          // Sheets replace so Cancel does not stack history
          navigate(to, { replace: kind === 'sheet' })
        } else {
          navigate(-1)
        }
      }, EXIT_MS)
    },
    [exiting, kind, navigate],
  )

  return { motionClass, dismiss, exiting }
}

export function NavMotion({
  kind,
  children,
  className = '',
}: {
  kind: NavMotionKind
  children: ReactNode
  className?: string
}) {
  const { motionClass } = useNavMotion(kind)
  return (
    <div className={`flex h-full min-h-0 flex-col bg-black ${motionClass} ${className}`.trim()}>
      {children}
    </div>
  )
}
