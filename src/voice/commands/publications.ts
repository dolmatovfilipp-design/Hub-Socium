import type { VoiceCommandContext, VoiceCommandDefinition, VoiceCommandResult } from './types.ts'
import { fail, gate, isResume, said, wrongScreen } from './runtime.ts'

/**
 * Publish the compose draft after «да». Used by CP-06 and by the comment
 * command once dictation ends. Does not upload a voice reply by itself.
 */
export async function publishCompose(
  ctx: VoiceCommandContext,
  prompt: string,
): Promise<VoiceCommandResult> {
  const blocked = gate(ctx, 'yes', prompt, 'publish')
  if (blocked) return blocked
  const text = (ctx.dictationText ?? ctx.compose.text).trim()
  if (ctx.dictationText) ctx.compose.setText(ctx.dictationText)
  if (!text && ctx.compose.imageCount === 0) {
    return { ok: false, spoken: 'Нечего публиковать', code: 'empty' }
  }
  const result = await ctx.compose.submit()
  if (!result.ok) return fail(ctx, result.error || 'Ошибка')
  if (result.offlineQueued) return said('Текст сохранён и уйдёт, когда появится сеть')
  return said(ctx.compose.isReply ? 'Комментарий опубликован' : 'Пост опубликован')
}

function onCompose(ctx: VoiceCommandContext): boolean {
  return ctx.screen === 'compose' || ctx.compose.open
}

async function dictateText(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onCompose(ctx)) return wrongScreen(ctx)
  if (ctx.dictationEvent === 'append') {
    ctx.compose.setText(ctx.dictationText ?? '')
    return { ok: true, spoken: '', code: 'dictation' }
  }
  if (ctx.dictationEvent === 'send' || ctx.step === 'publish') {
    const prompt = ctx.compose.isReply ? 'Опубликовать комментарий?' : 'Опубликовать пост?'
    return publishCompose(ctx, prompt)
  }
  if (ctx.dictationEvent === 'commit') {
    ctx.compose.setText(ctx.dictationText ?? '')
    return said('Текст записан')
  }
  return {
    ok: true,
    spoken: 'Диктуйте',
    code: 'dictation',
    startDictation: { step: 'body', prompt: 'Диктуйте' },
  }
}

async function dictateTags(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onCompose(ctx)) return wrongScreen(ctx)
  if (ctx.dictationEvent === 'append') {
    ctx.compose.setTags(ctx.dictationText ?? '')
    return { ok: true, spoken: '', code: 'dictation' }
  }
  if (ctx.dictationEvent === 'commit' || ctx.dictationEvent === 'send') {
    ctx.compose.setTags(ctx.dictationText ?? '')
    return said('Теги записаны')
  }
  return {
    ok: true,
    spoken: 'Диктуйте теги',
    code: 'dictation',
    startDictation: { step: 'tags', prompt: 'Диктуйте теги' },
  }
}

async function addPhoto(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onCompose(ctx)) return wrongScreen(ctx)
  ctx.compose.requestPhotoPicker()
  return said('Нажмите выбрать фото')
}

async function removePhoto(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onCompose(ctx)) return wrongScreen(ctx)
  const raw = ctx.slot.trim()
  if (raw && !/^\d+$/.test(raw)) return askNumber()
  const index = raw ? Number(raw) : 'last'
  if (typeof index === 'number' && index < 1) return askNumber()
  const removed = ctx.compose.removeImage(index)
  if (!removed) return { ok: false, spoken: 'Фото нет', code: 'empty' }
  return said('Фото убрано')
}

function askNumber(): VoiceCommandResult {
  return { ok: false, spoken: 'Назовите номер фото', code: 'needs-slot' }
}

async function assist(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onCompose(ctx)) return wrongScreen(ctx)
  if (ctx.step === 'apply') {
    const blocked = gate(ctx, 'yes', 'Подставить подсказку?', 'apply')
    if (blocked) return blocked
    const suggestion = ctx.compose.assistHint.trim()
    if (!suggestion) return fail(ctx, 'Подсказки нет')
    ctx.compose.applySuggestion(suggestion)
    return said('Подсказка подставлена')
  }
  if (!ctx.compose.text.trim()) return { ok: false, spoken: 'Сначала продиктуйте текст', code: 'empty' }
  const blocked = gate(ctx, 'yes', 'Отправить текст на подсказку? Он уйдёт на сервер', 'request')
  if (blocked) return blocked
  if (!ctx.apiMode) return fail(ctx, 'Это доступно при подключении к серверу')
  const result = await ctx.compose.requestAssist(ctx.compose.text)
  if (!result.ok || !result.suggestion) return fail(ctx, result.error || 'Подсказка недоступна')
  return {
    ok: false,
    spoken: 'Подставить подсказку?',
    code: 'needs-confirmation',
    needsConfirmation: 'yes',
    confirmPrompt: 'Подставить подсказку?',
    resumeStep: 'apply',
  }
}

async function publish(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onCompose(ctx)) return wrongScreen(ctx)
  const prompt = ctx.compose.isReply ? 'Опубликовать комментарий?' : 'Опубликовать пост?'
  return publishCompose(ctx, prompt)
}

async function voiceReply(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onCompose(ctx)) return wrongScreen(ctx)
  if (!ctx.compose.isReply) {
    return { ok: false, spoken: 'Голосовой ответ только у комментария', code: 'denied' }
  }
  ctx.compose.beginVoiceReply()
  return said('Запись ответа')
}

async function cancelCompose(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onCompose(ctx)) return wrongScreen(ctx)
  ctx.compose.cancel()
  ctx.navigate('/app')
  return said('Черновик закрыт')
}

function publication(
  partial: Omit<VoiceCommandDefinition, 'group'>,
): VoiceCommandDefinition {
  return { group: 'publications', ...partial }
}

/** Publication commands CP-01 … CP-08. */
export const publicationCommands: readonly VoiceCommandDefinition[] = [
  publication({
    id: 'CP-01',
    phrases: ['диктуй'],
    synonyms: ['текст поста'],
    screens: ['compose'],
    confirmation: 'none',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: false,
    reply: 'Диктуйте',
    handler: dictateText,
  }),
  publication({
    id: 'CP-02',
    phrases: ['теги'],
    synonyms: [],
    screens: ['compose'],
    confirmation: 'none',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: false,
    reply: 'Диктуйте теги',
    handler: dictateTags,
  }),
  publication({
    id: 'CP-03',
    phrases: ['фото к посту'],
    synonyms: [],
    screens: ['compose'],
    confirmation: 'none',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: false,
    reply: 'Нажмите выбрать фото',
    handler: addPhoto,
  }),
  publication({
    id: 'CP-04',
    phrases: ['убери фото'],
    synonyms: [],
    screens: ['compose'],
    confirmation: 'none',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: true,
    reply: 'Фото убрано',
    handler: removePhoto,
  }),
  publication({
    id: 'CP-05',
    phrases: ['помоги с текстом'],
    synonyms: [],
    screens: ['compose'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: false,
    reply: 'Отправить текст на подсказку? Он уйдёт на сервер',
    handler: assist,
  }),
  publication({
    id: 'CP-06',
    phrases: ['опубликуй'],
    synonyms: ['опубликовать'],
    screens: ['compose'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: false,
    reply: 'Опубликовать пост?',
    handler: publish,
  }),
  publication({
    id: 'CP-07',
    phrases: ['голосовой ответ'],
    synonyms: ['запиши ответ'],
    screens: ['compose'],
    confirmation: 'none',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: false,
    reply: 'Запись ответа',
    handler: voiceReply,
  }),
  publication({
    id: 'CP-08',
    phrases: ['отмени публикацию'],
    synonyms: [],
    screens: ['compose'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Черновик закрыт',
    handler: cancelCompose,
  }),
]
