import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision'
import {
  classifyHand,
  landmarkConfidence,
  mirrorLandmarks,
  type HandReading,
} from './classify'
import { createGestureEngine, stepGestureEngine, type EngineEvent, type EngineState } from './engine'
import { confidenceThreshold } from './sensitivity'
import type { GesturePrefs, LandmarkPoint } from './types'

const WASM_BASE = '/mediapipe/wasm'
const MODEL_PATH = '/models/hand_landmarker.task'

export type LoopHooks = {
  getPrefs: () => GesturePrefs
  getFps: () => number
  setFps: (fps: number) => void
  isRecording: () => boolean
  isFileDialog: () => boolean
  isHidden: () => boolean
  onEvents: (events: EngineEvent[]) => void
  onReady: (engine: EngineState) => void
  onPresence: (accepted: boolean, armed: boolean) => void
  onError: (message: string) => void
}

function pickHand(result: HandLandmarkerResult, previousLabel: string): {
  landmarks: LandmarkPoint[]
  score: number
  label: string
} | null {
  const hands = result.landmarks ?? []
  if (!hands.length) return null
  const handed = result.handedness?.length ? result.handedness : result.handednesses
  let best = 0
  let bestScore = -1
  for (let i = 0; i < hands.length; i++) {
    const score = handed?.[i]?.[0]?.score ?? 0
    const label = handed?.[i]?.[0]?.categoryName ?? String(i)
    const stable = label === previousLabel ? 0.08 : 0
    if (score + stable > bestScore) {
      best = i
      bestScore = score + stable
    }
  }
  return {
    landmarks: hands[best] as LandmarkPoint[],
    score: handed?.[best]?.[0]?.score ?? 0,
    label: handed?.[best]?.[0]?.categoryName ?? String(best),
  }
}

/**
 * Loads the on-device HandLandmarker and reads the local camera element.
 * Frames are never uploaded: the only network use is the same-origin model and wasm.
 */
export async function startHandLoop(
  video: HTMLVideoElement,
  hooks: LoopHooks,
): Promise<{ stop: () => void }> {
  let stopped = false
  let raf = 0
  let landmarker: HandLandmarker | null = null
  const engine = createGestureEngine(performance.now())
  let previousLabel = ''
  let lastTick = 0
  let lastTimestamp = 0
  let slowFrames = 0
  let throttled = false
  let detectFailures = 0

  const stop = () => {
    stopped = true
    cancelAnimationFrame(raf)
    landmarker?.close()
    landmarker = null
  }

  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
    const options = {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' as const },
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, options)
    } catch {
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      })
    }
  } catch {
    hooks.onError('Не удалось подготовить распознавание жестов')
    return { stop }
  }

  if (stopped) {
    stop()
    return { stop }
  }
  hooks.onReady(engine)

  const tick = (time: number) => {
    if (stopped || !landmarker) return
    raf = requestAnimationFrame(tick)
    const fps = hooks.getFps()
    if (time - lastTick < 1000 / fps) return
    lastTick = time
    if (video.readyState < 2) return
    const timestamp = Math.max(lastTimestamp + 1, performance.now())
    lastTimestamp = timestamp
    const started = performance.now()
    let reading: HandReading | null = null
    try {
      const result = landmarker.detectForVideo(video, timestamp)
      const hand = pickHand(result, previousLabel)
      if (hand) {
        previousLabel = hand.label
        const mirrored = mirrorLandmarks(hand.landmarks)
        const prefs = hooks.getPrefs()
        reading = classifyHand(
          mirrored,
          landmarkConfidence(mirrored, hand.score),
          confidenceThreshold(prefs.sensitivity),
        )
      }
    } catch {
      // A single bad frame (timestamp or a not-yet-decoded camera buffer) is not a
      // missing model. Stop only after repeated failures, with the spec phrase.
      detectFailures += 1
      if (detectFailures < 12) return
      hooks.onError('Не удалось подготовить распознавание жестов')
      stop()
      return
    }
    detectFailures = 0
    const spent = performance.now() - started
    if (spent > 90) slowFrames += 1
    else slowFrames = 0
    if (!throttled && slowFrames >= 8 && hooks.getFps() > 10) {
      throttled = true
      hooks.setFps(10)
      hooks.onEvents([
        { type: 'speak', text: 'Частота кадров снижена до 10: устройство не успевает' },
      ])
    }
    const prefs = hooks.getPrefs()
    const events = stepGestureEngine(
      engine,
      {
        now: timestamp,
        reading,
        recording: hooks.isRecording(),
        fileDialog: hooks.isFileDialog(),
        hidden: hooks.isHidden(),
      },
      prefs,
    )
    hooks.onPresence(Boolean(reading?.accepted), engine.armed || !prefs.requireActivation)
    if (events.length) hooks.onEvents(events)
  }

  raf = requestAnimationFrame(tick)
  return { stop }
}
