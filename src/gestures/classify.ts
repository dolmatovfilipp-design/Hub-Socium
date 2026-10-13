import type { LandmarkPoint } from './types'

export type PoseName = 'palm' | 'fist' | 'thumb-up' | 'thumb-down' | 'unknown'

export type HandReading = {
  pose: PoseName
  accepted: boolean
  confidence: number
  wrist: { x: number; y: number }
  pinchRatio: number
  middleExtended: boolean
}

export type SwipeDirection = 'up' | 'down' | 'left' | 'right'

export type WristSample = { t: number; x: number; y: number }

const WRIST = 0
const THUMB_MCP = 2
const THUMB_TIP = 4
const INDEX_MCP = 5
const INDEX_PIP = 6
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const MIDDLE_PIP = 10
const MIDDLE_TIP = 12
const RING_MCP = 13
const RING_PIP = 14
const RING_TIP = 16
const PINKY_MCP = 17
const PINKY_PIP = 18
const PINKY_TIP = 20

const FINGERS: ReadonlyArray<readonly [number, number, number]> = [
  [INDEX_TIP, INDEX_PIP, INDEX_MCP],
  [MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP],
  [RING_TIP, RING_PIP, RING_MCP],
  [PINKY_TIP, PINKY_PIP, PINKY_MCP],
]

function dist(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function palmSpan(lm: LandmarkPoint[]): number {
  return Math.max(dist(lm[WRIST], lm[MIDDLE_MCP]), 1e-3)
}

function fingerExtended(lm: LandmarkPoint[], tip: number, pip: number): boolean {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.08
}

function thumbExtended(lm: LandmarkPoint[]): boolean {
  return dist(lm[THUMB_TIP], lm[WRIST]) > dist(lm[THUMB_MCP], lm[WRIST]) * 1.15
}

/**
 * Average landmark visibility when the model provides it.
 * Handedness score is only a fallback: it measures left/right, not light.
 */
export function landmarkConfidence(
  landmarks: LandmarkPoint[],
  handednessScore: number,
): number {
  const visibility = landmarks
    .map((point) => point.visibility)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  const presence = landmarks
    .map((point) => point.presence)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  const parts = [handednessScore]
  if (visibility.length) {
    parts.push(visibility.reduce((sum, value) => sum + value, 0) / visibility.length)
  }
  if (presence.length) {
    parts.push(presence.reduce((sum, value) => sum + value, 0) / presence.length)
  }
  return Math.min(...parts)
}

/** Mirror a front-camera frame so "left" matches the hand the person sees. */
export function mirrorLandmarks(landmarks: LandmarkPoint[]): LandmarkPoint[] {
  return landmarks.map((point) => ({ ...point, x: 1 - point.x }))
}

export function classifyHand(
  landmarks: LandmarkPoint[],
  confidence: number,
  minConfidence: number,
): HandReading {
  const empty: HandReading = {
    pose: 'unknown',
    accepted: false,
    confidence,
    wrist: { x: 0.5, y: 0.5 },
    pinchRatio: 1,
    middleExtended: false,
  }
  if (landmarks.length < 21) return empty

  const palm = palmSpan(landmarks)
  const pinchRatio = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / palm
  const middleExtended = fingerExtended(landmarks, MIDDLE_TIP, MIDDLE_PIP)
  const fourExtended = FINGERS.every(([tip, pip]) => fingerExtended(landmarks, tip, pip))
  const fourCurled = FINGERS.every(([tip, pip]) => !fingerExtended(landmarks, tip, pip))
  const thumbOut = thumbExtended(landmarks)
  const thumbUp =
    fourCurled &&
    thumbOut &&
    landmarks[THUMB_TIP].y < landmarks[THUMB_MCP].y - palm * 0.12 &&
    Math.abs(landmarks[THUMB_TIP].y - landmarks[THUMB_MCP].y) >
      Math.abs(landmarks[THUMB_TIP].x - landmarks[THUMB_MCP].x)
  const thumbDown =
    fourCurled &&
    thumbOut &&
    landmarks[THUMB_TIP].y > landmarks[THUMB_MCP].y + palm * 0.12 &&
    Math.abs(landmarks[THUMB_TIP].y - landmarks[THUMB_MCP].y) >
      Math.abs(landmarks[THUMB_TIP].x - landmarks[THUMB_MCP].x)
  const abducted = thumbOut && dist(landmarks[THUMB_TIP], landmarks[INDEX_MCP]) > palm * 0.5

  let pose: PoseName = 'unknown'
  if (fourExtended && abducted && pinchRatio >= 0.45) pose = 'palm'
  else if (thumbUp) pose = 'thumb-up'
  else if (thumbDown) pose = 'thumb-down'
  else if (fourCurled && !thumbUp && !thumbDown) pose = 'fist'

  return {
    pose,
    accepted: confidence >= minConfidence,
    confidence,
    wrist: { x: landmarks[WRIST].x, y: landmarks[WRIST].y },
    pinchRatio,
    middleExtended,
  }
}

/**
 * Wrist travel of at least 12% of the frame inside a 200–500 ms window.
 * The dominant axis must be clearly vertical or horizontal.
 */
export function detectSwipe(samples: WristSample[], now: number): SwipeDirection | null {
  if (samples.length < 2) return null
  const current = samples[samples.length - 1]
  const windowed = samples.filter((sample) => {
    const dt = now - sample.t
    return dt >= 200 && dt <= 500
  })
  if (!windowed.length) return null
  const origin = windowed[0]
  const dx = current.x - origin.x
  const dy = current.y - origin.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const midAt = origin.t + (now - origin.t) / 2
  let mid = samples[0]
  for (const sample of samples) {
    if (Math.abs(sample.t - midAt) < Math.abs(mid.t - midAt)) mid = sample
  }

  if (ady >= 0.12 && ady > adx * 1.2) {
    const midDy = mid.y - origin.y
    if (Math.sign(midDy) !== 0 && Math.sign(midDy) !== Math.sign(dy) && Math.abs(midDy) > 0.02) {
      return null
    }
    return dy < 0 ? 'up' : 'down'
  }
  if (adx >= 0.12 && adx > ady * 1.2) {
    const midDx = mid.x - origin.x
    if (Math.sign(midDx) !== 0 && Math.sign(midDx) !== Math.sign(dx) && Math.abs(midDx) > 0.02) {
      return null
    }
    return dx < 0 ? 'left' : 'right'
  }
  return null
}
