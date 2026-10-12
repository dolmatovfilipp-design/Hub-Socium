import { createSilenceTracker, rmsOf } from './silence.ts'

export type VoiceCaptureHandle = {
  stop: () => Promise<{ blob: Blob; durationMs: number }>
  cancel: () => void
}

/**
 * Records from the microphone. Level and silence stay on the device (AnalyserNode).
 * The blob is not uploaded here.
 */
export async function startVoiceCapture(opts: {
  silenceMs: number
  maxMs: number
  onLevel: (level: number) => void
  onAutoStop: (reason: 'silence' | 'max') => void
}): Promise<VoiceCaptureHandle> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Микрофон недоступен')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    throw new Error('Микрофон недоступен')
  }

  const audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume()
    } catch {
      /* level meter stays quiet */
    }
  }
  const source = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)

  const mime = pickMime()
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
  const chunks: BlobPart[] = []
  rec.ondataavailable = (ev) => {
    if (ev.data.size) chunks.push(ev.data)
  }
  const stopped = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
  })
  const started = Date.now()
  rec.start()

  const tracker = createSilenceTracker({ silenceMs: opts.silenceMs })
  const buf = new Float32Array(analyser.fftSize)
  let closed = false
  let auto = false

  const timer = window.setInterval(() => {
    if (closed) return
    analyser.getFloatTimeDomainData(buf)
    const rms = rmsOf(buf)
    opts.onLevel(Math.max(0, Math.min(1, rms / 0.2)))
    const elapsed = Date.now() - started
    if (elapsed >= opts.maxMs) {
      if (!auto) {
        auto = true
        opts.onAutoStop('max')
      }
      return
    }
    if (tracker.push(rms, elapsed) === 'silence' && !auto) {
      auto = true
      opts.onAutoStop('silence')
    }
  }, 50)

  const release = () => {
    if (closed) return
    closed = true
    window.clearInterval(timer)
    stream.getTracks().forEach((track) => track.stop())
    void audioCtx.close().catch(() => {})
  }

  return {
    cancel() {
      window.clearInterval(timer)
      if (rec.state === 'recording') rec.stop()
      release()
    },
    async stop() {
      window.clearInterval(timer)
      if (rec.state === 'recording') rec.stop()
      const blob = await stopped
      const durationMs = Date.now() - started
      release()
      return { blob, durationMs }
    },
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  return ''
}
