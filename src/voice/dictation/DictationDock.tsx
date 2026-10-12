import { useEffect, useRef, useState } from 'react'
import { IconMic } from '../../components/Icons'
import {
  PHASE1_EVENT,
  clearPendingDictation,
  peekPendingDictation,
  phase1OwnsRecognition,
  readDictationFocus,
  registerSurface,
  registerVoiceCapture,
  type PhraseResult,
} from './bridge.ts'
import { startVoiceCapture, type VoiceCaptureHandle } from './capture.ts'
import {
  isPhase2CommandEnabled,
  isVoiceModeOn,
  readVoicePrefs,
  silenceSecondsOf,
  speechRateOf,
  VOICE_PREFS_EVENT,
  type VoicePrefs,
} from './prefs.ts'
import { silenceCaption, SPEECH } from './speech.ts'
import {
  indicatorOf,
  initialSession,
  CONFIRM_MS,
  MIN_VOICE_MS,
  step,
  type DictMessage,
  type Effect,
  type SessionContext,
  type SessionEvent,
  type SessionState,
  type StepResult,
} from './session.ts'

export type DictationDockProps = {
  surface: 'chat' | 'compose'
  messages?: DictMessage[]
  focusedId?: string | null
  replyToId?: string | null
  replyPostId?: string
  composerText?: string
  canSendVoice: boolean
  canMutate: boolean
  onFillComposer?: (text: string) => void
  onSetReply?: (messageId: string | null) => void
  onSendText?: (body: string, replyToId?: string) => Promise<void>
  onPublishText?: (body: string) => Promise<void>
  onSendVoice?: (blob: Blob, durationMs: number, purpose: 'chat' | 'post') => Promise<void>
  onEdit?: (messageId: string, body: string) => Promise<void>
  onDelete?: (messageId: string) => Promise<void>
}

const SHEET_CSS = `
.hub-dictation-sheet{animation:hub-dictation-rise 240ms ease}
.hub-dictation-mic{animation:hub-mic-rise 240ms ease}
@keyframes hub-dictation-rise{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes hub-mic-rise{from{transform:translateY(28px) scale(.86);opacity:.35}to{transform:translateY(0) scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){
  .hub-dictation-sheet,.hub-dictation-mic{animation-duration:80ms}
}
`

let styleInjected = false

function injectStyle() {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const el = document.createElement('style')
  el.setAttribute('data-hub-dictation', '')
  el.textContent = SHEET_CSS
  document.head.appendChild(el)
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return SPEECH.offline
}

function newToken(): string {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `v${time}${rand}`
}

function utter(text: string) {
  const prefs = readVoicePrefs()
  if (prefs.voiceReplies === false) return
  const bridge = window.__HUB_VOICE_PHASE1__
  if (bridge?.speak) {
    bridge.speak(text)
    return
  }
  if (typeof speechSynthesis === 'undefined') return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ru-RU'
  utterance.rate = speechRateOf(prefs)
  speechSynthesis.cancel()
  speechSynthesis.speak(utterance)
}

type RecInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: { results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function recognitionCtor(): (new () => RecInstance) | null {
  const host = window as unknown as {
    SpeechRecognition?: new () => RecInstance
    webkitSpeechRecognition?: new () => RecInstance
  }
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null
}

export function DictationDock(props: DictationDockProps) {
  const propsRef = useRef(props)
  const [prefs, setPrefs] = useState<VoicePrefs>(() => readVoicePrefs())
  const prefsRef = useRef(prefs)
  const [state, setState] = useState<SessionState>(initialSession)
  const stateRef = useRef<SessionState>(initialSession())
  const [level, setLevel] = useState(0)
  const [clock, setClock] = useState(0)
  const [banner, setBanner] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const focusRef = useRef<string | null>(null)
  const blobs = useRef(new Map<string, Blob>())
  const captureRef = useRef<VoiceCaptureHandle | null>(null)
  const genRef = useRef(0)

  const applyRef = useRef<(event: SessionEvent) => StepResult>(() => ({
    state: initialSession(),
    effects: [],
    consumed: false,
    indicator: null,
  }))

  useEffect(() => {
    injectStyle()
  }, [])

  useEffect(() => {
    const sync = () => {
      const next = readVoicePrefs()
      prefsRef.current = next
      setPrefs(next)
    }
    window.addEventListener(VOICE_PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(VOICE_PREFS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    const sync = () => setFocusId(readDictationFocus())
    window.addEventListener('hub-dictation-focus', sync)
    return () => window.removeEventListener('hub-dictation-focus', sync)
  }, [])

  useEffect(() => {
    return () => {
      genRef.current += 1
      captureRef.current?.cancel()
      captureRef.current = null
    }
  }, [])

  const makeCtx = (): SessionContext => {
    const current = propsRef.current
    const prefsNow = prefsRef.current
    return {
      surface: current.surface,
      now: Date.now(),
      silenceSeconds: silenceSecondsOf(prefsNow),
      canSendVoice: current.canSendVoice,
      canMutate: current.canMutate,
      replyPostId: current.replyPostId,
      messages: current.messages ?? [],
      focusedId: focusRef.current ?? current.focusedId,
      replyToId: current.replyToId,
      composerText: current.composerText,
      enabled: (id) => isPhase2CommandEnabled(id, prefsNow),
    }
  }

  async function runEffects(effects: Effect[]) {
    for (const effect of effects) {
      if (effect.type === 'fill-composer') propsRef.current.onFillComposer?.(effect.text)
      else if (effect.type === 'set-reply') propsRef.current.onSetReply?.(effect.messageId)
      else if (effect.type === 'discard-blob') blobs.current.delete(effect.token)
      else if (effect.type === 'cancel-capture') {
        genRef.current += 1
        captureRef.current?.cancel()
        captureRef.current = null
      } else if (effect.type === 'start-capture') {
        const gen = ++genRef.current
        setLevel(0)
        // Let the command recognizer release the microphone before MediaRecorder takes it.
        await new Promise((resolve) => window.setTimeout(resolve, 60))
        if (gen !== genRef.current) continue
        try {
          const handle = await startVoiceCapture({
            silenceMs: effect.silenceMs,
            maxMs: effect.maxMs,
            onLevel: (value) => {
              if (gen === genRef.current) setLevel(value)
            },
            onAutoStop: (reason) => {
              if (gen !== genRef.current) return
              applyRef.current({ type: reason === 'silence' ? 'silence' : 'max-duration' })
            },
          })
          if (gen !== genRef.current) {
            handle.cancel()
            continue
          }
          captureRef.current = handle
        } catch (error) {
          if (gen !== genRef.current) continue
          applyRef.current({ type: 'capture-failed', message: errorText(error) })
        }
      } else if (effect.type === 'stop-capture') {
        const gen = genRef.current
        const handle = captureRef.current
        captureRef.current = null
        if (!handle) {
          applyRef.current({ type: 'captured', durationMs: 0, token: '', tooShort: true })
          continue
        }
        const taken = await handle.stop()
        if (gen !== genRef.current) continue
        const token = newToken()
        blobs.current.set(token, taken.blob)
        applyRef.current({
          type: 'captured',
          durationMs: taken.durationMs,
          token,
          tooShort: taken.durationMs < MIN_VOICE_MS,
        })
      } else if (effect.type === 'send-text') {
        try {
          await propsRef.current.onSendText?.(effect.body, effect.replyToId)
          applyRef.current({ type: 'sent' })
        } catch (error) {
          applyRef.current({ type: 'failed', message: errorText(error) })
        }
      } else if (effect.type === 'publish-text') {
        try {
          await propsRef.current.onPublishText?.(effect.body)
          applyRef.current({ type: 'sent' })
        } catch (error) {
          applyRef.current({ type: 'failed', message: errorText(error) })
        }
      } else if (effect.type === 'send-voice') {
        const blob = blobs.current.get(effect.token)
        const send = propsRef.current.onSendVoice
        if (!blob || !send) {
          applyRef.current({ type: 'failed', message: SPEECH.needServer })
          continue
        }
        try {
          await send(blob, effect.durationMs, effect.purpose)
          applyRef.current({ type: 'sent' })
        } catch (error) {
          applyRef.current({ type: 'failed', message: errorText(error) })
        }
      } else if (effect.type === 'edit') {
        try {
          await propsRef.current.onEdit?.(effect.messageId, effect.body)
          applyRef.current({ type: 'sent' })
        } catch (error) {
          applyRef.current({ type: 'failed', message: errorText(error) })
        }
      } else if (effect.type === 'delete') {
        try {
          await propsRef.current.onDelete?.(effect.messageId)
          applyRef.current({ type: 'sent' })
        } catch (error) {
          applyRef.current({ type: 'failed', message: errorText(error) })
        }
      }
    }
  }

  useEffect(() => {
    propsRef.current = props
    prefsRef.current = prefs
    focusRef.current = focusId
    applyRef.current = (event) => {
      const result = step(stateRef.current, event, makeCtx())
      stateRef.current = result.state
      setState(result.state)
      if (result.speech) setBanner(result.speech)
      window.__HUB_VOICE_PHASE1__?.setIndicator?.(result.indicator)
      for (const effect of result.effects) {
        if (effect.type === 'speak') utter(effect.text)
      }
      void runEffects(result.effects.filter((effect) => effect.type !== 'speak'))
      return result
    }
  })

  useEffect(() => {
    if (!isVoiceModeOn(prefs)) return
    const submit = (phrase: string): PhraseResult => {
      if (!isVoiceModeOn(prefsRef.current)) return { consumed: false, indicator: null }
      const result = applyRef.current({ type: 'phrase', text: phrase })
      return { consumed: result.consumed, speech: result.speech, indicator: result.indicator }
    }
    const unsub = registerSurface({
      surface: props.surface,
      submit,
      snapshot: () => ({
        kind: stateRef.current.kind,
        indicator: indicatorOf(stateRef.current),
        surface: propsRef.current.surface,
      }),
      openCapture: () => applyRef.current({ type: 'arm-record' }),
    })
    const unsubCapture = registerVoiceCapture(props.surface, () => applyRef.current({ type: 'arm-record' }))
    return () => {
      unsub()
      unsubCapture()
    }
  }, [prefs, props.surface])

  useEffect(() => {
    const pending = peekPendingDictation()
    if (!pending || !isVoiceModeOn(readVoicePrefs())) return
    if (pending === 'comment') applyRef.current({ type: 'phrase', text: 'комментарий' })
    if (pending === 'voice-reply') applyRef.current({ type: 'phrase', text: 'запиши ответ' })
    let alive = true
    const clearId = window.setTimeout(() => {
      if (alive) clearPendingDictation()
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(clearId)
    }
  }, [])

  useEffect(() => {
    if (!isVoiceModeOn(prefs) || phase1OwnsRecognition()) return
    if (state.kind === 'recording') return
    const Ctor = recognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'ru-RU'
    rec.continuous = true
    rec.interimResults = false
    let stopped = false
    rec.onresult = (ev) => {
      const list = ev.results
      const last = list[list.length - 1]
      if (!last?.isFinal) return
      const text = last[0]?.transcript ?? ''
      if (text.trim()) applyRef.current({ type: 'phrase', text })
    }
    const start = () => {
      if (stopped || document.visibilityState === 'hidden' || phase1OwnsRecognition()) return
      try {
        rec.start()
      } catch {
        /* already started */
      }
    }
    rec.onend = () => start()
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        try {
          rec.stop()
        } catch {
          /* not started */
        }
      } else start()
    }
    const onPhase1 = () => {
      stopped = true
      try {
        rec.stop()
      } catch {
        /* not started */
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener(PHASE1_EVENT, onPhase1)
    start()
    return () => {
      stopped = true
      rec.onend = null
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener(PHASE1_EVENT, onPhase1)
      try {
        rec.stop()
      } catch {
        /* not started */
      }
    }
  }, [prefs, state.kind])

  useEffect(() => {
    if (state.kind !== 'recording' && state.kind !== 'confirm' && state.kind !== 'preview') return
    const tick = () => setClock(Date.now())
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [state.kind])

  useEffect(() => {
    if (state.kind !== 'confirm') return
    const id = window.setInterval(() => applyRef.current({ type: 'tick' }), 250)
    return () => window.clearInterval(id)
  }, [state.kind])

  useEffect(() => {
    if (state.kind !== 'idle' || !banner) return
    const id = window.setTimeout(() => setBanner(null), 4000)
    return () => window.clearTimeout(id)
  }, [state.kind, banner])

  useEffect(() => {
    const onGesture = (event: Event) => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command
      if (command !== 'stop') return
      if (stateRef.current.kind !== 'recording') return
      applyRef.current({ type: 'button', action: 'cancel' })
    }
    window.addEventListener('hub:gesture-command', onGesture)
    return () => window.removeEventListener('hub:gesture-command', onGesture)
  }, [])

  if (!isVoiceModeOn(prefs)) return null

  const silenceLine = silenceCaption(silenceSecondsOf(prefs))
  const press = (action: Extract<SessionEvent, { type: 'button' }>['action']) => () => {
    applyRef.current({ type: 'button', action })
  }
  const dismiss = (event: { target: EventTarget | null }) => {
    const target = event.target
    if (!(target instanceof Element) || target.closest('button')) return
    applyRef.current({ type: 'button', action: 'cancel' })
  }

  return (
    <div className="shrink-0" data-voice-phase={state.kind}>
      {banner && (state.kind === 'idle' || (state.kind === 'preview' && !banner.startsWith('Запись'))) ? (
        <p className="px-4 pb-1 text-[13px] text-white" role="status">
          {banner}
        </p>
      ) : null}
      {state.kind === 'idle' && props.surface === 'chat' ? (
        <div className="flex justify-end px-3 pb-1">
          <button
            type="button"
            className="hub-circle-btn"
            aria-label="Голосовое"
            onClick={() => applyRef.current({ type: 'arm-record' })}
          >
            <IconMic size={20} strokeWidth={1.35} />
          </button>
        </div>
      ) : null}
      {state.kind === 'dictating' ? (
        <section
          className="hub-dictation-sheet mx-3 mb-2 rounded-[22px] bg-[#1c1c1e] px-4 py-3"
          aria-label="Диктовка"
          onClick={dismiss}
        >
          <p className="text-[13px] text-white" role="status">
            {SPEECH.dictateHint}
          </p>
          <p className="mt-2 min-h-[24px] text-[16px] leading-snug text-white">{state.text || '…'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill onClick={press('done')}>Готово</Pill>
            <Ghost onClick={press('erase')}>Стереть последнее</Ghost>
            <Ghost onClick={press('cancel')}>Отмена</Ghost>
          </div>
        </section>
      ) : null}
      {state.kind === 'recording' ? (
        <section
          className="hub-dictation-sheet mx-3 mb-2 rounded-[22px] bg-[#1c1c1e] px-4 py-3"
          aria-label="Запись голосового"
          data-voice-recording=""
          onClick={dismiss}
        >
          <div className="hub-dictation-mic mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white">
            <IconMic size={22} strokeWidth={1.35} />
          </div>
          <div className="flex items-center gap-2 text-[15px] text-white">
            <span className="h-2 w-2 rounded-full bg-[#ff3040]" aria-hidden />
            <span className="font-medium">Запись</span>
            <span className="tabular-nums text-[#8e8e93]">
              {Math.max(0, Math.floor(((clock > state.startedAt ? clock : state.startedAt) - state.startedAt) / 1000))} с
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className="h-full rounded-full bg-white" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <p className="mt-2 text-[13px] text-[#8e8e93]" role="status">
            {silenceLine}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill onClick={press('stop')}>Стоп</Pill>
            <Ghost onClick={press('cancel')}>Отмена</Ghost>
          </div>
        </section>
      ) : null}
      {state.kind === 'preview' ? (
        <section
          className="hub-dictation-sheet mx-3 mb-2 rounded-[22px] bg-[#1c1c1e] px-4 py-3"
          aria-label="Предпрослушивание голосового"
          onClick={dismiss}
        >
          <div className="hub-dictation-mic mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white">
            <IconMic size={22} strokeWidth={1.35} />
          </div>
          <p className="text-center text-[15px] text-white" role="status">
            Запись {Math.max(1, Math.round(state.durationMs / 1000))} секунд. Отправить или перезаписать?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill onClick={press('send')}>Отправить</Pill>
            <Ghost onClick={press('rerecord')}>Перезаписать</Ghost>
            <Ghost onClick={press('cancel')}>Отмена</Ghost>
          </div>
        </section>
      ) : null}
      {state.kind === 'confirm' ? (
        <section
          className="hub-dictation-sheet mx-3 mb-2 rounded-[22px] bg-[#1c1c1e] px-4 py-3"
          aria-label="Подтверждение"
          onClick={dismiss}
        >
          <p className="text-[15px] text-white" role="status">
            {state.question}
          </p>
          <p className="mt-1 text-[12px] text-[#8e8e93]">
            {Math.max(0, Math.ceil((state.deadline - (clock > 0 ? clock : state.deadline - CONFIRM_MS)) / 1000))} с
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.dangerous ? (
              <Pill onClick={press('yes-danger')}>Да, подтверждаю</Pill>
            ) : (
              <Pill onClick={press('yes')}>Да</Pill>
            )}
            <Ghost onClick={press('no')}>Нет</Ghost>
          </div>
        </section>
      ) : null}
      {state.kind === 'sending' ? (
        <p className="px-4 pb-2 text-[13px] text-[#8e8e93]" role="status">
          Отправляю
        </p>
      ) : null}
    </div>
  )
}

function Pill({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Ghost({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full bg-[#2c2c2e] px-4 py-2 text-[14px] font-semibold text-white"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
