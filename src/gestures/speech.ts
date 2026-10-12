type Speaker = (text: string) => void

let custom: Speaker | null = null

/** Phase 1 can route these phrases through its own speech settings. */
export function registerGestureSpeaker(speaker: Speaker): () => void {
  custom = speaker
  return () => {
    if (custom === speaker) custom = null
  }
}

export function speakGesture(text: string): void {
  if (custom) {
    custom(text)
    return
  }
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ru-RU'
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export function silenceGestureSpeech(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
}
