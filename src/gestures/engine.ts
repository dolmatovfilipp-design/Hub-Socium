import { detectSwipe, type HandReading, type WristSample } from './classify'
import { scaledHold } from './sensitivity'
import type { GestureCommand, GesturePrefs } from './types'

const ACTIVATION_MS = 1200
const STOP_MS = 280
const THUMB_MS = 400
const FIST_MS = 400
const COOLDOWN_MS = 700
const POOR_MS = 2000
const POOR_EVERY_MS = 60_000
const LOST_HAND_MS = 60_000
const PINCH_CLOSE = 0.42
const PINCH_OPEN = 0.7

export type EngineStatus = 'waiting' | 'active' | 'paused' | 'poor'

export type EngineEvent =
  | { type: 'command'; command: GestureCommand; at: number }
  | { type: 'speak'; text: string }
  | { type: 'status'; status: EngineStatus }

export type EngineState = {
  armed: boolean
  promptSent: boolean
  lastEmitAt: number
  pose: HandReading['pose'] | null
  poseSince: number
  poseLatched: boolean
  pinchPhase: 'open' | 'closed'
  pinchClosedAt: number
  wrists: WristSample[]
  lowSince: number | null
  lastPoorAt: number
  lastHandAt: number | null
}

export type EngineInput = {
  now: number
  reading: HandReading | null
  recording: boolean
  fileDialog: boolean
  hidden: boolean
}

export function createGestureEngine(now = 0): EngineState {
  return {
    armed: false,
    promptSent: false,
    lastEmitAt: now - COOLDOWN_MS,
    pose: null,
    poseSince: now,
    poseLatched: false,
    pinchPhase: 'open',
    pinchClosedAt: 0,
    wrists: [],
    lowSince: null,
    lastPoorAt: now - POOR_EVERY_MS,
    lastHandAt: null,
  }
}

function push<T extends EngineEvent>(events: EngineEvent[], event: T): void {
  events.push(event)
}

function emitCommand(
  state: EngineState,
  events: EngineEvent[],
  command: GestureCommand,
  now: number,
): void {
  state.lastEmitAt = now
  state.wrists = []
  push(events, { type: 'command', command, at: now })
}

function canEmit(state: EngineState, now: number): boolean {
  return now - state.lastEmitAt >= COOLDOWN_MS
}

function rememberPose(state: EngineState, pose: HandReading['pose'], now: number): void {
  if (state.pose !== pose) {
    state.pose = pose
    state.poseSince = now
    state.poseLatched = false
  }
}

/**
 * Temporal gesture rules: activation hold, cooldown, pinch close-then-open,
 * and the sensitivity-scaled holds from the catalogue.
 * Pure: no camera, no DOM, no network.
 */
export function stepGestureEngine(
  state: EngineState,
  input: EngineInput,
  prefs: GesturePrefs,
): EngineEvent[] {
  const events: EngineEvent[] = []
  const { now } = input

  if (input.hidden) {
    if (state.armed) {
      state.armed = false
      state.promptSent = false
      push(events, { type: 'status', status: 'paused' })
    }
    state.pose = null
    state.wrists = []
    state.lowSince = null
    return events
  }

  const reading = input.reading
  const handOk = Boolean(reading?.accepted)

  if (!handOk) {
    if (reading && !reading.accepted) {
      if (state.lowSince == null) state.lowSince = now
      else if (now - state.lowSince >= POOR_MS && now - state.lastPoorAt >= POOR_EVERY_MS) {
        state.lastPoorAt = now
        push(events, { type: 'status', status: 'poor' })
        push(events, {
          type: 'speak',
          text: 'Плохо видно руку. Поверните ладонь к свету и держите её в кадре',
        })
      }
    } else {
      state.lowSince = null
    }

    if (
      prefs.requireActivation &&
      state.armed &&
      state.lastHandAt != null &&
      now - state.lastHandAt >= LOST_HAND_MS
    ) {
      state.armed = false
      state.promptSent = false
      push(events, { type: 'status', status: 'waiting' })
    }

    if (state.pose === 'palm' && !state.poseLatched) {
      releasePalm(state, events, input, prefs, now)
    }
    state.pose = null
    return events
  }

  state.lowSince = null
  state.lastHandAt = now
  const pose = reading!.pose
  const armed = prefs.requireActivation ? state.armed : true

  if (state.pose === 'palm' && pose !== 'palm' && !state.poseLatched) {
    const before = events.length
    releasePalm(state, events, input, prefs, now)
    if (events.length !== before) {
      rememberPose(state, pose, now)
      return events
    }
  }

  if (prefs.requireActivation && !state.armed && !state.promptSent) {
    state.promptSent = true
    push(events, { type: 'status', status: 'waiting' })
    push(events, { type: 'speak', text: 'Подержите открытую ладонь, чтобы включить жесты' })
  }

  rememberPose(state, pose, now)
  const held = now - state.poseSince

  if (pose === 'palm' && !state.poseLatched && held >= scaledHold(ACTIVATION_MS, prefs.sensitivity)) {
    state.poseLatched = true
    state.lastEmitAt = now
    if (prefs.requireActivation && !state.armed) {
      state.armed = true
      push(events, { type: 'status', status: 'active' })
      push(events, { type: 'speak', text: 'Жесты включены' })
    } else if (prefs.requireActivation && state.armed) {
      state.armed = false
      state.promptSent = false
      push(events, { type: 'status', status: 'paused' })
      push(events, { type: 'speak', text: 'Жесты на паузе' })
    } else if (prefs.items.palm && !input.fileDialog) {
      emitCommand(state, events, 'stop', now)
    }
    return events
  }

  if (!armed || input.fileDialog) {
    return events
  }

  if (!prefs.requireActivation && pose === 'palm' && prefs.items.palm && !state.poseLatched) {
    if (held >= scaledHold(STOP_MS, prefs.sensitivity)) {
      state.poseLatched = true
      emitCommand(state, events, 'stop', now)
      return events
    }
  }

  state.wrists.push({ t: now, x: reading!.wrist.x, y: reading!.wrist.y })
  state.wrists = state.wrists.filter((sample) => now - sample.t <= 600)

  const blocked = input.recording
  if (!blocked && canEmit(state, now)) {
    const swipe = detectSwipe(state.wrists, now)
    if (swipe === 'up' && prefs.items.palmUp) {
      emitCommand(state, events, 'next', now)
      state.poseLatched = true
      return events
    }
    if (swipe === 'down' && prefs.items.palmDown) {
      emitCommand(state, events, 'previous', now)
      state.poseLatched = true
      return events
    }
    if (swipe === 'left' && prefs.items.palmLeft) {
      emitCommand(state, events, 'next-tab', now)
      state.poseLatched = true
      return events
    }
    if (swipe === 'right' && prefs.items.palmRight) {
      emitCommand(state, events, 'prev-tab', now)
      state.poseLatched = true
      return events
    }
  }

  if (!blocked && prefs.items.pinch) {
    const pinchClosed = reading!.pinchRatio < PINCH_CLOSE && reading!.middleExtended
    if (pinchClosed && state.pinchPhase === 'open') {
      state.pinchPhase = 'closed'
      state.pinchClosedAt = now
    } else if (
      reading!.pinchRatio > PINCH_OPEN &&
      state.pinchPhase === 'closed' &&
      now - state.pinchClosedAt >= 60 &&
      now - state.pinchClosedAt <= 800 &&
      canEmit(state, now)
    ) {
      state.pinchPhase = 'open'
      emitCommand(state, events, 'open', now)
      return events
    } else if (reading!.pinchRatio > PINCH_OPEN) {
      state.pinchPhase = 'open'
    }
  } else if (reading!.pinchRatio > PINCH_OPEN) {
    state.pinchPhase = 'open'
  }

  if (!blocked && canEmit(state, now) && !state.poseLatched) {
    if (pose === 'thumb-up' && prefs.items.thumbUp && held >= scaledHold(THUMB_MS, prefs.sensitivity)) {
      state.poseLatched = true
      emitCommand(state, events, 'like', now)
      return events
    }
    if (pose === 'thumb-down' && prefs.items.thumbDown && held >= scaledHold(THUMB_MS, prefs.sensitivity)) {
      state.poseLatched = true
      emitCommand(state, events, 'unlike', now)
      return events
    }
    if (pose === 'fist' && prefs.items.fist && held >= scaledHold(FIST_MS, prefs.sensitivity)) {
      state.poseLatched = true
      emitCommand(state, events, 'back', now)
      return events
    }
  }

  return events
}

function releasePalm(
  state: EngineState,
  events: EngineEvent[],
  input: EngineInput,
  prefs: GesturePrefs,
  now: number,
): void {
  if (!prefs.requireActivation || !state.armed || !prefs.items.palm || input.fileDialog) return
  const held = now - state.poseSince
  const min = scaledHold(STOP_MS, prefs.sensitivity)
  const max = scaledHold(ACTIVATION_MS, prefs.sensitivity)
  if (held >= min && held < max && canEmit(state, now)) {
    emitCommand(state, events, 'stop', now)
  }
}
