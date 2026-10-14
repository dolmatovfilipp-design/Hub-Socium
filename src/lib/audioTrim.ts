/** Trim leading and trailing silence from a recorded voice note. Audio never leaves the device. */

export function silenceBounds(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.015,
): { start: number; end: number } {
  let start = 0
  let end = samples.length
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) {
      start = i
      break
    }
  }
  for (let i = samples.length - 1; i >= start; i--) {
    if (Math.abs(samples[i]) >= threshold) {
      end = i + 1
      break
    }
  }
  const pad = Math.floor(sampleRate * 0.04)
  start = Math.max(0, start - pad)
  end = Math.min(samples.length, end + pad)
  if (end - start < Math.floor(sampleRate * 0.2)) {
    return { start: 0, end: samples.length }
  }
  return { start, end }
}

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels
  const rate = buffer.sampleRate
  const frames = buffer.length
  const bytesPer = 2
  const block = channels * bytesPer
  const dataSize = frames * block
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * block, true)
  view.setUint16(32, block, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, dataSize, true)
  const chans: Float32Array[] = []
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c))
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, chans[c][i] || 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return out
}

export async function trimSilence(blob: Blob): Promise<{ blob: Blob; durationMs: number }> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const { start, end } = silenceBounds(decoded.getChannelData(0), decoded.sampleRate)
    const length = Math.max(1, end - start)
    const trimmed = ctx.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate)
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      trimmed.getChannelData(c).set(decoded.getChannelData(c).subarray(start, end))
    }
    return {
      blob: new Blob([encodeWav(trimmed)], { type: 'audio/wav' }),
      durationMs: Math.max(1, Math.round((length / decoded.sampleRate) * 1000)),
    }
  } finally {
    void ctx.close()
  }
}

export const voiceCaptureConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}
