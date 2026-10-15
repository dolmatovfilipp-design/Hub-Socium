export type StoryFacing = 'user' | 'environment'

const PERM_KEY = 'hub_story_camera_perm'
const RELEASE_MS = 600

export class StoryCameraError extends Error {
  readonly reason: 'denied' | 'missing' | 'failed'

  constructor(message: string, reason: 'denied' | 'missing' | 'failed') {
    super(message)
    this.name = 'StoryCameraError'
    this.reason = reason
  }
}

export type OpenedCamera = {
  stream: MediaStream
  facing: StoryFacing
  switched: boolean
}

type TorchCaps = MediaTrackCapabilities & { torch?: boolean }
type TorchSet = MediaTrackConstraintSet & { torch?: boolean }

let stream: MediaStream | null = null
let facing: StoryFacing = 'user'
let permission: 'unknown' | 'granted' | 'denied' = readPerm()
let holds = 0
let stopTimer = 0
let inflight: Promise<OpenedCamera> | null = null

function readPerm(): 'unknown' | 'granted' | 'denied' {
  try {
    const value = sessionStorage.getItem(PERM_KEY)
    if (value === 'granted' || value === 'denied') return value
  } catch {
    /* private mode */
  }
  return 'unknown'
}

function writePerm(value: 'granted' | 'denied') {
  permission = value
  try {
    sessionStorage.setItem(PERM_KEY, value)
  } catch {
    /* ignore */
  }
}

function errorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) return String((err as { name: string }).name)
  return ''
}

function liveStream(): MediaStream | null {
  const video = stream?.getVideoTracks().find((track) => track.readyState === 'live')
  if (!video) {
    stream = null
    return null
  }
  return stream
}

export function storyCameraPermission(): 'unknown' | 'granted' | 'denied' {
  return permission
}

export function storyCameraFacing(): StoryFacing {
  return facing
}

export function storyCameraStream(): MediaStream | null {
  return liveStream()
}

/** Keep the same stream while the camera or the editor is on screen. */
export function retainStoryCamera() {
  holds += 1
  if (stopTimer) {
    window.clearTimeout(stopTimer)
    stopTimer = 0
  }
}

export function releaseStoryCamera() {
  holds = Math.max(0, holds - 1)
  if (holds > 0) return
  stopTimer = window.setTimeout(() => {
    stopTimer = 0
    if (holds !== 0) return
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }, RELEASE_MS)
}

export function setStoryPreviewEnabled(on: boolean) {
  liveStream()?.getVideoTracks().forEach((track) => {
    track.enabled = on
  })
}

export function storyTorchAvailable(target: MediaStream | null = liveStream()): boolean {
  const track = target?.getVideoTracks()[0]
  if (!track || typeof track.getCapabilities !== 'function') return false
  try {
    return !!(track.getCapabilities() as TorchCaps).torch
  } catch {
    return false
  }
}

export async function setStoryTorch(on: boolean, target: MediaStream | null = liveStream()): Promise<boolean> {
  const track = target?.getVideoTracks()[0]
  if (!track?.applyConstraints) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as TorchSet] })
    return true
  } catch {
    return false
  }
}

/**
 * Safari and Yandex Browser on iOS record video/mp4. Chromium prefers webm.
 * An empty string lets the browser pick (Safari then writes mp4).
 */
export function storyVideoMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

export function storyVideoExtension(mime: string): 'mp4' | 'webm' {
  return mime.includes('webm') ? 'webm' : 'mp4'
}

function videoConstraints(next: StoryFacing, exact: boolean): MediaTrackConstraints {
  return {
    facingMode: exact ? { exact: next } : { ideal: next },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  }
}

function denied(err: unknown): boolean {
  const name = errorName(err)
  return name === 'NotAllowedError' || name === 'PermissionDeniedError'
}

async function requestStream(next: StoryFacing, exact: boolean): Promise<MediaStream> {
  const devices = navigator.mediaDevices
  if (!devices?.getUserMedia) {
    throw new StoryCameraError('Камера недоступна в этом браузере', 'missing')
  }
  const video = videoConstraints(next, exact)
  try {
    return await devices.getUserMedia({ video, audio: true })
  } catch (err) {
    if (denied(err)) {
      writePerm('denied')
      throw new StoryCameraError('Нет доступа к камере', 'denied')
    }
    try {
      return await devices.getUserMedia({ video, audio: false })
    } catch (err2) {
      if (denied(err2)) {
        writePerm('denied')
        throw new StoryCameraError('Нет доступа к камере', 'denied')
      }
      if (!exact && (errorName(err2) === 'NotFoundError' || errorName(err2) === 'OverconstrainedError')) {
        try {
          return await devices.getUserMedia({ video: true, audio: false })
        } catch (err3) {
          if (denied(err3)) {
            writePerm('denied')
            throw new StoryCameraError('Нет доступа к камере', 'denied')
          }
          throw new StoryCameraError('Камера не найдена', 'missing')
        }
      }
      throw new StoryCameraError(exact ? 'Не удалось переключить камеру' : 'Не удалось открыть камеру', 'failed')
    }
  }
}

async function openFresh(next: StoryFacing, force: boolean): Promise<OpenedCamera> {
  if (permission === 'denied') {
    throw new StoryCameraError('Нет доступа к камере', 'denied')
  }
  const existing = liveStream()
  if (existing && !force && facing === next) {
    existing.getVideoTracks().forEach((track) => {
      track.enabled = true
    })
    return { stream: existing, facing, switched: true }
  }
  const previous = facing
  if (existing) {
    await setStoryTorch(false, existing)
    existing.getTracks().forEach((track) => track.stop())
    stream = null
  }
  try {
    const opened = await requestStream(next, force)
    stream = opened
    facing = next
    writePerm('granted')
    return { stream: opened, facing, switched: true }
  } catch (err) {
    if (force && previous !== next) {
      try {
        const restored = await requestStream(previous, false)
        stream = restored
        facing = previous
        writePerm('granted')
        return { stream: restored, facing, switched: false }
      } catch {
        /* fall through to the original error */
      }
    }
    throw err
  }
}

/**
 * Ask at most once per tab. A live stream is reused instead of calling getUserMedia again.
 * The first request starts synchronously so iOS Safari / Yandex still treat the tap as the gesture.
 */
export function openStoryCamera(next: StoryFacing, force = false): Promise<OpenedCamera> {
  if (permission === 'denied') {
    return Promise.reject(new StoryCameraError('Нет доступа к камере', 'denied'))
  }
  const existing = inflight ? null : liveStream()
  if (existing && !force && facing === next) {
    existing.getVideoTracks().forEach((track) => {
      track.enabled = true
    })
    return Promise.resolve({ stream: existing, facing, switched: true })
  }
  if (inflight && !force && next === facing) return inflight
  const start = () => {
    const run = openFresh(next, force)
    const wrapped = run.finally(() => {
      if (inflight === wrapped) inflight = null
    })
    inflight = wrapped
    return wrapped
  }
  if (!inflight) return start()
  const queued = inflight.then(start, start)
  inflight = queued
  return queued
}

export function bindPreview(video: HTMLVideoElement, next: MediaStream) {
  if (video.srcObject !== next) video.srcObject = next
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  void video.play().catch(() => {})
}
