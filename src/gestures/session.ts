import type { GestureUiStatus } from './types'

type Listener = () => void

let stream: MediaStream | null = null
let resumeWanted = false
let statusSnapshot: { status: GestureUiStatus; detail: string } = { status: 'off', detail: '' }
const streamListeners = new Set<Listener>()
const statusListeners = new Set<Listener>()

function emit(set: Set<Listener>): void {
  for (const listener of set) listener()
}

export function getGestureStream(): MediaStream | null {
  return stream
}

export function subscribeGestureStream(listener: Listener): () => void {
  streamListeners.add(listener)
  return () => streamListeners.delete(listener)
}

function replaceStream(next: MediaStream | null): void {
  if (stream && stream !== next) {
    for (const track of stream.getTracks()) track.stop()
  }
  stream = next
  emit(streamListeners)
}

/** Called from the «Разрешить камеру» click so getUserMedia keeps the user gesture. */
export async function requestGestureCamera(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, message: 'Нет доступа к камере' }
  }
  try {
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    })
    const track = next.getVideoTracks()[0]
    if (track) {
      await track.applyConstraints({ facingMode: 'user', width: 640, height: 480 }).catch(() => {})
    }
    resumeWanted = true
    replaceStream(next)
    return { ok: true }
  } catch {
    return { ok: false, message: 'Нет доступа к камере' }
  }
}

export function stopGestureCamera(): void {
  resumeWanted = false
  replaceStream(null)
}

export function suspendGestureCamera(): void {
  if (!stream) return
  resumeWanted = true
  replaceStream(null)
}

export async function resumeGestureCamera(): Promise<void> {
  if (!resumeWanted || stream) return
  await requestGestureCamera()
}

export function gestureCameraWillResume(): boolean {
  return resumeWanted
}

export function getGestureStatusSnapshot(): { status: GestureUiStatus; detail: string } {
  return statusSnapshot
}

export function subscribeGestureStatus(listener: Listener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function setGestureUiStatus(next: GestureUiStatus, detail = ''): void {
  if (statusSnapshot.status === next && statusSnapshot.detail === detail) return
  statusSnapshot = { status: next, detail }
  emit(statusListeners)
}
