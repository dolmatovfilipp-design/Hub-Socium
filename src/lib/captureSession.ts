import { voiceCaptureConstraints } from './audioTrim'

/** One camera/mic grant per page session. Later takes reuse the live stream. */

export type Facing = 'user' | 'environment'
export type CaptureKind = 'audio' | 'video'

type CameraSlot = { stream: MediaStream; facing: Facing }

const cache: {
  audio: MediaStream | null
  camera: CameraSlot | null
  promptedAudio: boolean
  promptedVideo: boolean
} = {
  audio: null,
  camera: null,
  promptedAudio: false,
  promptedVideo: false,
}

let gumCalls = 0

export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
]

export const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/aac',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

function live(stream: MediaStream | null, kind: 'audio' | 'video'): boolean {
  if (!stream) return false
  const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks()
  return tracks.some((t) => t.readyState === 'live')
}

export function enableStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => {
    t.enabled = true
  })
}

export function disableStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => {
    t.enabled = false
  })
}

export function captureStats() {
  return {
    gumCalls,
    promptedAudio: cache.promptedAudio,
    promptedVideo: cache.promptedVideo,
    audioLive: live(cache.audio, 'audio') || live(cache.camera?.stream ?? null, 'audio'),
    videoLive: live(cache.camera?.stream ?? null, 'video'),
  }
}

function rememberAudio(stream: MediaStream) {
  cache.audio = stream
  cache.promptedAudio = true
}

function rememberCamera(stream: MediaStream, facing: Facing) {
  cache.camera = { stream, facing }
  cache.promptedAudio = true
  cache.promptedVideo = true
}

export function noteCameraFacing(stream: MediaStream, facing: Facing) {
  if (cache.camera?.stream === stream) cache.camera = { stream, facing }
}

async function gum(constraints: MediaStreamConstraints): Promise<MediaStream> {
  gumCalls += 1
  return navigator.mediaDevices.getUserMedia(constraints)
}

/** Microphone only. Reuses the session stream, including audio from an open camera. */
export async function acquireAudio(): Promise<MediaStream> {
  if (live(cache.audio, 'audio')) {
    enableStream(cache.audio)
    return audioOnly(cache.audio!)
  }
  if (cache.camera && live(cache.camera.stream, 'audio')) {
    cache.camera.stream.getAudioTracks().forEach((t) => {
      t.enabled = true
    })
    return audioOnly(cache.camera.stream)
  }
  const stream = await gum({ audio: voiceCaptureConstraints })
  rememberAudio(stream)
  return stream
}

export async function acquireCamera(facing: Facing = 'user'): Promise<MediaStream> {
  const slot = cache.camera
  if (slot && live(slot.stream, 'video') && live(slot.stream, 'audio')) {
    enableStream(slot.stream)
    if (slot.facing !== facing) {
      const flipped = await flipStream(slot.stream, facing)
      rememberCamera(flipped.stream, flipped.facing)
      return flipped.stream
    }
    return slot.stream
  }
  const stream = await gum({
    audio: voiceCaptureConstraints,
    video: {
      facingMode: facing,
      width: { ideal: 720 },
      height: { ideal: 720 },
    },
  })
  rememberCamera(stream, facingFrom(stream, facing))
  return stream
}

export async function flipStream(
  stream: MediaStream,
  next: Facing,
): Promise<{ stream: MediaStream; facing: Facing }> {
  const video = stream.getVideoTracks()[0]
  if (video && video.readyState === 'live') {
    const before = video.getSettings().facingMode
    try {
      await video.applyConstraints({
        facingMode: next,
        width: { ideal: 720 },
        height: { ideal: 720 },
      })
      const after = video.getSettings().facingMode
      const actual: Facing = after === 'environment' || after === 'user' ? after : next
      if (cache.camera?.stream === stream) cache.camera = { stream, facing: actual }
      if (before && after && before === after && before !== next) {
        return { stream, facing: before === 'environment' ? 'environment' : 'user' }
      }
      return { stream, facing: actual }
    } catch {
      /* permission is already granted; a second getUserMedia should not prompt */
    }
  }
  const fresh = await gum({
    audio: voiceCaptureConstraints,
    video: { facingMode: next, width: { ideal: 720 }, height: { ideal: 720 } },
  })
  const facing = facingFrom(fresh, next)
  rememberCamera(fresh, facing)
  return { stream: fresh, facing }
}

function facingFrom(stream: MediaStream, fallback: Facing): Facing {
  const mode = stream.getVideoTracks()[0]?.getSettings().facingMode
  if (mode === 'environment' || mode === 'user') return mode
  return fallback
}

export function audioOnly(stream: MediaStream): MediaStream {
  const out = new MediaStream()
  for (const track of stream.getAudioTracks()) {
    track.enabled = true
    out.addTrack(track)
  }
  return out
}

export function releaseCaptureSession() {
  cache.audio?.getTracks().forEach((t) => t.stop())
  cache.camera?.stream.getTracks().forEach((t) => t.stop())
  cache.audio = null
  cache.camera = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => releaseCaptureSession())
}

export function mimeSupported(mime: string): boolean {
  try {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)
  } catch {
    return false
  }
}

/** Prefer MP4/H.264+AAC for video so iPhone can record and play. Chrome keeps WebM when MP4 is missing. */
export function pickRecorderMime(kind: CaptureKind, isSupported: (mime: string) => boolean = mimeSupported): string {
  const list = kind === 'video' ? VIDEO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES
  for (const mime of list) {
    if (isSupported(mime)) return mime
  }
  return ''
}

export function baseContentType(mime: string, kind: CaptureKind): string {
  const m = mime.toLowerCase()
  if (m.includes('wav')) return 'audio/wav'
  if (m.includes('ogg')) return kind === 'audio' ? 'audio/ogg' : 'video/ogg'
  if (m.includes('webm')) return kind === 'video' ? 'video/webm' : 'audio/webm'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac') || m.includes('avc1') || m.includes('h264')) {
    return kind === 'video' ? 'video/mp4' : 'audio/mp4'
  }
  return kind === 'video' ? 'video/mp4' : 'audio/mp4'
}

export function extForContentType(ct: string, kind: CaptureKind): string {
  if (ct === 'video/mp4') return 'mp4'
  if (ct === 'audio/mp4') return 'm4a'
  if (ct === 'audio/ogg' || ct === 'video/ogg') return 'ogg'
  if (ct === 'audio/wav') return 'wav'
  if (ct.includes('webm')) return 'webm'
  return kind === 'video' ? 'mp4' : 'm4a'
}

export async function sniffContainer(blob: Blob): Promise<'mp4' | 'webm' | 'ogg' | 'wav' | ''> {
  const buf = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  if (buf.length >= 8 && String.fromCharCode(buf[4], buf[5], buf[6], buf[7]) === 'ftyp') return 'mp4'
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  if (buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'ogg'
  if (buf.length >= 4 && String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === 'RIFF') return 'wav'
  return ''
}

export async function buildMediaFile(blob: Blob, kind: CaptureKind, mimeHint: string): Promise<File> {
  const sniffed = await sniffContainer(blob)
  let ct = baseContentType(mimeHint || blob.type, kind)
  if (sniffed === 'mp4') ct = kind === 'video' ? 'video/mp4' : 'audio/mp4'
  else if (sniffed === 'webm') ct = kind === 'video' ? 'video/webm' : 'audio/webm'
  else if (sniffed === 'ogg') ct = 'audio/ogg'
  else if (sniffed === 'wav') ct = 'audio/wav'
  const ext = extForContentType(ct, kind)
  const name = kind === 'video' ? `circle.${ext}` : `voice.${ext}`
  return new File([blob], name, { type: ct })
}

export function openRecorder(stream: MediaStream, kind: CaptureKind): { rec: MediaRecorder; mime: string } {
  const hook = (globalThis as { __hubFakeRecorder?: (stream: MediaStream, kind: CaptureKind) => { rec: MediaRecorder; mime: string } }).__hubFakeRecorder
  if (hook) return hook(stream, kind)
  const mime = pickRecorderMime(kind)
  if (mime) {
    try {
      return { rec: new MediaRecorder(stream, { mimeType: mime }), mime }
    } catch {
      /* the reported mime was a lie; let the browser pick */
    }
  }
  const rec = new MediaRecorder(stream)
  return { rec, mime: rec.mimeType || mime }
}

/** iPhone Safari and Yandex Browser are both WebKit. Desktop Chromium is not. */
export function isWebKitRecorder(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return /AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua)
}

export const MIN_TAKE_MS = 400

/** Wall-clock milliseconds. NaN and Infinity become 0 so they cannot pass a min-duration check by accident. */
export function finiteTakeMs(ms: number, maxMs: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.min(maxMs, Math.max(0, Math.round(ms)))
}

export function createTakeClock(maxMs: number) {
  const startedAt = Date.now()
  let elapsed = 0
  const id = window.setInterval(() => {
    elapsed = finiteTakeMs(Date.now() - startedAt, maxMs)
  }, 100)
  const read = () => {
    elapsed = finiteTakeMs(Math.max(elapsed, Date.now() - startedAt), maxMs)
    return elapsed
  }
  return {
    startedAt,
    read,
    stop() {
      window.clearInterval(id)
      return read()
    },
  }
}

export type TakeClock = ReturnType<typeof createTakeClock>

/**
 * Seconds for the label and the seek bar.
 * The recorder clock wins. iOS media metadata is 0, NaN, or Infinity until a seek,
 * and a decoded mp4 can report a few samples for a long take.
 */
export function takeDurationSec(timerMs: number, media?: HTMLMediaElement | null): number {
  if (Number.isFinite(timerMs) && timerMs > 0) return timerMs / 1000
  const raw = media?.duration
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw !== Infinity) return raw
  return 0.1
}

/** iOS leaves blob duration at Infinity until currentTime is pushed to the end once. */
export function primeMediaDuration(el: HTMLMediaElement) {
  if (el.dataset.hubPrimed === '1') return
  const run = () => {
    if (el.dataset.hubPrimed === '1') return
    if (el.duration !== Infinity) return
    el.dataset.hubPrimed = '1'
    const back = () => {
      el.removeEventListener('timeupdate', back)
      try {
        el.currentTime = 0
      } catch {
        /* not seekable yet */
      }
    }
    el.addEventListener('timeupdate', back)
    try {
      el.currentTime = 1e101
    } catch {
      el.dataset.hubPrimed = ''
    }
  }
  if (el.readyState >= 1) run()
  else el.addEventListener('loadedmetadata', run, { once: true })
}

/**
 * No timeslice. iOS appends MP4 fragments that are not a valid file until the
 * final blob, and stopping tracks before `onstop` drops the moov atom.
 * WebKit also fires `stop` before the last `dataavailable`, so the blob is
 * assembled only after that chunk arrives.
 */
export function recordStream(stream: MediaStream, kind: CaptureKind): {
  rec: MediaRecorder
  mime: string
  stopped: Promise<Blob>
} {
  const { rec, mime } = openRecorder(stream, kind)
  const chunks: BlobPart[] = []
  let stopSeen = false
  let finished = false
  let resolveBlob: (blob: Blob) => void = () => {}
  const stopped = new Promise<Blob>((resolve) => {
    resolveBlob = resolve
  })
  const finish = () => {
    if (finished) return
    finished = true
    resolveBlob(new Blob(chunks, { type: baseContentType(rec.mimeType || mime, kind) }))
  }
  rec.ondataavailable = (ev) => {
    if (ev.data && ev.data.size) chunks.push(ev.data)
    if (stopSeen) finish()
  }
  rec.onstop = () => {
    stopSeen = true
    window.setTimeout(finish, 300)
  }
  rec.start()
  return { rec, mime: rec.mimeType || mime, stopped }
}

export async function finishRecorder(rec: MediaRecorder, stopped: Promise<Blob>): Promise<Blob> {
  if (rec.state === 'recording' || rec.state === 'paused') {
    // requestData() on iOS WebKit can discard the sample table and leave a tiny blob.
    if (!isWebKitRecorder()) {
      try {
        rec.requestData()
      } catch {
        /* Safari throws when requestData is unsupported */
      }
    }
    try {
      rec.stop()
    } catch {
      /* already inactive */
    }
  }
  return stopped
}

export async function capturePoster(video: HTMLVideoElement | null): Promise<Blob | null> {
  if (!video || !video.videoWidth || !video.videoHeight) return null
  const size = 480
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const scale = Math.max(size / video.videoWidth, size / video.videoHeight)
  const dw = video.videoWidth * scale
  const dh = video.videoHeight * scale
  ctx.drawImage(video, (size - dw) / 2, (size - dh) / 2, dw, dh)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.86))
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
