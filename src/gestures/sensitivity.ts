import type { GestureSensitivity } from './types'

/** Confidence gate from spec §6.1. */
export function confidenceThreshold(sensitivity: GestureSensitivity): number {
  if (sensitivity === 'low') return 0.85
  if (sensitivity === 'high') return 0.6
  return 0.72
}

/** Low holds 40% longer, high holds 20% shorter. */
export function holdScale(sensitivity: GestureSensitivity): number {
  if (sensitivity === 'low') return 1.4
  if (sensitivity === 'high') return 0.8
  return 1
}

export function scaledHold(ms: number, sensitivity: GestureSensitivity): number {
  return Math.round(ms * holdScale(sensitivity))
}
