/**
 * Silence is RMS below a threshold for the chosen pause (default 3s).
 * The threshold adapts to the noise of the first 300 ms and never leaves the device.
 */

export type SilenceTracker = {
  push: (rms: number, nowMs: number) => 'silence' | 'level'
  threshold: () => number
  calibrated: () => boolean
}

export function createSilenceTracker(opts: {
  silenceMs: number
  calibrateMs?: number
  minThreshold?: number
  maxThreshold?: number
}): SilenceTracker {
  const calibrateMs = opts.calibrateMs ?? 300
  const minThreshold = opts.minThreshold ?? 0.012
  const maxThreshold = opts.maxThreshold ?? 0.08
  let origin: number | null = null
  let noisePeak = 0
  let threshold = minThreshold
  let calibrated = false
  let silenceStart: number | null = null
  let fired = false

  return {
    threshold: () => threshold,
    calibrated: () => calibrated,
    push(rms, nowMs) {
      if (fired) return 'level'
      if (origin == null) origin = nowMs
      const elapsed = nowMs - origin
      if (!calibrated) {
        if (rms > noisePeak) noisePeak = rms
        if (elapsed >= calibrateMs) {
          calibrated = true
          threshold = Math.min(maxThreshold, Math.max(minThreshold, noisePeak * 1.6))
          silenceStart = null
        }
        return 'level'
      }
      if (rms < threshold) {
        if (silenceStart == null) silenceStart = nowMs
        if (nowMs - silenceStart >= opts.silenceMs) {
          fired = true
          return 'silence'
        }
      } else {
        silenceStart = null
      }
      return 'level'
    },
  }
}

export function rmsOf(samples: ArrayLike<number>): number {
  const n = samples.length
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i += 1) {
    const v = samples[i] ?? 0
    sum += v * v
  }
  return Math.sqrt(sum / n)
}
