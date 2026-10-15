/** Pick a MediaRecorder mime the current browser can actually play back. iOS only records H.264/AAC in MP4. */

const VIDEO_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
]

const AUDIO_CANDIDATES = [
  'audio/mp4',
  'audio/aac',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

function supported(list: string[]): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  return list.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? ''
}

export function videoNoteMime(): string {
  return supported(VIDEO_CANDIDATES)
}

export function voiceMime(): string {
  return supported(AUDIO_CANDIDATES)
}

export function extForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase()
  if (base.includes('mp4') || base.includes('aac') || base.includes('quicktime')) return 'mp4'
  if (base.includes('ogg')) return 'ogg'
  if (base.includes('wav')) return 'wav'
  if (base.includes('mpeg')) return 'mp3'
  return 'webm'
}

export function fileTypeForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase()
  return base || 'application/octet-stream'
}
