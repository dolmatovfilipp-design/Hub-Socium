import { apiBaseUrl, getAccessToken, isApiMode } from '../api'

type SpeechRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: SpeechResultEvent) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechResultEvent = {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

export function browserRecognition(): SpeechRec | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec
    webkitSpeechRecognition?: new () => SpeechRec
  }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export function speak(text: string, rate: number, onend?: () => void) {
  const synth = window.speechSynthesis
  if (!text || !synth) {
    onend?.()
    return
  }
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'ru-RU'
  utter.rate = rate
  utter.onend = () => onend?.()
  utter.onerror = () => onend?.()
  synth.speak(utter)
}

export type ServerEar = {
  stop: () => void
}

export async function startServerEar(
  onText: (text: string) => void,
  onStatus: (text: string) => void,
  paused: () => boolean,
): Promise<ServerEar | null> {
  if (!isApiMode() || !getAccessToken()) {
    onStatus('На этом браузере нужен вход через сервер и ключи распознавания')
    return null
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
  } catch {
    onStatus('Нет доступа к микрофону')
    return null
  }
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(ctx.destination)

  const rate = ctx.sampleRate
  let chunks: Float32Array[] = []
  let heard = false
  let silence = 0
  let speakingFrames = 0
  let busy = false
  let closed = false

  const flush = () => {
    if (!chunks.length || busy) {
      chunks = []
      heard = false
      silence = 0
      speakingFrames = 0
      return
    }
    const merged = concatFloat(chunks)
    chunks = []
    heard = false
    silence = 0
    speakingFrames = 0
    if (merged.length < rate * 0.35) return
    const wav = encodeWav(downsample(merged, rate, 16000), 16000)
    busy = true
    onStatus('Распознаю')
    void transcribe(wav)
      .then((text) => {
        if (!closed && text) onText(text)
      })
      .catch((err: Error) => {
        if (!closed) onStatus(err.message || 'Распознавание не настроено')
      })
      .finally(() => {
        busy = false
        if (!closed) onStatus('Слушаю')
      })
  }

  processor.onaudioprocess = (event) => {
    if (closed || paused() || busy) return
    const input = event.inputBuffer.getChannelData(0)
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / input.length)
    const loud = rms > 0.02
    if (loud) {
      heard = true
      silence = 0
      speakingFrames += input.length
      chunks.push(new Float32Array(input))
      if (speakingFrames > rate * 4.5) flush()
      return
    }
    if (!heard) return
    chunks.push(new Float32Array(input))
    silence += input.length
    if (silence > rate * 0.75) flush()
  }

  onStatus('Слушаю')
  return {
    stop: () => {
      closed = true
      processor.disconnect()
      source.disconnect()
      void ctx.close()
      for (const track of stream.getTracks()) track.stop()
    },
  }
}

async function transcribe(wav: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', wav, 'command.wav')
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${apiBaseUrl()}/v1/voice/transcribe`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: form,
  })
  const data = (await res.json().catch(() => null)) as {
    text?: string
    error?: { message?: string; code?: string }
  } | null
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Серверное распознавание не настроено')
  }
  return (data?.text || '').trim()
}

function concatFloat(parts: Float32Array[]): Float32Array {
  const len = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(len)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const len = Math.floor(input.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  writeStr(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(view, 8, 'WAVE')
  writeStr(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

function writeStr(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
