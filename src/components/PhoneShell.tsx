import type { ReactNode } from 'react'
import { ToastHost } from './Toast'

interface Props {
  children: ReactNode
}

/**
 * Real devices (≤428px wide): full-bleed 100% × 100dvh — no side letterbox.
 * Wider desktop: centered phone frame (~460×960) with home-indicator + scroll affordance.
 *
 * hub-app-root fills the shell so route views get a definite height.
 * hub-overlay-root is reserved for portals (pointer-events none; children opt in).
 */
export function PhoneShell({ children }: Props) {
  return (
    <div className="phone-shell-outer">
      <div className="phone-shell-inner hub-bg">
        <div className="hub-app-root relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
          {children}
        </div>
        <div
          id="hub-overlay-root"
          className="pointer-events-none absolute inset-0 z-[var(--hub-z-overlay)]"
        />
        <ToastHost />
      </div>
    </div>
  )
}
