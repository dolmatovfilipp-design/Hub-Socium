import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { registerGestureCommands, registerGestureSpeaker } from '../gestures'
import { browserRecognition, speak, startServerEar, type ServerEar } from '../lib/voice/ear'
import { loadVoicePrefs, VOICE_PREFS_EVENT, type VoicePrefs } from '../lib/voice/prefs'
import { gestureCommandPhrase, routeVoicePhrase, runVoiceContinuation } from '../lib/voice/route'
import { registerVoiceSay } from '../voice/commands/screen'

/**
 * Listening chip. `pointer-events-none` so taps pass through to the page.
 * Voice is additive: buttons, nav, and sheets stay usable while this is on.
 */
export function VoiceHost({ navVisible }: { navVisible: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<VoicePrefs>(() => loadVoicePrefs())
  const [label, setLabel] = useState('Слушаю')
  const pathRef = useRef(location.pathname)
  const navRef = useRef(navigate)
  const speakRef = useRef<(text: string) => void>(() => {})
  const gestureSpeakRef = useRef<(text: string) => void>(() => {})
  const statusRef = useRef<(text: string | null) => void>(() => {})
  const speakingRef = useRef(false)
  pathRef.current = location.pathname
  navRef.current = navigate

  const active = prefs.voiceEnabled && location.pathname.startsWith('/app')

  const utter = (text: string, gated: boolean) => {
    if (!text) return
    setLabel(text)
    if (gated && !loadVoicePrefs().voiceReplies) return
    speakingRef.current = true
    const rate = loadVoicePrefs().speechRate || loadVoicePrefs().rate
    let done = false
    const finish = () => {
      if (done) return
      done = true
      speakingRef.current = false
      setLabel('Слушаю')
    }
    window.setTimeout(finish, Math.min(8000, 600 + text.length * 70))
    speak(text, rate, finish)
  }
  speakRef.current = (text) => utter(text, true)
  gestureSpeakRef.current = (text) => utter(text, false)
  statusRef.current = (text) => {
    if (!text) return
    setLabel(text)
    window.setTimeout(() => setLabel('Слушаю'), 900)
  }

  if (typeof window !== 'undefined') {
    window.__HUB_VOICE_PHASE1__ = active
      ? {
          ownsRecognition: true,
          speak: (text) => speakRef.current(text),
          setIndicator: (next) => {
            if (next) setLabel(next)
          },
        }
      : { ownsRecognition: false }
  }

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<VoicePrefs>).detail
      setPrefs(detail || loadVoicePrefs())
    }
    window.addEventListener(VOICE_PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(VOICE_PREFS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    window.dispatchEvent(new Event('hub-voice-phase1'))
  }, [active])

  useEffect(() => {
    registerGestureSpeaker((text) => gestureSpeakRef.current(text))
    registerVoiceSay((text) => speakRef.current(text))
    return registerGestureCommands((command) => {
      const phrase = gestureCommandPhrase(command, pathRef.current)
      if (!phrase) return false
      void routeVoicePhrase(phrase, {
        path: pathRef.current,
        navigate: (to) => {
          if (typeof to === 'number') navRef.current(to)
          else navRef.current(to)
        },
        speak: (text) => speakRef.current(text),
        status: (text) => statusRef.current(text),
        fromGesture: true,
      })
      return true
    })
  }, [])

  useEffect(() => {
    if (!active) return
    let stopped = false
    let ear: ServerEar | null = null
    let rec: ReturnType<typeof browserRecognition> | null = null

    const take = (raw: string) => {
      const phrase = raw.trim()
      if (!phrase || speakingRef.current) return
      void routeVoicePhrase(phrase, {
        path: pathRef.current,
        navigate: (to) => {
          if (typeof to === 'number') navRef.current(to)
          else navRef.current(to)
        },
        speak: (text) => speakRef.current(text),
        status: (text) => statusRef.current(text),
      })
    }

    const onUtterance = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text
      if (text) take(text)
    }
    const onContinuation = () => {
      void runVoiceContinuation(
        pathRef.current,
        (to) => navRef.current(to),
        (text) => speakRef.current(text),
      )
    }
    window.addEventListener('hub:voice-utterance', onUtterance)
    window.addEventListener('hub:voice-continuation', onContinuation)

    const native = browserRecognition()
    if (native) {
      rec = native
      rec.lang = 'ru-RU'
      rec.continuous = true
      rec.interimResults = false
      rec.onresult = (event) => {
        const last = event.results[event.results.length - 1]
        if (!last?.isFinal) return
        take(last[0]?.transcript || '')
      }
      rec.onerror = (event) => {
        if (event.error === 'not-allowed') setLabel('Нет доступа к микрофону')
      }
      rec.onend = () => {
        if (stopped || speakingRef.current) return
        try {
          rec?.start()
        } catch {
          /* browser already starting */
        }
      }
      try {
        rec.start()
        setLabel('Слушаю')
      } catch {
        setLabel('Не удалось включить микрофон')
      }
    } else {
      void startServerEar(
        take,
        setLabel,
        () => speakingRef.current || document.hidden,
      ).then((started) => {
        if (stopped) {
          started?.stop()
          return
        }
        ear = started
      })
    }

    const onHide = () => {
      if (document.hidden) {
        try {
          rec?.stop()
        } catch {
          /* ignore */
        }
      }
    }
    document.addEventListener('visibilitychange', onHide)

    return () => {
      stopped = true
      window.removeEventListener('hub:voice-utterance', onUtterance)
      window.removeEventListener('hub:voice-continuation', onContinuation)
      document.removeEventListener('visibilitychange', onHide)
      window.speechSynthesis?.cancel()
      try {
        rec?.abort()
      } catch {
        try {
          rec?.stop()
        } catch {
          /* ignore */
        }
      }
      ear?.stop()
    }
  }, [active])

  if (!active) return null

  const bottom = navVisible
    ? 'calc(var(--hub-nav-height) + var(--hub-safe-bottom) + 10px)'
    : 'calc(var(--hub-safe-bottom) + 16px)'

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-[40] flex justify-center px-4"
      style={{ bottom }}
    >
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className="flex max-w-[92%] items-center gap-2 rounded-full border border-white/15 bg-black/85 px-3 py-1.5 text-white shadow-lg"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-white" />
        {prefs.indicator === 'full' ? (
          <span className="truncate text-[13px] leading-tight">{label}</span>
        ) : null}
      </div>
    </div>
  )
}
