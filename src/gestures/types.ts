/** Gesture ids match the catalogue in docs/voice-control-spec.md §10. */

export type GestureId =
  | 'palm'
  | 'thumbUp'
  | 'thumbDown'
  | 'palmUp'
  | 'palmDown'
  | 'palmLeft'
  | 'palmRight'
  | 'pinch'
  | 'fist'

export type GestureSensitivity = 'low' | 'medium' | 'high'

export type GesturePreview = 'off' | 'thumbnail'

export type GestureFps = 10 | 15 | 24

/** Commands a gesture may ask the app to run. Phase 1 owns the real handlers. */
export type GestureCommand =
  | 'stop'
  | 'like'
  | 'unlike'
  | 'next'
  | 'previous'
  | 'next-tab'
  | 'prev-tab'
  | 'open'
  | 'back'

export type GestureToggleMap = Record<GestureId, boolean>

export type GesturePrefs = {
  enabled: boolean
  sensitivity: GestureSensitivity
  preview: GesturePreview
  requireActivation: boolean
  fps: GestureFps
  pauseInBackground: boolean
  items: GestureToggleMap
}

export type GestureUiStatus =
  | 'off'
  | 'need-camera'
  | 'loading'
  | 'waiting'
  | 'active'
  | 'paused'
  | 'poor'
  | 'error'
  | 'call'
  | 'background'

export type LandmarkPoint = { x: number; y: number; z?: number; visibility?: number; presence?: number }
