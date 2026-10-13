import { claimGestureCommand, claimVoiceCommand, resetGestureArbiter } from './arbiter'
import { classifyHand, detectSwipe, type HandReading } from './classify'
import { createGestureEngine, stepGestureEngine } from './engine'
import { DEFAULT_GESTURE_PREFS, sanitizeGesturePrefs } from './prefs'
import { scaledHold } from './sensitivity'
import type { GesturePrefs, LandmarkPoint } from './types'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function hand(points: Record<number, [number, number]>): LandmarkPoint[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }))
  for (const [index, point] of Object.entries(points)) {
    landmarks[Number(index)] = { x: point[0], y: point[1] }
  }
  return landmarks
}

const openPalm = hand({
  0: [0.5, 0.8],
  2: [0.4, 0.62],
  4: [0.24, 0.5],
  5: [0.42, 0.56],
  6: [0.4, 0.42],
  8: [0.38, 0.28],
  9: [0.5, 0.55],
  10: [0.5, 0.4],
  12: [0.5, 0.22],
  13: [0.58, 0.56],
  14: [0.6, 0.42],
  16: [0.62, 0.28],
  17: [0.64, 0.58],
  18: [0.66, 0.46],
  20: [0.68, 0.32],
})

const fist = hand({
  0: [0.5, 0.7],
  2: [0.46, 0.64],
  4: [0.48, 0.66],
  5: [0.42, 0.55],
  6: [0.42, 0.48],
  8: [0.44, 0.62],
  9: [0.5, 0.52],
  10: [0.5, 0.44],
  12: [0.5, 0.6],
  13: [0.58, 0.55],
  14: [0.58, 0.48],
  16: [0.56, 0.62],
  17: [0.64, 0.58],
  18: [0.64, 0.5],
  20: [0.62, 0.64],
})

const thumbUp = hand({
  0: [0.5, 0.75],
  2: [0.48, 0.58],
  4: [0.48, 0.32],
  5: [0.42, 0.6],
  6: [0.42, 0.5],
  8: [0.44, 0.68],
  9: [0.5, 0.55],
  10: [0.5, 0.46],
  12: [0.5, 0.66],
  13: [0.58, 0.6],
  14: [0.58, 0.5],
  16: [0.56, 0.68],
  17: [0.64, 0.62],
  18: [0.64, 0.54],
  20: [0.62, 0.7],
})

const thumbDown = hand({
  0: [0.5, 0.45],
  2: [0.48, 0.58],
  4: [0.48, 0.86],
  5: [0.42, 0.62],
  6: [0.42, 0.74],
  8: [0.44, 0.58],
  9: [0.5, 0.62],
  10: [0.5, 0.76],
  12: [0.5, 0.55],
  13: [0.58, 0.62],
  14: [0.58, 0.74],
  16: [0.56, 0.58],
  17: [0.64, 0.64],
  18: [0.64, 0.76],
  20: [0.62, 0.6],
})

function reading(partial: Partial<HandReading>): HandReading {
  return {
    pose: 'unknown',
    accepted: true,
    confidence: 0.9,
    wrist: { x: 0.5, y: 0.5 },
    pinchRatio: 1,
    middleExtended: false,
    ...partial,
  }
}

function prefs(partial: Partial<GesturePrefs> = {}): GesturePrefs {
  return {
    ...DEFAULT_GESTURE_PREFS,
    ...partial,
    enabled: true,
    items: { ...DEFAULT_GESTURE_PREFS.items, ...partial.items },
  }
}

function commandsOf(state: ReturnType<typeof createGestureEngine>, input: Parameters<typeof stepGestureEngine>[1], options: GesturePrefs) {
  return stepGestureEngine(state, input, options).filter((event) => event.type === 'command')
}

const palmPose = classifyHand(openPalm, 0.9, 0.72)
assert(palmPose.pose === 'palm', `open palm classified as ${palmPose.pose}`)
assert(classifyHand(fist, 0.9, 0.72).pose === 'fist', 'fist')
assert(classifyHand(thumbUp, 0.9, 0.72).pose === 'thumb-up', 'thumb up')
const thumbDownPose = classifyHand(thumbDown, 0.9, 0.72)
assert(thumbDownPose.pose === 'thumb-down', `thumb down classified as ${thumbDownPose.pose}`)
assert(classifyHand(openPalm, 0.5, 0.72).accepted === false, 'low confidence is rejected')

const swipeUp = [
  { t: 0, x: 0.5, y: 0.7 },
  { t: 150, x: 0.5, y: 0.6 },
  { t: 300, x: 0.5, y: 0.5 },
]
assert(detectSwipe(swipeUp, 300) === 'up', 'swipe up')
assert(detectSwipe([{ t: 0, x: 0.5, y: 0.7 }, { t: 300, x: 0.52, y: 0.66 }], 300) === null, 'short swipe ignored')
assert(
  detectSwipe([{ t: 0, x: 0.5, y: 0.7 }, { t: 800, x: 0.5, y: 0.4 }], 800) === null,
  'slow swipe ignored',
)
assert(
  detectSwipe([{ t: 0, x: 0.7, y: 0.5 }, { t: 160, x: 0.6, y: 0.5 }, { t: 320, x: 0.5, y: 0.5 }], 320) === 'left',
  'swipe left',
)

const medium = prefs()
let engine = createGestureEngine(0)
stepGestureEngine(engine, { now: 0, reading: reading({ pose: 'palm' }), recording: false, fileDialog: false, hidden: false }, medium)
const activated = stepGestureEngine(
  engine,
  { now: 1200, reading: reading({ pose: 'palm' }), recording: false, fileDialog: false, hidden: false },
  medium,
)
assert(activated.some((event) => event.type === 'speak' && event.text === 'Жесты включены'), 'activation speech')
assert(engine.armed, 'engine armed')

engine = createGestureEngine(0)
engine.armed = true
engine.promptSent = true
stepGestureEngine(engine, { now: 2000, reading: reading({ pose: 'palm' }), recording: false, fileDialog: false, hidden: false }, medium)
const stopped = stepGestureEngine(
  engine,
  { now: 2400, reading: null, recording: false, fileDialog: false, hidden: false },
  medium,
)
assert(stopped.some((event) => event.type === 'command' && event.command === 'stop'), 'short palm stops')

engine = createGestureEngine(0)
engine.armed = true
engine.promptSent = true
stepGestureEngine(engine, { now: 3000, reading: reading({ pose: 'palm' }), recording: false, fileDialog: false, hidden: false }, medium)
const paused = stepGestureEngine(
  engine,
  { now: 4200, reading: reading({ pose: 'palm' }), recording: false, fileDialog: false, hidden: false },
  medium,
)
assert(paused.some((event) => event.type === 'speak' && event.text === 'Жесты на паузе'), 'long palm pauses')
assert(!paused.some((event) => event.type === 'command'), 'long palm is not stop')
assert(!engine.armed, 'paused disarms')

engine = createGestureEngine(0)
engine.armed = true
engine.lastEmitAt = -1000
stepGestureEngine(engine, { now: 0, reading: reading({ pose: 'thumb-up' }), recording: false, fileDialog: false, hidden: false }, medium)
const liked = commandsOf(
  engine,
  { now: 400, reading: reading({ pose: 'thumb-up' }), recording: false, fileDialog: false, hidden: false },
  medium,
)
assert(liked.length === 1 && liked[0].type === 'command' && liked[0].command === 'like', 'thumb up likes')
stepGestureEngine(
  engine,
  { now: 500, reading: reading({ pose: 'fist' }), recording: false, fileDialog: false, hidden: false },
  medium,
)
const blocked = commandsOf(
  engine,
  { now: 900, reading: reading({ pose: 'fist' }), recording: false, fileDialog: false, hidden: false },
  medium,
)
assert(blocked.length === 0, 'cooldown blocks the next gesture')

engine = createGestureEngine(0)
engine.armed = true
engine.lastEmitAt = -1000
stepGestureEngine(engine, { now: 0, reading: reading({ pose: 'thumb-down' }), recording: false, fileDialog: false, hidden: false }, medium)
const unlikeOff = commandsOf(
  engine,
  { now: 400, reading: reading({ pose: 'thumb-down' }), recording: false, fileDialog: false, hidden: false },
  medium,
)
assert(unlikeOff.length === 0, 'thumb down stays off by default')

engine = createGestureEngine(0)
engine.armed = true
stepGestureEngine(engine, { now: 0, reading: reading({ pose: 'palm', wrist: { x: 0.5, y: 0.8 } }), recording: true, fileDialog: false, hidden: false }, medium)
const whileRecording = stepGestureEngine(
  engine,
  { now: 400, reading: null, recording: true, fileDialog: false, hidden: false },
  medium,
)
assert(whileRecording.some((event) => event.type === 'command' && event.command === 'stop'), 'recording keeps palm stop')

const low = prefs({ sensitivity: 'low' })
engine = createGestureEngine(0)
stepGestureEngine(engine, { now: 0, reading: reading({ pose: 'palm' }), recording: false, fileDialog: false, hidden: false }, low)
const notYet = stepGestureEngine(
  engine,
  { now: 1200, reading: reading({ pose: 'palm' }), recording: false, fileDialog: false, hidden: false },
  low,
)
assert(!notYet.some((event) => event.type === 'speak' && event.text === 'Жесты включены'), 'low sensitivity waits longer')
assert(scaledHold(1200, 'low') === 1680, 'low hold scale')

engine = createGestureEngine(0)
engine.armed = true
engine.lastHandAt = 0
const lost = stepGestureEngine(
  engine,
  { now: 60_000, reading: null, recording: false, fileDialog: false, hidden: false },
  medium,
)
assert(lost.some((event) => event.type === 'status' && event.status === 'waiting'), 'minute without a hand disarms')
assert(!engine.armed, 'absence clears activation')

const stored = sanitizeGesturePrefs({ enabled: true, items: { thumbDown: true, palm: false } })
assert(stored.items.thumbDown === true, 'stored thumb down')
assert(stored.items.palm === false, 'stored palm')
assert(stored.items.fist === true, 'missing gesture keeps default')
assert(sanitizeGesturePrefs(null).enabled === false, 'gestures start off')

resetGestureArbiter()
assert(claimGestureCommand(1000, false), 'gesture claims')
assert(!claimVoiceCommand(1500, false), 'later voice in the same second is dropped')
assert(claimVoiceCommand(1600, true), 'voice stop still wins')
assert(!claimGestureCommand(1700, false), 'gesture after stop is dropped')
assert(claimGestureCommand(1800, true), 'palm stop still wins')

console.log('gesture self-check ok')
