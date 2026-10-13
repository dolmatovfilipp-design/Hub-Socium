/**
 * Runnable checks for the Phase 2 session. Not imported by the app.
 * node --experimental-strip-types src/voice/dictation/selfcheck.ts
 */

import { matchCatalog, normalizePhrase, PHASE2_CATALOG } from './commands.ts'
import { isPhase2CommandEnabled, silenceSecondsOf } from './prefs.ts'
import { createSilenceTracker, rmsOf } from './silence.ts'
import { SPEECH } from './speech.ts'
import {
  CONFIRM_MS,
  initialSession,
  MIN_VOICE_MS,
  step,
  type Effect,
  type SessionContext,
  type SessionState,
} from './session.ts'

const errors: string[] = []
let checks = 0

function check(name: string, ok: boolean) {
  checks += 1
  if (!ok) errors.push(name)
}

function ctx(over: Partial<SessionContext> = {}): SessionContext {
  return {
    surface: 'chat',
    now: 1_000_000,
    silenceSeconds: 3,
    canSendVoice: true,
    canMutate: true,
    messages: [
      { id: 'a', mine: false, text: 'Привет', media: false },
      { id: 'b', mine: true, text: 'Мой текст', media: false },
    ],
    focusedId: 'a',
    enabled: () => true,
    ...over,
  }
}

function say(state: SessionState, text: string, c: SessionContext = ctx()) {
  return step(state, { type: 'phrase', text }, c)
}

function has(effects: Effect[], type: Effect['type']) {
  return effects.some((effect) => effect.type === type)
}

function run() {
  check('normalize punctuation and ё', normalizePhrase('Да, подтверждаю!') === 'да подтверждаю' && normalizePhrase('Ёлка') === 'елка')
  check('no wake word', matchCatalog('хаб ответь') === null && matchCatalog('Хаб, лента') === null)
  check('longest reply phrase', matchCatalog('Ответь на это')?.id === 'C-37' && matchCatalog('ответь')?.id === 'C-06')
  check('catalog has no wake word', PHASE2_CATALOG.every((item) => item.phrases.every((phrase) => !normalizePhrase(phrase).includes('хаб'))))

  check('reading preset hides voice record', isPhase2CommandEnabled('C-07', { voiceEnabled: true, preset: 'reading' }) === false)
  check('chat preset enables voice record', isPhase2CommandEnabled('C-07', { voiceEnabled: true, preset: 'chat' }) === true)
  check('cancel recording stays in starter set', isPhase2CommandEnabled('C-10', { voiceEnabled: true }) === true)
  check('delete is outside presets', isPhase2CommandEnabled('C-12', { voiceEnabled: true, preset: 'publish' }) === false)
  check('delete override', isPhase2CommandEnabled('C-12', { voiceEnabled: true, commands: { 'C-12': true } }) === true)
  check('voice off disables commands', isPhase2CommandEnabled('C-06', { voiceEnabled: false, preset: 'chat' }) === false)
  check('comment is in chat preset', isPhase2CommandEnabled('F-05', { voiceEnabled: true, preset: 'chat' }) === true)
  check('silence default 3', silenceSecondsOf({}) === 3 && silenceSecondsOf({ silenceSeconds: 9 }) === 8 && silenceSecondsOf({ silenceSeconds: 0 }) === 1)

  check('rms', rmsOf([0, 0]) === 0 && Math.abs(rmsOf([1]) - 1) < 1e-9)

  const tracker = createSilenceTracker({ silenceMs: 3000, calibrateMs: 300 })
  check('silence waits out calibration', tracker.push(0, 0) === 'level' && tracker.push(0, 299) === 'level' && tracker.push(0, 300) === 'level' && !tracker.calibrated() === false)
  check('silence fires after 3s', tracker.push(0, 3299) === 'level' && tracker.push(0, 6299) === 'silence')

  const noisy = createSilenceTracker({ silenceMs: 3000, calibrateMs: 300 })
  noisy.push(0.05, 0)
  noisy.push(0.05, 300)
  check('noise floor lifts threshold', noisy.threshold() > 0.05 && noisy.push(0.09, 1000) === 'level')
  const late = createSilenceTracker({ silenceMs: 3000, calibrateMs: 300 })
  late.push(0, 0)
  check('calibration sample does not count as silence', late.push(0, 5000) === 'level' && late.calibrated())

  const idle = initialSession()
  const nav = say(idle, 'лента')
  check('navigation is not consumed', nav.consumed === false && nav.state.kind === 'idle')

  const disabled = say(idle, 'голосовое', ctx({ enabled: () => false }))
  check('disabled command', disabled.consumed && disabled.speech === SPEECH.disabled && disabled.state.kind === 'idle')

  const wrong = say(idle, 'запиши голосовое', ctx({ surface: 'compose', replyPostId: 'p1' }))
  check('voice record is chat-only', wrong.speech?.includes(SPEECH.wrongScreen) === true)

  const dictate = say(idle, 'ответь')
  check('reply starts dictation', dictate.state.kind === 'dictating' && dictate.speech === SPEECH.dictateReply)
  const yesAsText = dictate.state.kind === 'dictating' ? say(dictate.state, 'да') : dictate
  check('да during dictation is text', yesAsText.state.kind === 'dictating' && yesAsText.state.text === 'да' && !has(yesAsText.effects, 'send-text'))

  const withText = say(dictate.state, 'добрый вечер')
  const emptyDone = say(dictate.state, 'готово')
  check('empty готово does not send', emptyDone.speech === SPEECH.nothingToSend && emptyDone.state.kind === 'dictating' && !has(emptyDone.effects, 'send-text'))
  const asked = say(withText.state, 'готово')
  check('готово asks before send', asked.state.kind === 'confirm' && asked.speech === SPEECH.sendQuestion && !has(asked.effects, 'send-text'))
  const sent = say(asked.state, 'да')
  check('да sends dictated reply', has(sent.effects, 'send-text') && sent.state.kind === 'sending')
  const stopped = say(withText.state, 'стоп')
  check('stop does not send dictation', stopped.speech === SPEECH.stopped && stopped.state.kind === 'idle' && !has(stopped.effects, 'send-text'))

  const asked2 = say(withText.state, 'отправить')
  const timed = step(asked2.state, { type: 'tick' }, ctx({ now: 1_000_000 + CONFIRM_MS }))
  check('8s silence cancels send', timed.speech === SPEECH.timedOut && timed.state.kind === 'dictating' && !has(timed.effects, 'send-text'))
  check('confirm window is 8s', CONFIRM_MS === 8000)

  const erase = say(withText.state, 'стереть последнее')
  check('erase last word', erase.state.kind === 'dictating' && erase.state.text === 'добрый')

  const replyThis = say(idle, 'ответь на это')
  check('reply to focused message', replyThis.speech === SPEECH.replyToThis && replyThis.effects.some((e) => e.type === 'set-reply' && e.messageId === 'a'))

  const media = say(idle, 'исправь последнее', ctx({
    messages: [{ id: 'v', mine: true, text: '', media: true }],
  }))
  check('media cannot be edited', media.speech === SPEECH.mediaEdit && !has(media.effects, 'edit'))

  const edit = say(idle, 'редактировать последнее')
  const editText = say(edit.state, 'исправленный')
  const editAsk = say(editText.state, 'готово')
  const editYes = say(editAsk.state, 'да')
  check('edit waits for да', editAsk.state.kind === 'confirm' && !has(editAsk.effects, 'edit') && has(editYes.effects, 'edit'))
  const noApi = say(idle, 'исправь последнее', ctx({ canMutate: false }))
  check('edit needs server', noApi.speech === SPEECH.needServer)

  const del = say(idle, 'удали последнее')
  const delYes = say(del.state, 'да')
  const delDanger = say(del.state, 'да, подтверждаю')
  check('delete ignores plain да', del.state.kind === 'confirm' && delYes.state.kind === 'confirm' && !has(delYes.effects, 'delete'))
  check('delete accepts danger phrase', has(delDanger.effects, 'delete'))
  const delTimeout = step(del.state, { type: 'tick' }, ctx({ now: 1_000_000 + CONFIRM_MS }))
  check('delete timeout', delTimeout.speech === SPEECH.timedOut && !has(delTimeout.effects, 'delete'))

  const rec = say(idle, 'запиши голосовое')
  check('record does not upload', rec.state.kind === 'recording' && has(rec.effects, 'start-capture') && !has(rec.effects, 'send-voice'))
  const stopping = step(rec.state, { type: 'silence' }, ctx())
  check('silence requests stop', has(stopping.effects, 'stop-capture') && !has(stopping.effects, 'send-voice'))
  const preview = step(stopping.state, { type: 'captured', durationMs: 2500, token: 'abc' }, ctx())
  check('preview asks', preview.state.kind === 'preview' && preview.speech === 'Запись 3 секунд. Отправить или перезаписать?' && !has(preview.effects, 'send-voice'))
  const again = say(preview.state, 'перезаписать')
  check('rerecord drops blob', again.speech === SPEECH.rerecord && has(again.effects, 'discard-blob') && has(again.effects, 'start-capture') && !has(again.effects, 'send-voice'))
  const go = say(preview.state, 'отправить')
  check('отправить on preview sends', has(go.effects, 'send-voice') && go.state.kind === 'sending')
  const byYes = say(preview.state, 'да')
  check('да on preview sends', has(byYes.effects, 'send-voice'))
  const dropped = say(preview.state, 'отмена')
  check('cancel drops preview', dropped.state.kind === 'idle' && has(dropped.effects, 'discard-blob') && !has(dropped.effects, 'send-voice'))

  const short = step(rec.state, { type: 'captured', durationMs: 200, token: 'short', tooShort: true }, ctx())
  check('short recording', short.speech === SPEECH.tooShort && short.state.kind === 'idle' && !has(short.effects, 'send-voice') && MIN_VOICE_MS === 400)

  const maxed = step(stopping.state, { type: 'captured', durationMs: 120_000, token: 'long' }, ctx())
  check('max duration previews', maxed.state.kind === 'preview' && !has(maxed.effects, 'send-voice'))

  const localVoice = say(preview.state, 'отправить', ctx({ canSendVoice: false }))
  check('local chat does not upload voice', localVoice.speech === SPEECH.needServer && !has(localVoice.effects, 'send-voice'))

  const compose = ctx({ surface: 'compose', replyPostId: 'p1' })
  let comment = say(idle, 'комментарий', compose)
  comment = say(comment.state, 'классный свет', compose)
  comment = say(comment.state, 'готово', compose)
  check('comment confirms before publish', comment.state.kind === 'confirm' && comment.speech === SPEECH.publishQuestion && !has(comment.effects, 'publish-text'))
  const published = say(comment.state, 'отправить', compose)
  check('отправить confirms comment', has(published.effects, 'publish-text'))

  const voiceReply = say(idle, 'голосовой ответ', compose)
  check('post voice reply records', voiceReply.state.kind === 'recording' && voiceReply.speech === SPEECH.recordReply)
  const noPost = say(idle, 'запиши ответ', ctx({ surface: 'compose' }))
  check('voice reply needs a comment', noPost.speech === SPEECH.voiceOnlyComment)

  const foreign = say(idle, 'удалить последнее', ctx({ messages: [{ id: 'x', mine: false, text: 'чужое', media: false }] }))
  check('cannot delete someone else', foreign.speech === SPEECH.notYoursDelete && foreign.state.kind === 'idle')

  const nothing = say(idle, 'отправить')
  check('nothing to send', nothing.speech === SPEECH.nothingToSend && nothing.state.kind === 'idle')
}

run()

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.join(' ') ?? ''
if (entry.includes('selfcheck')) {
  if (errors.length) {
    console.error(errors.join('\n'))
    throw new Error(`${errors.length} dictation checks failed`)
  }
  console.log(`dictation self-check ok (${checks} checks)`)
}
