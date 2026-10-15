import { voiceCaptureConstraints } from './audioTrim'

/** One camera and one microphone grant per tab. Later recordings clone the live tracks. */

type Facing = 'user' | 'environment'

type Held = {
  mic: MediaStream | null
  cam: MediaStream | null
  facing: Facing
}

const held: Held = { mic: null, cam: null, facing: 'user' }
let micFlight: Promise<MediaStream> | null = null
let camFlight: Promise<void> | null = null
let camFlightKey = ''

function liveTracks(stream: MediaStream | null, kind?: 'audio' | 'video'): MediaStreamTrack[] {
  if (!stream) return []
  return stream.getTracks().filter((track) => track.readyState === 'live' && (!kind || track.kind === kind))
}

function cloneTracks(tracks: MediaStreamTrack[]): MediaStream {
  const clones = tracks.map((track) => track.clone())
  if (!clones.length) throw new Error('Нет дорожки')
  return new MediaStream(clones)
}

export async function mediaPermission(name: 'camera' | 'microphone'): Promise<PermissionState | 'prompt'> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName })
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') return status.state
  } catch {
    /* Safari hides camera and microphone from Permissions API until the first grant. */
  }
  if (name === 'microphone' && (liveTracks(held.mic, 'audio').length || liveTracks(held.cam, 'audio').length)) return 'granted'
  if (name === 'camera' && liveTracks(held.cam, 'video').length) return 'granted'
  return 'prompt'
}

export async function sessionMic(): Promise<MediaStream> {
  const fromMic = liveTracks(held.mic, 'audio')
  if (fromMic.length) return cloneTracks(fromMic)
  const fromCam = liveTracks(held.cam, 'audio')
  if (fromCam.length) return cloneTracks(fromCam)
  if (micFlight) {
    const stream = await micFlight
    return cloneTracks(liveTracks(stream, 'audio'))
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Микрофон недоступен')
  micFlight = navigator.mediaDevices.getUserMedia({ audio: voiceCaptureConstraints })
  try {
    const stream = await micFlight
    held.mic = stream
    return cloneTracks(liveTracks(stream, 'audio'))
  } finally {
    micFlight = null
  }
}

export async function sessionCamera(facing: Facing, withAudio: boolean): Promise<MediaStream> {
  const video = liveTracks(held.cam, 'video')
  const sameFacing = held.facing === facing && video.length > 0
  if (sameFacing && !withAudio) return cloneTracks(video)
  if (sameFacing && withAudio) {
    const audio = liveTracks(held.cam, 'audio')
    if (audio.length) return cloneTracks([...video, ...audio])
    const mic = liveTracks(held.mic, 'audio')
    if (mic.length) return cloneTracks([...video, ...mic])
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна')
  const haveMic = liveTracks(held.mic, 'audio').length > 0 || liveTracks(held.cam, 'audio').length > 0
  const askAudio = withAudio && !haveMic
  const flightKey = `${facing}:${askAudio ? 'a' : 'v'}`
  if (!(camFlight && camFlightKey === flightKey)) {
    camFlightKey = flightKey
    camFlight = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 720 } },
        audio: askAudio ? voiceCaptureConstraints : false,
      })
      const previous = held.cam
      held.cam = stream
      held.facing = facing
      if (previous && previous !== stream) {
        if (!liveTracks(held.mic, 'audio').length) {
          const audio = liveTracks(previous, 'audio')
          if (audio.length) held.mic = cloneTracks(audio)
        }
        previous.getTracks().forEach((track) => track.stop())
      }
    })()
  }
  try {
    await camFlight
  } finally {
    if (camFlightKey === flightKey) camFlight = null
  }
  const videoTracks = liveTracks(held.cam, 'video')
  if (!withAudio) return cloneTracks(videoTracks)
  const audioTracks = liveTracks(held.cam, 'audio')
  if (audioTracks.length) return cloneTracks([...videoTracks, ...audioTracks])
  const mic = liveTracks(held.mic, 'audio')
  if (mic.length) return cloneTracks([...videoTracks, ...mic])
  return cloneTracks(videoTracks)
}

export async function setSessionTorch(on: boolean): Promise<boolean> {
  const track = liveTracks(held.cam, 'video')[0]
  if (!track?.applyConstraints) return false
  const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
  if (!caps?.torch) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

/** Stop a clone handed to MediaRecorder. The session stream stays live. */
export function releaseClip(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}
