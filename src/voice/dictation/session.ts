/**
 * Phase 2 session. Pure: no microphone, no upload, no navigation.
 * Voice files are uploaded only when an effect of type `send-voice` is emitted.
 * On the preview the question is already «Отправить или перезаписать?»,
 * so «отправить» / «да» emit send-voice. Text reply, comment and edit
 * open a separate confirmation and send only after «да» or «отправить».
 * Delete waits for «да, подтверждаю». There is no wake word.
 */

import {
  CANCEL_RECORDING_PHRASE,
  isCancelPhrase,
  isDangerPhrase,
  isDonePhrase,
  isErasePhrase,
  isNoPhrase,
  isReadPhrase,
  isRerecordPhrase,
  isSendPhrase,
  isStopPhrase,
  isYesPhrase,
  matchCatalog,
  normalizePhrase,
} from './commands.ts'
import { SPEECH, previewSpeech } from './speech.ts'

export const MIN_VOICE_MS = 400
export const CONFIRM_MS = 8000
export const CHAT_MAX_MS = 120_000
export const POST_MAX_MS = 60_000

export type DictMessage = {
  id: string
  mine: boolean
  text: string
  media: boolean
}

export type DictationMode = 'reply' | 'edit' | 'comment'
export type CapturePurpose = 'chat' | 'post'

export type Pending =
  | { type: 'send-text'; body: string; replyToId?: string }
  | { type: 'publish-text'; body: string }
  | { type: 'send-voice'; purpose: CapturePurpose; durationMs: number; token: string }
  | { type: 'edit'; messageId: string; body: string }
  | { type: 'delete'; messageId: string }

export type ActiveState =
  | { kind: 'idle' }
  | {
      kind: 'dictating'
      mode: DictationMode
      text: string
      editMessageId?: string
      replyToId?: string
    }
  | { kind: 'recording'; purpose: CapturePurpose; startedAt: number; stopping: boolean }
  | { kind: 'preview'; purpose: CapturePurpose; durationMs: number; token: string }

export type SessionState =
  | ActiveState
  | {
      kind: 'confirm'
      question: string
      dangerous: boolean
      deadline: number
      pending: Pending
      previous: ActiveState
    }
  | { kind: 'sending'; pending: Pending; previous: ActiveState }

export type Effect =
  | { type: 'speak'; text: string }
  | { type: 'start-capture'; purpose: CapturePurpose; maxMs: number; silenceMs: number }
  | { type: 'stop-capture' }
  | { type: 'cancel-capture' }
  | { type: 'discard-blob'; token: string }
  | { type: 'send-text'; body: string; replyToId?: string }
  | { type: 'publish-text'; body: string }
  | { type: 'send-voice'; purpose: CapturePurpose; durationMs: number; token: string }
  | { type: 'edit'; messageId: string; body: string }
  | { type: 'delete'; messageId: string }
  | { type: 'set-reply'; messageId: string | null }
  | { type: 'fill-composer'; text: string }

export type SessionEvent =
  | { type: 'phrase'; text: string }
  | {
      type: 'button'
      action: 'stop' | 'send' | 'rerecord' | 'cancel' | 'done' | 'erase' | 'yes' | 'no' | 'yes-danger'
    }
  | { type: 'arm-record' }
  | { type: 'silence' }
  | { type: 'max-duration' }
  | { type: 'captured'; durationMs: number; token: string; tooShort?: boolean }
  | { type: 'capture-failed'; message: string }
  | { type: 'tick' }
  | { type: 'sent' }
  | { type: 'failed'; message: string }

export type SessionContext = {
  surface: 'chat' | 'compose'
  now: number
  silenceSeconds: number
  canSendVoice: boolean
  canMutate: boolean
  replyPostId?: string
  messages: DictMessage[]
  focusedId?: string | null
  replyToId?: string | null
  composerText?: string
  enabled: (id: string) => boolean
}

export type StepResult = {
  state: SessionState
  effects: Effect[]
  consumed: boolean
  speech?: string
  indicator: string | null
}

export function initialSession(): SessionState {
  return { kind: 'idle' }
}

export function indicatorOf(state: SessionState): string | null {
  switch (state.kind) {
    case 'dictating':
      return SPEECH.dictateHint
    case 'recording':
      return SPEECH.recordingLabel
    case 'preview':
      return SPEECH.previewChoice
    case 'confirm':
      return state.question
    case 'sending':
      return 'Отправляю'
    default:
      return null
  }
}

function finish(state: SessionState, effects: Effect[], consumed: boolean, speech?: string): StepResult {
  const next = speech ? [...effects, { type: 'speak' as const, text: speech }] : effects
  return { state, effects: next, consumed, speech, indicator: indicatorOf(state) }
}

function pass(state: SessionState): StepResult {
  return { state, effects: [], consumed: false, indicator: indicatorOf(state) }
}

function hold(state: SessionState, speech?: string): StepResult {
  return finish(state, [], true, speech)
}

function lastOwn(messages: DictMessage[]): DictMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.mine) return message
  }
  return null
}

function focusedMessage(ctx: SessionContext): DictMessage | null {
  if (ctx.focusedId) {
    const found = ctx.messages.find((m) => m.id === ctx.focusedId)
    if (found) return found
  }
  return ctx.messages[ctx.messages.length - 1] ?? null
}

function appendText(current: string, addition: string): string {
  const piece = addition.trim()
  if (!piece) return current
  return current ? `${current} ${piece}` : piece
}

function eraseLast(current: string): string {
  const parts = current.trim().split(/\s+/).filter(Boolean)
  parts.pop()
  return parts.join(' ')
}

function startCapture(purpose: CapturePurpose, ctx: SessionContext, speech: string, effects: Effect[] = []): StepResult {
  const state: ActiveState = { kind: 'recording', purpose, startedAt: ctx.now, stopping: false }
  return finish(
    state,
    [
      ...effects,
      {
        type: 'start-capture',
        purpose,
        maxMs: purpose === 'chat' ? CHAT_MAX_MS : POST_MAX_MS,
        silenceMs: Math.round(ctx.silenceSeconds * 1000),
      },
    ],
    true,
    speech,
  )
}

function beginDictation(
  mode: DictationMode,
  speech: string,
  fields: { editMessageId?: string; replyToId?: string },
  effects: Effect[] = [],
): StepResult {
  const state: ActiveState = { kind: 'dictating', mode, text: '', ...fields }
  return finish(state, [...effects, { type: 'fill-composer', text: '' }], true, speech)
}

function beginConfirm(
  previous: ActiveState,
  question: string,
  dangerous: boolean,
  pending: Pending,
  now: number,
): StepResult {
  return finish(
    { kind: 'confirm', question, dangerous, deadline: now + CONFIRM_MS, pending, previous },
    [],
    true,
    question,
  )
}

function wrong(state: SessionState, hint?: string): StepResult {
  const speech = hint ? `${SPEECH.wrongScreen}. ${hint}` : SPEECH.wrongScreen
  return hold(state, speech)
}

function execute(pending: Pending, previous: ActiveState): StepResult {
  const sending: SessionState = { kind: 'sending', pending, previous }
  switch (pending.type) {
    case 'send-text':
      return finish(
        sending,
        [
          { type: 'send-text', body: pending.body, replyToId: pending.replyToId },
          { type: 'fill-composer', text: '' },
        ],
        true,
      )
    case 'publish-text':
      return finish(
        sending,
        [
          { type: 'publish-text', body: pending.body },
          { type: 'fill-composer', text: '' },
        ],
        true,
      )
    case 'send-voice':
      return finish(
        sending,
        [{ type: 'send-voice', purpose: pending.purpose, durationMs: pending.durationMs, token: pending.token }],
        true,
      )
    case 'edit':
      return finish(
        sending,
        [
          { type: 'edit', messageId: pending.messageId, body: pending.body },
          { type: 'fill-composer', text: '' },
        ],
        true,
      )
    case 'delete':
      return finish(sending, [{ type: 'delete', messageId: pending.messageId }], true)
    default:
      return finish(previous, [], true)
  }
}

function confirmDraft(state: Extract<ActiveState, { kind: 'dictating' }>, ctx: SessionContext): StepResult {
  const body = state.text.trim()
  if (!body) return hold(state, SPEECH.nothingToSend)
  if (state.mode === 'comment') {
    return beginConfirm(state, SPEECH.publishQuestion, false, { type: 'publish-text', body }, ctx.now)
  }
  if (state.mode === 'edit') {
    if (!state.editMessageId) return hold(state, SPEECH.nothingToSend)
    return beginConfirm(
      state,
      SPEECH.editQuestion,
      false,
      { type: 'edit', messageId: state.editMessageId, body },
      ctx.now,
    )
  }
  return beginConfirm(
    state,
    SPEECH.sendQuestion,
    false,
    { type: 'send-text', body, replyToId: state.replyToId },
    ctx.now,
  )
}

function trySendPreview(state: Extract<ActiveState, { kind: 'preview' }>, ctx: SessionContext): StepResult {
  if (state.purpose === 'chat' && !ctx.canSendVoice) return hold(state, SPEECH.needServer)
  return execute(
    { type: 'send-voice', purpose: state.purpose, durationMs: state.durationMs, token: state.token },
    state,
  )
}

function rerecord(state: ActiveState, ctx: SessionContext): StepResult {
  const purpose: CapturePurpose = state.kind === 'recording' || state.kind === 'preview' ? state.purpose : 'chat'
  const discard: Effect[] = []
  if (state.kind === 'preview') discard.push({ type: 'discard-blob', token: state.token })
  if (state.kind === 'recording') discard.push({ type: 'cancel-capture' })
  return startCapture(purpose, ctx, SPEECH.rerecord, discard)
}

function discardRecording(state: ActiveState, speech: string): StepResult {
  const effects: Effect[] = []
  if (state.kind === 'recording') effects.push({ type: 'cancel-capture' })
  if (state.kind === 'preview') effects.push({ type: 'discard-blob', token: state.token })
  return finish({ kind: 'idle' }, effects, true, speech)
}

function requestStop(state: Extract<ActiveState, { kind: 'recording' }>): StepResult {
  if (state.stopping) return hold(state)
  return finish({ ...state, stopping: true }, [{ type: 'stop-capture' }], true)
}

function onDictationPhrase(state: Extract<ActiveState, { kind: 'dictating' }>, norm: string, raw: string, ctx: SessionContext): StepResult {
  if (isDonePhrase(norm) || isSendPhrase(norm)) return confirmDraft(state, ctx)
  if (isCancelPhrase(norm)) return finish({ kind: 'idle' }, [{ type: 'fill-composer', text: '' }], true, SPEECH.cancelled)
  if (isStopPhrase(norm)) return finish({ kind: 'idle' }, [{ type: 'fill-composer', text: state.text }], true, SPEECH.stopped)
  if (isErasePhrase(norm)) {
    return finish({ ...state, text: eraseLast(state.text) }, [], true)
  }
  if (isReadPhrase(norm)) return hold(state, state.text.trim() ? state.text.trim() : SPEECH.nothingToSend)
  return finish({ ...state, text: appendText(state.text, raw) }, [], true)
}

function onRecordingPhrase(state: Extract<ActiveState, { kind: 'recording' }>, norm: string, ctx: SessionContext): StepResult {
  if (isStopPhrase(norm)) return requestStop(state)
  if (norm === CANCEL_RECORDING_PHRASE) return discardRecording(state, SPEECH.recordingDeleted)
  if (isCancelPhrase(norm)) return discardRecording(state, SPEECH.cancelled)
  if (isRerecordPhrase(norm)) return rerecord(state, ctx)
  return hold(state)
}

function onPreviewPhrase(state: Extract<ActiveState, { kind: 'preview' }>, norm: string, ctx: SessionContext): StepResult {
  if (isSendPhrase(norm) || isYesPhrase(norm)) return trySendPreview(state, ctx)
  if (isRerecordPhrase(norm)) return rerecord(state, ctx)
  if (norm === CANCEL_RECORDING_PHRASE) return discardRecording(state, SPEECH.recordingDeleted)
  if (isCancelPhrase(norm)) return discardRecording(state, SPEECH.cancelled)
  if (isStopPhrase(norm)) return hold(state, SPEECH.stopped)
  return hold(state)
}

function onConfirmPhrase(state: Extract<SessionState, { kind: 'confirm' }>, norm: string): StepResult {
  if (state.dangerous) {
    if (isDangerPhrase(norm)) return execute(state.pending, state.previous)
    if (isNoPhrase(norm)) return finish(state.previous, [], true, SPEECH.cancelled)
    if (isYesPhrase(norm)) return hold(state, SPEECH.confirmDangerHint)
    return hold(state)
  }
  if (isYesPhrase(norm) || isSendPhrase(norm)) return execute(state.pending, state.previous)
  if (isNoPhrase(norm)) return finish(state.previous, [], true, SPEECH.cancelled)
  return hold(state)
}

function disabled(state: SessionState): StepResult {
  return hold(state, SPEECH.disabled)
}

function handleCommand(state: ActiveState, id: string, ctx: SessionContext): StepResult {
  switch (id) {
    case 'C-06':
      if (ctx.surface !== 'chat') return wrong(state, 'Скажите: комментарий')
      return beginDictation('reply', SPEECH.dictateReply, { replyToId: ctx.replyToId ?? undefined })
    case 'C-37': {
      if (ctx.surface !== 'chat') return wrong(state, 'Скажите: комментарий')
      const message = focusedMessage(ctx)
      if (!message) return hold(state, ctx.messages.length ? SPEECH.notYoursEdit : SPEECH.empty)
      return beginDictation('reply', SPEECH.replyToThis, { replyToId: message.id }, [
        { type: 'set-reply', messageId: message.id },
      ])
    }
    case 'C-07':
      if (ctx.surface !== 'chat') return wrong(state, 'Скажите: голосовой ответ')
      return startCapture('chat', ctx, SPEECH.record)
    case 'C-08': {
      if (state.kind === 'preview') return trySendPreview(state, ctx)
      if (state.kind === 'dictating') return confirmDraft(state, ctx)
      const body = (ctx.composerText ?? '').trim()
      if (!body) return hold(state, SPEECH.nothingToSend)
      if (ctx.surface === 'compose') {
        if (!ctx.replyPostId) return wrong(state)
        return beginConfirm({ kind: 'idle' }, SPEECH.publishQuestion, false, { type: 'publish-text', body }, ctx.now)
      }
      return beginConfirm(
        { kind: 'idle' },
        SPEECH.sendQuestion,
        false,
        { type: 'send-text', body, replyToId: ctx.replyToId ?? undefined },
        ctx.now,
      )
    }
    case 'C-09':
      if (state.kind === 'preview' || state.kind === 'recording') return rerecord(state, ctx)
      return hold(state, SPEECH.needPreview)
    case 'C-10':
      if (state.kind === 'preview' || state.kind === 'recording') return discardRecording(state, SPEECH.recordingDeleted)
      return hold(state, SPEECH.nothingToSend)
    case 'C-11': {
      if (ctx.surface !== 'chat') return wrong(state, 'Скажите: комментарий')
      if (!ctx.canMutate) return hold(state, SPEECH.needServer)
      const own = lastOwn(ctx.messages)
      if (!own) return hold(state, ctx.messages.length ? SPEECH.notYoursEdit : SPEECH.empty)
      if (own.media) return hold(state, SPEECH.mediaEdit)
      return beginDictation('edit', SPEECH.dictateEdit, { editMessageId: own.id })
    }
    case 'C-12': {
      if (ctx.surface !== 'chat') return wrong(state, 'Скажите: комментарий')
      if (!ctx.canMutate) return hold(state, SPEECH.needServer)
      const own = lastOwn(ctx.messages)
      if (!own) return hold(state, ctx.messages.length ? SPEECH.notYoursDelete : SPEECH.empty)
      return beginConfirm(
        { kind: 'idle' },
        SPEECH.deleteQuestion,
        true,
        { type: 'delete', messageId: own.id },
        ctx.now,
      )
    }
    case 'F-05':
      if (ctx.surface !== 'compose' || !ctx.replyPostId) return wrong(state, 'Скажите: ответь')
      return beginDictation('comment', SPEECH.dictateComment, {})
    case 'CP-07':
      if (ctx.surface !== 'compose') return wrong(state, 'Скажите: запиши голосовое')
      if (!ctx.replyPostId) return hold(state, SPEECH.voiceOnlyComment)
      return startCapture('post', ctx, SPEECH.recordReply)
    default:
      return pass(state)
  }
}

function onIdlePhrase(state: ActiveState, raw: string, ctx: SessionContext): StepResult {
  const match = matchCatalog(raw)
  if (!match) return pass(state)
  if (!ctx.enabled(match.id)) return disabled(state)
  return handleCommand(state, match.id, ctx)
}

function onButton(state: SessionState, action: Extract<SessionEvent, { type: 'button' }>['action'], ctx: SessionContext): StepResult {
  if (state.kind === 'confirm') {
    if (action === 'yes-danger') return onConfirmPhrase(state, 'да подтверждаю')
    if (action === 'yes' || action === 'send') return onConfirmPhrase(state, 'да')
    if (action === 'no' || action === 'cancel') return onConfirmPhrase(state, 'нет')
    return hold(state)
  }
  if (state.kind === 'sending') return hold(state)
  if (action === 'stop') {
    if (state.kind === 'recording') return requestStop(state)
    if (state.kind === 'dictating') return onDictationPhrase(state, 'стоп', 'стоп', ctx)
    if (state.kind === 'preview') return hold(state, SPEECH.stopped)
    return pass(state)
  }
  if (action === 'cancel') {
    if (state.kind === 'recording' || state.kind === 'preview') return discardRecording(state, SPEECH.cancelled)
    if (state.kind === 'dictating') return onDictationPhrase(state, 'отмена', 'отмена', ctx)
    return pass(state)
  }
  if (action === 'send') {
    if (state.kind === 'preview') return trySendPreview(state, ctx)
    if (state.kind === 'dictating') return confirmDraft(state, ctx)
    return onIdlePhrase(state, 'отправить', ctx)
  }
  if (action === 'rerecord') {
    if (state.kind === 'preview' || state.kind === 'recording') return rerecord(state, ctx)
    return hold(state, SPEECH.needPreview)
  }
  if (action === 'done' && state.kind === 'dictating') return confirmDraft(state, ctx)
  if (action === 'erase' && state.kind === 'dictating') return onDictationPhrase(state, 'стереть последнее', 'стереть последнее', ctx)
  if (action === 'yes' && state.kind === 'preview') return trySendPreview(state, ctx)
  return hold(state)
}

export function step(state: SessionState, event: SessionEvent, ctx: SessionContext): StepResult {
  if (event.type === 'sent') {
    const pending = state.kind === 'sending' ? state.pending : null
    const effects: Effect[] = []
    if (pending?.type === 'send-voice') effects.push({ type: 'discard-blob', token: pending.token })
    if (pending?.type === 'send-text' || pending?.type === 'edit') {
      effects.push({ type: 'set-reply', messageId: null })
    }
    return finish({ kind: 'idle' }, effects, true)
  }
  if (event.type === 'failed') {
    const previous: ActiveState = state.kind === 'sending' ? state.previous : { kind: 'idle' }
    return finish(previous, [], true, event.message)
  }
  if (event.type === 'tick') {
    if (state.kind === 'confirm' && ctx.now >= state.deadline) {
      return finish(state.previous, [], true, SPEECH.timedOut)
    }
    return hold(state)
  }
  if (event.type === 'capture-failed') {
    return finish({ kind: 'idle' }, [{ type: 'cancel-capture' }], true, event.message || SPEECH.mic)
  }
  if (event.type === 'captured') {
    if (state.kind !== 'recording') return hold(state)
    if (event.tooShort || event.durationMs < MIN_VOICE_MS) {
      const effects: Effect[] = event.token ? [{ type: 'discard-blob', token: event.token }] : []
      return finish({ kind: 'idle' }, effects, true, SPEECH.tooShort)
    }
    const preview: ActiveState = {
      kind: 'preview',
      purpose: state.purpose,
      durationMs: event.durationMs,
      token: event.token,
    }
    return finish(preview, [], true, previewSpeech(event.durationMs))
  }
  if (event.type === 'silence' || event.type === 'max-duration') {
    if (state.kind !== 'recording') return hold(state)
    return requestStop(state)
  }
  if (event.type === 'arm-record') {
    if (state.kind !== 'idle') return hold(state)
    if (ctx.surface === 'compose') {
      if (!ctx.replyPostId) return hold(state, SPEECH.voiceOnlyComment)
      return startCapture('post', ctx, SPEECH.recordReply)
    }
    return startCapture('chat', ctx, SPEECH.record)
  }
  if (event.type === 'button') return onButton(state, event.action, ctx)
  if (event.type !== 'phrase') return pass(state)

  const norm = normalizePhrase(event.text)
  if (state.kind === 'sending') return hold(state)
  if (state.kind === 'confirm') return onConfirmPhrase(state, norm)
  if (state.kind === 'dictating') return onDictationPhrase(state, norm, event.text, ctx)
  if (state.kind === 'recording') return onRecordingPhrase(state, norm, ctx)
  if (state.kind === 'preview') return onPreviewPhrase(state, norm, ctx)
  if (!norm) return pass(state)
  return onIdlePhrase(state, event.text, ctx)
}
