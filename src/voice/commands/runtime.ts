import type {
  VoiceCommandContext,
  VoiceCommandDefinition,
  VoiceCommandResult,
  VoiceScreen,
  VoiceSession,
  VoiceTurn,
} from './types.ts'
import { CONFIRMATION_TIMEOUT_MS } from './types.ts'

export { CONFIRMATION_TIMEOUT_MS }

const SCREEN_HINT: Record<VoiceScreen, string> = {
  feed: 'дальше',
  post: 'прочитай пост',
  compose: 'диктуй',
  market: 'следующее объявление',
  profile: 'прочитай профиль',
  share: 'копировать ссылку',
  messages: 'открой чат с',
  chat: 'прочитай последнее',
  activity: 'что нового',
  explore: 'найди',
  settings: 'оформление',
  other: 'помощь',
}

const YES_ANSWERS = new Set(['да', 'отправить', 'отправь'])
const NO_ANSWERS = new Set(['нет', 'отмена', 'не надо', 'отмени'])

export function emptySession(): VoiceSession {
  return { pending: null, dictation: null, awaitingSlot: null }
}

/**
 * Lowercase, ё→е, punctuation to spaces. Does not drop words and does not
 * remove a wake word: «хаб лайк» stays two words and will not match «лайк».
 */
export function normalizeUtterance(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»""„]/g, '')
    .replace(/[.,!?;:()[\]{}]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyAnswer(utterance: string): 'dangerous' | 'yes' | 'no' | null {
  const normalized = normalizeUtterance(utterance)
  if (normalized === 'да подтверждаю') return 'dangerous'
  if (YES_ANSWERS.has(normalized)) return 'yes'
  if (NO_ANSWERS.has(normalized)) return 'no'
  return null
}

export type DictationControl = 'commit' | 'send' | 'cancel' | 'stop' | 'erase-last' | 'read' | 'text'

/** Controls that stay live while dictation is open. Everything else is text. */
export function interpretDictation(utterance: string): DictationControl {
  const normalized = normalizeUtterance(utterance)
  if (normalized === 'готово') return 'commit'
  if (normalized === 'отправить' || normalized === 'отправь') return 'send'
  if (NO_ANSWERS.has(normalized)) return 'cancel'
  if (normalized === 'стоп' || normalized === 'хватит' || normalized === 'замолчи') return 'stop'
  if (normalized === 'стереть последнее') return 'erase-last'
  if (normalized === 'прочитай текст') return 'read'
  return 'text'
}

export function screenFromRoute(
  route: string,
  hints?: { marketTab?: boolean },
): VoiceScreen {
  const path = route.split('?')[0].replace(/\/+$/, '') || '/'
  if (path === '/app/compose') return 'compose'
  if (path.startsWith('/app/p/')) return 'post'
  if (path === '/app/profile/edit') return 'other'
  if (/\/followers$/.test(path) || /\/following$/.test(path)) return 'other'
  if (path === '/app/profile' || path.startsWith('/app/profile/') || path.startsWith('/app/u/')) {
    return 'profile'
  }
  if (path === '/app') return hints?.marketTab ? 'market' : 'feed'
  if (path === '/app/messages') return 'messages'
  if (path.startsWith('/app/messages/')) return 'chat'
  if (path === '/app/activity') return 'activity'
  if (path === '/app/explore') return 'explore'
  if (path === '/app/settings') return 'settings'
  return 'other'
}

export function wrongScreen(ctx: VoiceCommandContext): VoiceCommandResult {
  const hint = SCREEN_HINT[ctx.screen]
  return {
    ok: false,
    spoken: `Эта команда здесь не действует. Скажите «${hint}»`,
    code: 'wrong-screen',
  }
}

export function emptyHere(): VoiceCommandResult {
  return { ok: false, spoken: 'Здесь пусто', code: 'empty' }
}

export function said(spoken: string): VoiceCommandResult {
  return { ok: true, spoken, code: 'ok' }
}

export function fail(ctx: VoiceCommandContext, spoken: string): VoiceCommandResult {
  ctx.toast(spoken)
  return { ok: false, spoken, code: 'error' }
}

export function apiOnly(ctx: VoiceCommandContext, spoken: string): VoiceCommandResult {
  ctx.toast(spoken)
  return { ok: false, spoken, code: 'api' }
}

export function askSlot(prompt: string, step: string): VoiceCommandResult {
  return {
    ok: false,
    spoken: prompt,
    code: 'needs-slot',
    needsSlot: { step, prompt },
  }
}

export function isResume(ctx: VoiceCommandContext): boolean {
  return Boolean(ctx.step || ctx.dictationEvent || ctx.confirmation)
}

/**
 * Returns a result when the action must not run yet. Returns null when the
 * user already gave the right confirmation for this step.
 * Dangerous actions accept only «да, подтверждаю».
 */
export function gate(
  ctx: VoiceCommandContext,
  level: 'yes' | 'dangerous',
  prompt: string,
  step: string,
): VoiceCommandResult | null {
  if (ctx.confirmation === 'no') {
    return { ok: false, spoken: 'Отменила', code: 'cancelled' }
  }
  const confirmed =
    level === 'dangerous'
      ? ctx.confirmation === 'dangerous' && ctx.step === step
      : (ctx.confirmation === 'yes' || ctx.confirmation === 'dangerous') && ctx.step === step
  if (confirmed) return null
  return {
    ok: false,
    spoken: prompt,
    code: 'needs-confirmation',
    needsConfirmation: level,
    confirmPrompt: prompt,
    resumeStep: step,
  }
}

export interface VoiceMatch {
  kind: 'matched'
  command: VoiceCommandDefinition
  slot: string
  matchedPhrase: string
}

export type VoiceMatchResult =
  | VoiceMatch
  | { kind: 'none' }
  | { kind: 'disabled'; spoken: string }
  | { kind: 'wrong-screen'; spoken: string }
  | { kind: 'ambiguous'; spoken: string }

function slotAfter(rawUtterance: string, normalizedPhrase: string): string {
  const cleaned = rawUtterance.replace(/\s+/g, ' ').trim()
  const words = cleaned.split(' ')
  const phraseWords = normalizedPhrase.split(' ')
  if (words.length <= phraseWords.length) return ''
  const prefix = words
    .slice(0, phraseWords.length)
    .map((word) => normalizeUtterance(word))
    .join(' ')
  if (prefix !== normalizedPhrase) return ''
  return words.slice(phraseWords.length).join(' ')
}

/**
 * Longest exact phrase wins. Slot commands also accept `phrase + slot`.
 * Two enabled commands of equal length on the same screen ask instead of guessing.
 */
export function matchVoiceCommand(
  commands: readonly VoiceCommandDefinition[],
  utterance: string,
  screen: VoiceScreen,
  isEnabled: (command: VoiceCommandDefinition) => boolean = () => true,
): VoiceMatchResult {
  const normalized = normalizeUtterance(utterance)
  if (!normalized) return { kind: 'none' }

  interface Hit {
    command: VoiceCommandDefinition
    length: number
    slot: string
    phrase: string
  }

  const hits: Hit[] = []
  for (const command of commands) {
    let best: Hit | null = null
    const forms = [...command.phrases, ...command.synonyms]
    for (const raw of forms) {
      const phrase = normalizeUtterance(raw)
      if (!phrase) continue
      let slot = ''
      let matched = false
      if (normalized === phrase) {
        matched = true
      } else if (command.takesSlot && normalized.startsWith(`${phrase} `)) {
        slot = slotAfter(utterance, phrase)
        matched = slot.length > 0
      }
      if (!matched) continue
      if (!best || phrase.length > best.length) {
        best = { command, length: phrase.length, slot, phrase: raw }
      }
    }
    if (best) hits.push(best)
  }

  if (!hits.length) return { kind: 'none' }
  const max = Math.max(...hits.map((hit) => hit.length))
  const top = hits.filter((hit) => hit.length === max)
  const onScreen = top.filter((hit) => hit.command.screens.includes(screen))
  if (!onScreen.length) {
    return {
      kind: 'wrong-screen',
      spoken: `Эта команда здесь не действует. Скажите «${SCREEN_HINT[screen]}»`,
    }
  }
  const enabled = onScreen.filter((hit) => isEnabled(hit.command))
  if (!enabled.length) {
    return { kind: 'disabled', spoken: 'Команда выключена в управлении интерфейсом' }
  }
  if (enabled.length > 1) {
    const first = enabled[0].command.phrases[0]
    const second = enabled[1].command.phrases[0]
    return { kind: 'ambiguous', spoken: `Уточните: «${first}» или «${second}»` }
  }
  const winner = enabled[0]
  return {
    kind: 'matched',
    command: winner.command,
    slot: winner.slot,
    matchedPhrase: winner.phrase,
  }
}

export function registerVoiceCommands(
  ...groups: readonly (readonly VoiceCommandDefinition[])[]
): VoiceCommandDefinition[] {
  const seen = new Set<string>()
  const all: VoiceCommandDefinition[] = []
  for (const group of groups) {
    for (const command of group) {
      if (seen.has(command.id)) {
        throw new Error(`Duplicate voice command ${command.id}`)
      }
      if (command.phrases.length === 0) {
        throw new Error(`Voice command ${command.id} has no phrases`)
      }
      seen.add(command.id)
      all.push(command)
    }
  }
  return all
}

/** Phase 1 calls this when the confirmation question sits for 8 seconds. */
export function confirmationTimedOut(session: VoiceSession): VoiceTurn {
  if (!session.pending && !session.awaitingSlot && !session.dictation) {
    return { ok: false, spoken: '', code: 'idle', session }
  }
  return { ok: false, spoken: 'Отменила', code: 'cancelled', session: emptySession() }
}

function baseContext(
  ctx: VoiceCommandContext,
  patch: Partial<VoiceCommandContext>,
): VoiceCommandContext {
  return {
    ...ctx,
    slot: '',
    matchedPhrase: '',
    step: '',
    confirmation: undefined,
    dictationEvent: undefined,
    dictationText: undefined,
    ...patch,
  }
}

function applyResult(
  command: VoiceCommandDefinition,
  ctx: VoiceCommandContext,
  result: VoiceCommandResult,
): VoiceTurn {
  if (result.startDictation) {
    return {
      ok: result.ok,
      spoken: result.spoken,
      code: result.code ?? 'dictation',
      session: {
        pending: null,
        awaitingSlot: null,
        dictation: {
          commandId: command.id,
          step: result.startDictation.step,
          text: ctx.dictationText ?? '',
        },
      },
    }
  }
  if (result.needsConfirmation) {
    return {
      ok: false,
      spoken: result.spoken,
      code: 'needs-confirmation',
      session: {
        dictation: null,
        awaitingSlot: null,
        pending: {
          commandId: command.id,
          step: result.resumeStep ?? '',
          slot: ctx.slot,
          dictationText: ctx.dictationText,
          confirmation: result.needsConfirmation,
          prompt: result.confirmPrompt ?? result.spoken,
        },
      },
    }
  }
  if (result.needsSlot) {
    return {
      ok: false,
      spoken: result.spoken,
      code: 'needs-slot',
      session: {
        dictation: null,
        pending: null,
        awaitingSlot: {
          commandId: command.id,
          step: result.needsSlot.step,
          prompt: result.needsSlot.prompt,
        },
      },
    }
  }
  return {
    ok: result.ok,
    spoken: result.spoken,
    code: result.code,
    session: emptySession(),
  }
}

function joinDictation(current: string, chunk: string): string {
  const next = chunk.replace(/\s+/g, ' ').trim()
  if (!next) return current
  if (!current) return next
  return `${current} ${next}`
}

function eraseLastWord(current: string): string {
  const words = current.trim().split(/\s+/)
  words.pop()
  return words.join(' ')
}

function findCommand(
  commands: readonly VoiceCommandDefinition[],
  id: string,
): VoiceCommandDefinition | undefined {
  return commands.find((command) => command.id === id)
}

/**
 * Dispatch one finished utterance.
 *
 * Phase 1 speaks `turn.spoken` when voice replies are on, then keeps
 * `turn.session` for the next utterance. This function does not call
 * `ctx.speak`, so the reply is not said twice.
 *
 * While a dangerous question is open, only «да, подтверждаю» runs it.
 * «да» repeats the question. «нет» and «отмена» speak «Отменила».
 */
export async function runVoiceCommand(options: {
  commands: readonly VoiceCommandDefinition[]
  utterance: string
  ctx: VoiceCommandContext
  session?: VoiceSession
  isEnabled?: (command: VoiceCommandDefinition) => boolean
}): Promise<VoiceTurn> {
  const session = options.session ?? emptySession()
  const isEnabled = options.isEnabled ?? (() => true)
  if (!options.ctx.insideApp) {
    return { ok: false, spoken: '', code: 'outside-app', session }
  }

  const invoke = async (
    command: VoiceCommandDefinition,
    patch: Partial<VoiceCommandContext>,
  ): Promise<VoiceTurn> => {
    const ctx = baseContext(options.ctx, patch)
    try {
      const result = await command.handler(ctx)
      return applyResult(command, ctx, result)
    } catch (error) {
      const spoken = error instanceof Error ? error.message : 'Ошибка'
      options.ctx.toast(spoken)
      return { ok: false, spoken, code: 'error', session: emptySession() }
    }
  }

  if (session.dictation) {
    const command = findCommand(options.commands, session.dictation.commandId)
    if (!command) return { ok: false, spoken: 'Отменила', code: 'cancelled', session: emptySession() }
    const control = interpretDictation(options.utterance)
    if (control === 'stop') {
      return { ok: true, spoken: 'Остановила', code: 'stopped', session: emptySession() }
    }
    if (control === 'cancel') {
      return { ok: false, spoken: 'Отменено', code: 'cancelled', session: emptySession() }
    }
    if (control === 'read') {
      const text = session.dictation.text.trim()
      return {
        ok: true,
        spoken: text || 'Текст пуст',
        code: 'read',
        session,
      }
    }
    if (control === 'erase-last' || control === 'text') {
      const text =
        control === 'erase-last'
          ? eraseLastWord(session.dictation.text)
          : joinDictation(session.dictation.text, options.utterance)
      const turn = await invoke(command, {
        dictationEvent: 'append',
        dictationText: text,
        step: session.dictation.step,
        slot: session.dictation ? '' : '',
      })
      if (turn.session.pending || turn.session.awaitingSlot || turn.code === 'needs-confirmation') {
        return turn
      }
      return {
        ok: turn.ok,
        spoken: turn.spoken,
        code: turn.code ?? 'dictation',
        session: {
          pending: null,
          awaitingSlot: null,
          dictation: { commandId: command.id, step: session.dictation.step, text },
        },
      }
    }
    return invoke(command, {
      dictationEvent: control,
      dictationText: session.dictation.text,
      step: session.dictation.step,
    })
  }

  if (session.pending) {
    const answer = classifyAnswer(options.utterance)
    if (answer === 'no') {
      return { ok: false, spoken: 'Отменила', code: 'cancelled', session: emptySession() }
    }
    const accepted =
      session.pending.confirmation === 'dangerous'
        ? answer === 'dangerous'
        : answer === 'yes' || answer === 'dangerous'
    if (!accepted) {
      return {
        ok: false,
        spoken: session.pending.prompt,
        code: 'needs-confirmation',
        session,
      }
    }
    const command = findCommand(options.commands, session.pending.commandId)
    if (!command) return { ok: false, spoken: 'Отменила', code: 'cancelled', session: emptySession() }
    return invoke(command, {
      confirmation: answer === 'dangerous' ? 'dangerous' : 'yes',
      step: session.pending.step,
      slot: session.pending.slot,
      dictationText: session.pending.dictationText,
      matchedPhrase: command.phrases[0],
    })
  }

  if (session.awaitingSlot) {
    const answer = classifyAnswer(options.utterance)
    if (answer === 'no' || interpretDictation(options.utterance) === 'stop') {
      return { ok: false, spoken: 'Отменила', code: 'cancelled', session: emptySession() }
    }
    const matched = matchVoiceCommand(options.commands, options.utterance, options.ctx.screen, isEnabled)
    if (matched.kind === 'matched' && matched.command.id !== session.awaitingSlot.commandId) {
      return invoke(matched.command, { slot: matched.slot, matchedPhrase: matched.matchedPhrase })
    }
    if (matched.kind === 'matched') {
      return invoke(matched.command, {
        slot: matched.slot || options.utterance.replace(/\s+/g, ' ').trim(),
        matchedPhrase: matched.matchedPhrase,
        step: session.awaitingSlot.step,
      })
    }
    const command = findCommand(options.commands, session.awaitingSlot.commandId)
    if (!command) return { ok: false, spoken: 'Отменила', code: 'cancelled', session: emptySession() }
    return invoke(command, {
      slot: options.utterance.replace(/\s+/g, ' ').trim(),
      step: session.awaitingSlot.step,
      matchedPhrase: command.phrases[0],
    })
  }

  const matched = matchVoiceCommand(options.commands, options.utterance, options.ctx.screen, isEnabled)
  if (matched.kind === 'none') {
    return { ok: false, spoken: 'Не разобрала', code: 'unrecognized', session }
  }
  if (matched.kind === 'disabled') {
    return { ok: false, spoken: matched.spoken, code: 'disabled', session }
  }
  if (matched.kind === 'wrong-screen') {
    return { ok: false, spoken: matched.spoken, code: 'wrong-screen', session }
  }
  if (matched.kind === 'ambiguous') {
    return { ok: false, spoken: matched.spoken, code: 'ambiguous', session }
  }
  return invoke(matched.command, {
    slot: matched.slot,
    matchedPhrase: matched.matchedPhrase,
  })
}
