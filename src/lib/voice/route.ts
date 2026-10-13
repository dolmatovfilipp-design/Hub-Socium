/**
 * One phrase path for the microphone, injected utterances, and gestures.
 * The router never covers the screen, disables controls, or traps focus.
 * Touch keeps working while a phrase is in flight.
 */
import { claimVoiceCommand } from '../../gestures/arbiter.ts'
import type { GestureCommand } from '../../gestures/types.ts'
import { isApiMode } from '../api'
import { useStore } from '../../store/useStore'
import {
  confirmationTimedOut,
  CONFIRMATION_TIMEOUT_MS,
  emptySession,
  matchVoiceCommand,
  phase4VoiceCommands,
  runVoiceCommand,
  screenFromRoute,
  type VoiceCommandDefinition,
} from '../../voice/commands/index.ts'
import { createAppVoiceContext } from '../../voice/commands/appContext.ts'
import {
  cancelPhase4Pending,
  isFileShelfOpen,
  matchPhase4,
  takeVoiceContinuation,
} from '../../voice/commands/screen/index.ts'
import type { VoiceConfirmation as ScreenConfirmation } from '../../voice/commands/screen/types.ts'
import { getDictationSnapshot, planFeedComment, submitPhrase } from '../../voice/dictation/bridge.ts'
import { bindVoicePath, focusedVoicePostId, voiceSurfaces } from '../../voice/surfaces.ts'
import { matchUtterance, normalizePhrase } from './match'
import { loadVoicePrefs, saveVoicePrefs } from './prefs'
import { runVoiceIntent } from './run'

const BUSY = new Set(['recording', 'preview', 'confirm', 'dictating', 'sending'])
const YES = new Set(['да', 'отправить', 'отправь'])
const NO = new Set(['нет', 'отмена', 'не надо', 'отмени'])

export type VoiceTarget =
  | { kind: 'screen'; id: string }
  | { kind: 'feed'; id: string }
  | { kind: 'ambiguous'; spoken: string }
  | { kind: 'disabled'; spoken: string }
  | { kind: 'none' }

type Speak = (text: string) => void
type Status = (text: string) => void

type Waiter =
  | {
      kind: 'confirm'
      level: 'yes' | 'dangerous'
      prompt: string
      resolve: (ok: boolean) => void
      timer: number
    }
  | { kind: 'dictate'; buffer: string; resolve: (text: string | null) => void }
  | { kind: 'off'; timer: number }

let waiter: Waiter | null = null
let feedSession = emptySession()
let feedTimer = 0
let marketTab = false

if (typeof window !== 'undefined') {
  window.addEventListener('hub:voice-feed-tab', (event) => {
    const detail = (event as CustomEvent<string>).detail
    marketTab = detail === 'market' || detail === 'business'
  })
}

function norm(raw: string): string {
  return normalizePhrase(raw)
}

function prefs() {
  return loadVoicePrefs()
}

function feedEnabled(command: VoiceCommandDefinition, fromGesture: boolean): boolean {
  const current = prefs()
  const override = current.commands[command.id]
  if (typeof override === 'boolean') return override
  if (!current.voiceEnabled && !fromGesture) return false
  if (command.inReadingSet || command.preset === 'reading') return true
  if (command.preset === 'publications') return current.preset === 'publish'
  return false
}

function screenEnabled(
  command: { id: string; starter: boolean; group: string },
  fromGesture: boolean,
): boolean {
  const current = prefs()
  const override = current.commands[command.id]
  if (typeof override === 'boolean') return override
  if (!current.voiceEnabled && !fromGesture) return false
  if (command.starter || command.group === 'Общие') return true
  if (current.preset === 'chat' && command.group === 'Чат') return true
  if (current.preset === 'publish' && (command.group === 'Видео' || command.group === 'Чат')) return true
  return false
}

function clearWaiter(): void {
  if (waiter && 'timer' in waiter && waiter.timer) window.clearTimeout(waiter.timer)
  waiter = null
}

/**
 * Screen registry wins when it is the one this pathname owns.
 * A feed match on the wrong screen is ignored so navigation and the other
 * registry can still run. Equal-length different commands ask instead of guessing.
 */
export function chooseVoiceTarget(utterance: string, pathname: string, fromGesture = false): VoiceTarget {
  const screen = screenFromRoute(pathname, { marketTab: pathname === '/app' && marketTab })
  const phase = matchPhase4(utterance, pathname)
  const feed = matchVoiceCommand(phase4VoiceCommands, utterance, screen, (command) =>
    feedEnabled(command, fromGesture),
  )
  const phaseOk = phase.status === 'ok' ? phase : null
  const phaseOn = phaseOk && screenEnabled(phaseOk.command, fromGesture) ? phaseOk : null
  const feedOn = feed.kind === 'matched' ? feed : null

  if (phase.status === 'ambiguous' && !feedOn) return { kind: 'ambiguous', spoken: phase.say }
  if (feed.kind === 'ambiguous' && !phaseOn) return { kind: 'ambiguous', spoken: feed.spoken }

  if (phaseOn && feedOn) {
    const left = norm(phaseOn.match.phrase).length
    const right = norm(feedOn.matchedPhrase).length
    if (left === right && phaseOn.command.id !== feedOn.command.id) {
      return { kind: 'ambiguous', spoken: 'Уточните' }
    }
    if (pathname.startsWith('/app/activity') && phaseOn.command.id === 'A-01') {
      return { kind: 'screen', id: phaseOn.command.id }
    }
    if (pathname.startsWith('/app/clips') && phaseOn.command.id === 'V-03') {
      return { kind: 'screen', id: phaseOn.command.id }
    }
    if (left >= right) return { kind: 'screen', id: phaseOn.command.id }
    return { kind: 'feed', id: feedOn.command.id }
  }
  if (phaseOk && !phaseOn && !feedOn) {
    return { kind: 'disabled', spoken: 'Команда выключена в управлении интерфейсом' }
  }
  if (phaseOn) return { kind: 'screen', id: phaseOn.command.id }
  if (feedOn) return { kind: 'feed', id: feedOn.command.id }
  if (feed.kind === 'disabled') return { kind: 'disabled', spoken: feed.spoken }
  return { kind: 'none' }
}

export function gestureCommandPhrase(command: GestureCommand, path: string): string | null {
  const feedScreen = path === '/app' || path === '/app/'
  const postScreen = path.startsWith('/app/p/')
  if (command === 'stop') return 'стоп'
  if (command === 'back') return 'назад'
  if (command === 'like') {
    if (feedScreen || postScreen || path.startsWith('/app/clips')) return 'лайк'
    return null
  }
  if (command === 'unlike') {
    if (feedScreen || postScreen) return 'убери лайк'
    return null
  }
  if (command === 'next' || command === 'previous') {
    if (!feedScreen || marketTab) return null
    return command === 'next' ? 'дальше' : 'предыдущий'
  }
  return null
}

function armFeedTimer(speak: Speak): void {
  window.clearTimeout(feedTimer)
  feedTimer = 0
  if (!feedSession.pending) return
  feedTimer = window.setTimeout(() => {
    const turn = confirmationTimedOut(feedSession)
    feedSession = turn.session
    if (turn.spoken) speak(turn.spoken)
  }, CONFIRMATION_TIMEOUT_MS)
}

function askConfirm(prompt: string, level: 'yes' | 'dangerous', speak: Speak): Promise<boolean> {
  speak(prompt)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      waiter = null
      speak('Отменила')
      resolve(false)
    }, CONFIRMATION_TIMEOUT_MS)
    waiter = { kind: 'confirm', level, prompt, resolve, timer }
  })
}

function askDictate(prompt: string, speak: Speak): Promise<string | null> {
  speak(prompt)
  return new Promise((resolve) => {
    waiter = { kind: 'dictate', buffer: '', resolve }
  })
}

function consumeWaiter(phrase: string, speak: Speak): void {
  const text = norm(phrase)
  const current = waiter
  if (!current) return
  if (current.kind === 'off') {
    if (YES.has(text)) {
      clearWaiter()
      saveVoicePrefs({ ...loadVoicePrefs(), voiceEnabled: false })
      speak('Голос выключен')
      return
    }
    if (NO.has(text) || text === 'стоп' || text === 'хватит' || text === 'замолчи') {
      clearWaiter()
      speak(text === 'нет' || NO.has(text) ? 'Оставила голос включённым' : 'Остановила')
      return
    }
    speak('Скажите да или нет')
    return
  }
  if (current.kind === 'dictate') {
    if (text === 'готово') {
      const buffer = current.buffer
      clearWaiter()
      current.resolve(buffer)
      return
    }
    if (NO.has(text) || text === 'стоп' || text === 'хватит' || text === 'замолчи') {
      clearWaiter()
      current.resolve(null)
      speak('Отменила')
      return
    }
    current.buffer = current.buffer ? `${current.buffer} ${phrase.trim()}` : phrase.trim()
    return
  }
  if (current.level === 'dangerous') {
    if (text === 'да подтверждаю') {
      clearWaiter()
      current.resolve(true)
      return
    }
    if (NO.has(text)) {
      clearWaiter()
      current.resolve(false)
      speak('Отменила')
      return
    }
    speak(current.prompt)
    window.clearTimeout(current.timer)
    current.timer = window.setTimeout(() => {
      waiter = null
      speak('Отменила')
      current.resolve(false)
    }, CONFIRMATION_TIMEOUT_MS)
    return
  }
  if (YES.has(text) || text === 'да подтверждаю') {
    clearWaiter()
    current.resolve(true)
    return
  }
  if (NO.has(text)) {
    clearWaiter()
    current.resolve(false)
    speak('Отменила')
    return
  }
  speak(current.prompt)
}

async function runScreen(
  utterance: string,
  path: string,
  navigate: (to: string) => void,
  speak: Speak,
  fromGesture: boolean,
): Promise<string> {
  const matched = matchPhase4(utterance, path)
  if (matched.status === 'ambiguous') return matched.say
  if (matched.status !== 'ok') return ''
  if (!screenEnabled(matched.command, fromGesture)) return 'Команда выключена в управлении интерфейсом'
  let grant: ScreenConfirmation | null = null
  if (matched.command.confirmation !== 'none' && !matched.command.confirmInHandler) {
    const accepted = await askConfirm(matched.command.confirmPrompt || matched.command.reply, matched.command.confirmation, speak)
    if (!accepted) return ''
    grant = matched.command.confirmation
  }
  const ctx = createAppVoiceContext({
    getPathname: () => path,
    navigate,
    say: speak,
    confirm: (prompt, kind) => askConfirm(prompt, kind, speak),
    dictate: (prompt) => askDictate(prompt, speak),
    confirmationGranted: matched.command.confirmInHandler ? null : grant,
  })
  const result = await matched.command.handler(ctx, matched.match)
  if (result.navigateTo) navigate(result.navigateTo)
  return result.cancelled ? '' : result.say
}

async function runFeed(
  utterance: string,
  path: string,
  navigate: (to: string) => void,
  speak: Speak,
  fromGesture: boolean,
): Promise<string> {
  const turn = await runVoiceCommand({
    commands: phase4VoiceCommands,
    utterance,
    ctx: {
      route: path,
      screen: screenFromRoute(path, { marketTab: path === '/app' && marketTab }),
      insideApp: path.startsWith('/app'),
      apiMode: isApiMode(),
      slot: '',
      matchedPhrase: '',
      step: '',
      speak,
      navigate,
      toast: (text) => useStore.getState().showToast(text),
      ...voiceSurfaces(),
    },
    session: feedSession,
    isEnabled: (command) => feedEnabled(command, fromGesture),
  })
  feedSession = turn.session
  armFeedTimer(speak)
  if (turn.code === 'wrong-screen' || turn.code === 'unrecognized') return ''
  return turn.spoken
}

export async function routeVoicePhrase(
  raw: string,
  options: {
    path: string
    navigate: (to: string | number) => void
    speak: Speak
    status: Status
    fromGesture?: boolean
  },
): Promise<void> {
  const phrase = raw.trim()
  if (!phrase) return
  const fromGesture = options.fromGesture === true
  if (!fromGesture) {
    const text = norm(phrase)
    const stop = text === 'стоп' || text === 'хватит' || text === 'замолчи'
    if (!claimVoiceCommand(performance.now(), stop)) return
  }
  const { path, speak, status } = options
  const navigate = (to: string | number) => options.navigate(to)
  bindVoicePath(path)

  if (waiter) {
    consumeWaiter(phrase, speak)
    return
  }

  if (isFileShelfOpen()) {
    const shelf = matchPhase4(phrase, path)
    if (shelf.status === 'ok' && shelf.command.priority === 'shelf') {
      const spoken = await runScreen(phrase, path, (to) => navigate(to), speak, fromGesture)
      if (spoken) speak(spoken)
      else status('Слушаю')
      return
    }
  }

  const snapshot = getDictationSnapshot()
  if (BUSY.has(snapshot.kind)) {
    submitPhrase(phrase)
    return
  }

  if (feedSession.pending || feedSession.dictation || feedSession.awaitingSlot) {
    const spoken = await runFeed(phrase, path, (to) => navigate(to), speak, fromGesture)
    if (spoken) speak(spoken)
    else status('Слушаю')
    return
  }

  const screen = screenFromRoute(path, { marketTab: path === '/app' && marketTab })
  if (screen === 'feed' || screen === 'post') {
    const plan = planFeedComment(phrase, focusedVoicePostId(path), loadVoicePrefs())
    if (plan.consumed) {
      if (plan.navigateTo) navigate(plan.navigateTo)
      if (plan.speech) speak(plan.speech)
      else status('Слушаю')
      return
    }
  }

  const dictated = submitPhrase(phrase)
  if (dictated.consumed) return

  const text = norm(phrase)
  if (text === 'отмена' || text === 'не надо') {
    const cleared = cancelPhase4Pending()
    if (cleared || feedSession.pending) {
      feedSession = emptySession()
      window.clearTimeout(feedTimer)
      speak('Отменила')
      return
    }
  }

  const target = chooseVoiceTarget(phrase, path, fromGesture)
  if (target.kind === 'ambiguous' || target.kind === 'disabled') {
    speak(target.spoken)
    return
  }
  if (target.kind === 'screen') {
    const spoken = await runScreen(phrase, path, (to) => navigate(to), speak, fromGesture)
    if (spoken) speak(spoken)
    else status('Слушаю')
    return
  }
  if (target.kind === 'feed') {
    const spoken = await runFeed(phrase, path, (to) => navigate(to), speak, fromGesture)
    if (spoken) speak(spoken)
    else status('Слушаю')
    return
  }

  const intent = matchUtterance(phrase)
  if (intent.type === 'unknown') {
    status('Не разобрала')
    return
  }
  if (intent.type === 'voice-off') {
    speak('Выключить голос?')
    const timer = window.setTimeout(() => {
      if (waiter?.kind === 'off') waiter = null
      status('Слушаю')
    }, CONFIRMATION_TIMEOUT_MS)
    waiter = { kind: 'off', timer }
    return
  }
  if (intent.type === 'stop') {
    window.speechSynthesis?.cancel()
    speak('Остановила')
    return
  }
  const line = await runVoiceIntent(intent, path, navigate)
  if (line) speak(line)
  else status('Слушаю')
}

export async function runVoiceContinuation(
  path: string,
  navigate: (to: string) => void,
  speak: Speak,
): Promise<void> {
  const next = takeVoiceContinuation()
  if (!next) return
  bindVoicePath(path)
  const ctx = createAppVoiceContext({
    getPathname: () => path,
    navigate,
    say: speak,
    confirm: (prompt, kind) => askConfirm(prompt, kind, speak),
    dictate: (prompt) => askDictate(prompt, speak),
    confirmationGranted: null,
  })
  const result = await next(ctx)
  if (result.navigateTo) navigate(result.navigateTo)
  if (result.say) speak(result.say)
}
