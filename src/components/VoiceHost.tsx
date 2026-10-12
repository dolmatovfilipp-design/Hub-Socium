import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { browserRecognition, speak, startServerEar, type ServerEar } from '../lib/voice/ear'
import { matchUtterance } from '../lib/voice/match'
import { loadVoicePrefs, VOICE_PREFS_EVENT, saveVoicePrefs, type VoicePrefs } from '../lib/voice/prefs'
import { runVoiceIntent } from '../lib/voice/run'

const YES = new Set(['да', 'отправить'])
const NO = new Set(['нет', 'отмена', 'не надо'])

export function VoiceHost({ navVisible }: { navVisible: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<VoicePrefs>(() => loadVoicePrefs())
  const [label, setLabel] = useState('Слушаю')

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

  const active = prefs.voiceEnabled && location.pathname.startsWith('/app')

  useEffect(() => {
    if (!active) return
    let stopped = false
    let speaking = false
    let pendingOff = false
    let pendingTimer = 0
    let ear: ServerEar | null = null
    let rec: ReturnType<typeof browserRecognition> | null = null

    const say = (text: string) => {
      if (!text) return
      setLabel(text)
      speaking = true
      try {
        rec?.stop()
      } catch {
        /* already stopped */
      }
      speak(text, prefs.rate, () => {
        speaking = false
        if (stopped) return
        setLabel('Слушаю')
        try {
          rec?.start()
        } catch {
          /* start races with onend */
        }
      })
    }

    const take = (raw: string) => {
      const phrase = raw.trim()
      if (!phrase || speaking) return
      const norm = phrase.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
      if (pendingOff) {
        window.clearTimeout(pendingTimer)
        pendingOff = false
        if (YES.has(norm)) {
          saveVoicePrefs({ ...loadVoicePrefs(), voiceEnabled: false })
          say('Голос выключен')
          return
        }
        if (NO.has(norm)) {
          say('Оставила голос включённым')
          return
        }
        say('Скажите да или нет')
        pendingOff = true
        pendingTimer = window.setTimeout(() => {
          pendingOff = false
        }, 8000)
        return
      }
      const intent = matchUtterance(phrase)
      if (intent.type === 'unknown') {
        setLabel('Не разобрала')
        window.setTimeout(() => {
          if (!stopped) setLabel('Слушаю')
        }, 900)
        return
      }
      if (intent.type === 'voice-off') {
        pendingOff = true
        say('Выключить голос?')
        pendingTimer = window.setTimeout(() => {
          pendingOff = false
          if (!stopped) setLabel('Слушаю')
        }, 8000)
        return
      }
      if (intent.type === 'stop') {
        window.speechSynthesis?.cancel()
        speaking = false
        setLabel('Остановила')
        return
      }
      void runVoiceIntent(intent, location.pathname, (to) => {
        if (typeof to === 'number') navigate(to)
        else navigate(to)
      }).then((text) => {
        if (!stopped && text) say(text)
      })
    }

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
        if (stopped || speaking) return
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
      void startServerEar(take, setLabel, () => speaking || document.hidden).then((started) => {
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
      window.clearTimeout(pendingTimer)
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
  }, [active, location.pathname, navigate, prefs.rate])

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
