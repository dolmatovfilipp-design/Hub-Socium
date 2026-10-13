import { formatTimeAgo } from '../../utils/validation.ts'
import type {
  FocusedPost,
  VoiceCommandContext,
  VoiceCommandDefinition,
  VoiceCommandResult,
} from './types.ts'
import { publishCompose } from './publications.ts'
import {
  apiOnly,
  askSlot,
  emptyHere,
  fail,
  gate,
  isResume,
  said,
  wrongScreen,
} from './runtime.ts'

const FEED_AND_POST = ['feed', 'post'] as const

const REPORT_REASONS = [
  { id: 'spam', label: 'спам', words: ['спам'] },
  { id: 'abuse', label: 'оскорбления', words: ['оскорбления', 'оскорбление'] },
  { id: 'illegal', label: 'запрещенный контент', words: ['запрещенный контент', 'запрещенный'] },
  { id: 'other', label: 'другое', words: ['другое'] },
] as const

const NUMBER_WORDS: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  один: 1,
  два: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  первый: 1,
  первое: 1,
  второй: 2,
  второе: 2,
  третий: 3,
  третье: 3,
  четвертый: 4,
  пятый: 5,
  шестой: 6,
  седьмой: 7,
  восьмой: 8,
  девятый: 9,
  десятый: 10,
}

function onFeed(ctx: VoiceCommandContext): boolean {
  return ctx.screen === 'feed' || ctx.screen === 'post'
}

function needPost(ctx: VoiceCommandContext): FocusedPost | VoiceCommandResult {
  const post = ctx.feed.focused
  if (!post) return emptyHere()
  return post
}

function isPost(value: FocusedPost | VoiceCommandResult): value is FocusedPost {
  return 'authorId' in value
}

export function describePost(post: FocusedPost): string {
  const parts = [post.authorName]
  if (post.createdAt) parts.push(formatTimeAgo(post.createdAt))
  if (post.text.trim()) parts.push(post.text.trim())
  let spoken = parts.join('. ')
  if (post.imageCount > 0) spoken += `. В посте ${post.imageCount} фото`
  if (post.hasPoll) spoken += '. В посте опрос'
  return spoken
}

function parseReason(slot: string): { id: string; label: string } | 'none' | 'many' {
  const normalized = slot
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return 'none'
  const hits = REPORT_REASONS.filter((reason) =>
    reason.words.some((word) => normalized === word || normalized.includes(word)),
  )
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) return 'none'
  return 'many'
}

function parseOptionNumber(slot: string): number | null {
  const normalized = slot.toLowerCase().replace(/ё/g, 'е').trim()
  if (!normalized) return null
  if (NUMBER_WORDS[normalized]) return NUMBER_WORDS[normalized]
  const digits = normalized.match(/\d+/)
  if (!digits) return null
  return Number(digits[0])
}

async function nextPost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (ctx.screen !== 'feed') return wrongScreen(ctx)
  if (!ctx.feed.focused) return emptyHere()
  const next = ctx.feed.moveFocus(1)
  if (!next) return { ok: false, spoken: 'Дальше постов нет', code: 'edge' }
  return said('Следующий пост')
}

async function previousPost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (ctx.screen !== 'feed') return wrongScreen(ctx)
  if (!ctx.feed.focused) return emptyHere()
  const previous = ctx.feed.moveFocus(-1)
  if (!previous) return { ok: false, spoken: 'Это первый пост', code: 'edge' }
  return said('Предыдущий пост')
}

async function like(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.likedByMe) return said('Лайк уже стоит')
  const result = await ctx.feed.toggleLike(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Ошибка лайка')
  return said('Лайк поставлен')
}

async function unlike(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (!post.likedByMe) return said('Лайка нет')
  const result = await ctx.feed.toggleLike(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Ошибка лайка')
  return said('Лайк снят')
}

async function comment(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  if (ctx.dictationEvent === 'append') {
    ctx.compose.setText(ctx.dictationText ?? '')
    return { ok: true, spoken: '', code: 'dictation' }
  }
  if (ctx.dictationEvent === 'commit' || ctx.dictationEvent === 'send' || ctx.step === 'publish') {
    if (ctx.dictationText) ctx.compose.setText(ctx.dictationText)
    return publishCompose(ctx, 'Опубликовать комментарий?')
  }
  const post = needPost(ctx)
  if (!isPost(post)) return post
  ctx.navigate(`/app/compose?reply=${encodeURIComponent(post.id)}`)
  ctx.compose.prepareReply(post.id)
  return {
    ok: true,
    spoken: 'Диктуйте комментарий',
    code: 'dictation',
    startDictation: { step: 'body', prompt: 'Диктуйте комментарий' },
  }
}

async function readPost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  return said(describePost(post))
}

async function openAuthor(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  ctx.navigate(`/app/profile/${encodeURIComponent(post.authorId)}`)
  return said('Открываю профиль')
}

async function repost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  const prompt = post.repostedByMe ? 'Отменить репост?' : 'Сделать репост?'
  const blocked = gate(ctx, 'yes', prompt, 'repost')
  if (blocked) return blocked
  const wasReposted = post.repostedByMe
  const result = await ctx.feed.toggleRepost(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Ошибка репоста')
  return said(wasReposted ? 'Репост отменён' : 'Репост сделан')
}

async function sharePost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  const blocked = gate(ctx, 'yes', 'Открыть лист шаринга?', 'share')
  if (blocked) return blocked
  ctx.feed.openShare(post.id)
  return said('Открыт лист шаринга')
}

async function savePost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.saved) return said('Уже сохранено')
  const result = await ctx.feed.toggleSave(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Ошибка закладки')
  return said('Сохранено')
}

async function unsavePost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (!post.saved) return said('Пост не в сохранённом')
  const blocked = gate(ctx, 'yes', 'Убрать из сохранённого?', 'unsave')
  if (blocked) return blocked
  const result = await ctx.feed.toggleSave(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Ошибка закладки')
  return said('Убрано из сохранённого')
}

async function archivePost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (!ctx.apiMode) return apiOnly(ctx, 'Архив — в API-режиме')
  const blocked = gate(ctx, 'yes', 'Убрать пост в архив?', 'archive')
  if (blocked) return blocked
  const result = await ctx.feed.archivePost(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось')
  return said('Пост в архиве')
}

async function muteAuthor(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  if (!ctx.apiMode) return apiOnly(ctx, 'Скрыть из ленты — в API')
  const blocked = gate(
    ctx,
    'dangerous',
    'Скрыть посты автора из ленты? Скажите: да, подтверждаю',
    'mute',
  )
  if (blocked) return blocked
  const result = await ctx.feed.muteAuthor(post.authorId)
  if (!result.ok) return fail(ctx, result.error || 'Ошибка')
  return said('Скрыто из ленты')
}

async function blockAuthor(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  const blocked = gate(
    ctx,
    'dangerous',
    'Заблокировать автора? Скажите: да, подтверждаю',
    'block',
  )
  if (blocked) return blocked
  const result = await ctx.feed.blockAuthor(post.authorId)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось заблокировать')
  return said('Автор заблокирован')
}

async function reportPost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  const reason = parseReason(ctx.slot)
  if (reason === 'many') {
    return askSlot('Причина: спам, оскорбления, запрещённый контент или другое', 'reason')
  }
  if (reason === 'none') {
    return askSlot('Причина: спам, оскорбления, запрещённый контент или другое', 'reason')
  }
  const blocked = gate(
    ctx,
    'dangerous',
    `Пожаловаться: ${reason.label}? Скажите: да, подтверждаю`,
    'report',
  )
  if (blocked) return blocked
  const result = await ctx.feed.reportPost(post.id, reason.id)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось отправить жалобу')
  return said('Жалоба отправлена')
}

async function followAuthor(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  if (post.following) return said('Вы уже подписаны')
  if (post.followRequested) return said('Запрос на подписку отправлен')
  const result = await ctx.feed.follow(post.authorId)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось подписаться')
  if (result.requested) return said('Запрос на подписку отправлен')
  return said('Подписка оформлена')
}

async function unfollowAuthor(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (!post.following) return said('Вы не подписаны')
  const blocked = gate(ctx, 'yes', 'Отписаться?', 'unfollow')
  if (blocked) return blocked
  const result = await ctx.feed.unfollow(post.authorId)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось отписаться')
  return said('Отписка оформлена')
}

async function refresh(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (ctx.screen !== 'feed') return wrongScreen(ctx)
  const result = await ctx.feed.refresh()
  if (!result.ok) return fail(ctx, result.error || 'Не удалось обновить')
  return said('Обновляю ленту')
}

async function newPost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (ctx.screen !== 'feed' && ctx.screen !== 'post') return wrongScreen(ctx)
  ctx.navigate('/app/compose')
  return said('Публикация')
}

async function openMenu(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  ctx.feed.openMore(post.id)
  return said('Меню поста')
}

async function interested(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  ctx.feed.markInterested(post.authorId)
  return said('Буду показывать чаще')
}

async function notInterested(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  const blocked = gate(ctx, 'yes', 'Скрыть этот пост?', 'hide')
  if (blocked) return blocked
  ctx.feed.hidePost(post.id)
  return said('Пост скрыт')
}

async function restrictAuthor(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  const blocked = gate(
    ctx,
    'dangerous',
    'Ограничить автора? Скажите: да, подтверждаю',
    'restrict',
  )
  if (blocked) return blocked
  ctx.feed.restrictAuthor(post.authorId)
  return said('Ограничения установлены')
}

async function quote(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (!ctx.apiMode) return apiOnly(ctx, 'Цитата — в API-режиме')
  if (ctx.dictationEvent === 'append') {
    return { ok: true, spoken: '', code: 'dictation' }
  }
  if (ctx.dictationEvent === 'commit' || ctx.dictationEvent === 'send' || ctx.step === 'publish') {
    const blocked = gate(ctx, 'yes', 'Опубликовать цитату?', 'publish')
    if (blocked) return blocked
    const text = (ctx.dictationText ?? '').trim()
    const result = await ctx.feed.quoteRepost(post.id, text)
    if (!result.ok) return fail(ctx, result.error || 'Ошибка')
    return said(text ? 'Цитата опубликована' : 'Репост сделан')
  }
  if (ctx.step === 'open' && (ctx.confirmation === 'yes' || ctx.confirmation === 'dangerous')) {
    return {
      ok: true,
      spoken: 'Диктуйте цитату',
      code: 'dictation',
      startDictation: { step: 'quote', prompt: 'Диктуйте цитату' },
    }
  }
  const blocked = gate(ctx, 'yes', 'Открыть цитату?', 'open')
  if (blocked) return blocked
  return {
    ok: true,
    spoken: 'Диктуйте цитату',
    code: 'dictation',
    startDictation: { step: 'quote', prompt: 'Диктуйте цитату' },
  }
}

async function vote(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (!post.hasPoll || !post.poll || post.poll.options.length === 0) {
    return { ok: false, spoken: 'В посте нет опроса', code: 'empty' }
  }
  if (!ctx.apiMode) return apiOnly(ctx, 'Это доступно при подключении к серверу')
  const number = parseOptionNumber(ctx.slot)
  if (!number) return askSlot('Назовите номер варианта', 'option')
  const option = post.poll.options[number - 1]
  if (!option) return askSlot('Такого варианта нет. Назовите номер варианта', 'option')
  const blocked = gate(ctx, 'yes', `Проголосовать за вариант ${number}?`, 'vote')
  if (blocked) return blocked
  const result = await ctx.feed.votePoll(post.poll.id, option.id)
  if (!result.ok) return fail(ctx, result.error || 'Голос не принят')
  return said('Голос принят')
}

async function stepPhoto(ctx: VoiceCommandContext, delta: number): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  const stepped = ctx.feed.stepCarousel(delta)
  if (!stepped.ok && stepped.reason === 'none') return { ok: false, spoken: 'В посте нет фото', code: 'empty' }
  if (!stepped.ok && stepped.reason === 'end') return { ok: false, spoken: 'Это последнее фото', code: 'edge' }
  if (!stepped.ok) return { ok: false, spoken: 'Это первое фото', code: 'edge' }
  return said(`Фото ${stepped.index}`)
}

async function openPost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (ctx.screen === 'post') return said('Пост уже открыт')
  ctx.navigate(`/app/p/${encodeURIComponent(post.id)}`)
  return said('Открываю пост')
}

async function hideAuthor(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (post.isMine) return { ok: false, spoken: 'Это ваш пост', code: 'denied' }
  const blocked = gate(
    ctx,
    'dangerous',
    'Скрыть пользователя? Скажите: да, подтверждаю',
    'hide-author',
  )
  if (blocked) return blocked
  ctx.feed.hideAuthor(post.authorId)
  return said('Пользователь скрыт')
}

async function deleteOwnPost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  if (!post.isMine) return { ok: false, spoken: 'Удалить можно только свой пост', code: 'denied' }
  const blocked = gate(ctx, 'dangerous', 'Удалить ваш пост? Скажите: да, подтверждаю', 'delete')
  if (blocked) return blocked
  const result = await ctx.feed.deletePost(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось удалить')
  return said('Публикация удалена')
}

async function copyPostLink(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onFeed(ctx)) return wrongScreen(ctx)
  const post = needPost(ctx)
  if (!isPost(post)) return post
  const result = await ctx.feed.copyPostLink(post.id)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось скопировать ссылку')
  return said('Ссылка скопирована')
}

function feedCommand(
  partial: Pick<
    VoiceCommandDefinition,
    'id' | 'phrases' | 'synonyms' | 'screens' | 'confirmation' | 'inReadingSet' | 'preset' | 'takesSlot' | 'reply' | 'handler'
  >,
): VoiceCommandDefinition {
  return { group: 'feed', ...partial }
}

/** Feed commands F-01 … F-31. */
export const feedCommands: readonly VoiceCommandDefinition[] = [
  feedCommand({
    id: 'F-01',
    phrases: ['дальше'],
    synonyms: ['следующий пост', 'ниже'],
    screens: ['feed'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Следующий пост',
    handler: nextPost,
  }),
  feedCommand({
    id: 'F-02',
    phrases: ['предыдущий'],
    synonyms: ['прошлый пост', 'выше'],
    screens: ['feed'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Предыдущий пост',
    handler: previousPost,
  }),
  feedCommand({
    id: 'F-03',
    phrases: ['лайк'],
    synonyms: ['нравится', 'поставь лайк'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Лайк поставлен',
    handler: like,
  }),
  feedCommand({
    id: 'F-04',
    phrases: ['убери лайк'],
    synonyms: ['сними лайк'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Лайк снят',
    handler: unlike,
  }),
  feedCommand({
    id: 'F-05',
    phrases: ['комментарий'],
    synonyms: ['ответь на пост'],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Диктуйте комментарий',
    handler: comment,
  }),
  feedCommand({
    id: 'F-06',
    phrases: ['прочитай пост'],
    synonyms: ['прочитай'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Читает текст поста',
    handler: readPost,
  }),
  feedCommand({
    id: 'F-07',
    phrases: ['профиль автора'],
    synonyms: ['открой автора', 'открой профиль автора'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Открываю профиль',
    handler: openAuthor,
  }),
  feedCommand({
    id: 'F-08',
    phrases: ['репост'],
    synonyms: ['сделай репост'],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Сделать репост?',
    handler: repost,
  }),
  feedCommand({
    id: 'F-09',
    phrases: ['поделиться'],
    synonyms: ['шаринг'],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Открыт лист шаринга',
    handler: sharePost,
  }),
  feedCommand({
    id: 'F-10',
    phrases: ['сохрани'],
    synonyms: ['в закладки'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Сохранено',
    handler: savePost,
  }),
  feedCommand({
    id: 'F-11',
    phrases: ['убери из сохранённого'],
    synonyms: ['убери из сохраненного'],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Убрать из сохранённого?',
    handler: unsavePost,
  }),
  feedCommand({
    id: 'F-12',
    phrases: ['пост в архив'],
    synonyms: ['в архив пост'],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Убрать пост в архив?',
    handler: archivePost,
  }),
  feedCommand({
    id: 'F-13',
    phrases: ['скрой из ленты'],
    synonyms: ['скрой автора'],
    screens: FEED_AND_POST,
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Скрыть посты автора из ленты? Скажите: да, подтверждаю',
    handler: muteAuthor,
  }),
  feedCommand({
    id: 'F-14',
    phrases: ['заблокируй'],
    synonyms: ['в чёрный список', 'в черный список'],
    screens: FEED_AND_POST,
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Заблокировать автора? Скажите: да, подтверждаю',
    handler: blockAuthor,
  }),
  feedCommand({
    id: 'F-15',
    phrases: ['пожалуйся'],
    synonyms: ['жалоба'],
    screens: FEED_AND_POST,
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: true,
    reply: 'Причина: спам, оскорбления, запрещённый контент или другое',
    handler: reportPost,
  }),
  feedCommand({
    id: 'F-16',
    phrases: ['подпишись'],
    synonyms: ['подписка'],
    screens: ['feed', 'post'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Подписка оформлена',
    handler: followAuthor,
  }),
  feedCommand({
    id: 'F-17',
    phrases: ['отпишись'],
    synonyms: [],
    screens: ['feed', 'post'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Отписаться?',
    handler: unfollowAuthor,
  }),
  feedCommand({
    id: 'F-18',
    phrases: ['обнови ленту'],
    synonyms: ['обновить'],
    screens: ['feed'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Обновляю ленту',
    handler: refresh,
  }),
  feedCommand({
    id: 'F-19',
    phrases: ['новый пост'],
    synonyms: ['что нового', 'создать пост'],
    screens: ['feed', 'post'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Публикация',
    handler: newPost,
  }),
  feedCommand({
    id: 'F-20',
    phrases: ['меню поста'],
    synonyms: ['ещё', 'еще'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Меню поста',
    handler: openMenu,
  }),
  feedCommand({
    id: 'F-21',
    phrases: ['интересует'],
    synonyms: ['покажи больше такого'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Буду показывать чаще',
    handler: interested,
  }),
  feedCommand({
    id: 'F-22',
    phrases: ['не интересует'],
    synonyms: [],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Скрыть этот пост?',
    handler: notInterested,
  }),
  feedCommand({
    id: 'F-23',
    phrases: ['ограничь'],
    synonyms: ['установи ограничения'],
    screens: FEED_AND_POST,
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Ограничить автора? Скажите: да, подтверждаю',
    handler: restrictAuthor,
  }),
  feedCommand({
    id: 'F-24',
    phrases: ['цитата'],
    synonyms: ['цитируй'],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Открыть цитату?',
    handler: quote,
  }),
  feedCommand({
    id: 'F-25',
    phrases: ['голос'],
    synonyms: ['вариант'],
    screens: FEED_AND_POST,
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: true,
    reply: 'Проголосовать за вариант?',
    handler: vote,
  }),
  feedCommand({
    id: 'F-26',
    phrases: ['следующее фото'],
    synonyms: ['другое фото'],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Фото N',
    handler: (ctx) => stepPhoto(ctx, 1),
  }),
  feedCommand({
    id: 'F-27',
    phrases: ['предыдущее фото'],
    synonyms: [],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Фото N',
    handler: (ctx) => stepPhoto(ctx, -1),
  }),
  feedCommand({
    id: 'F-28',
    phrases: ['открой пост'],
    synonyms: [],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Открываю пост',
    handler: openPost,
  }),
  feedCommand({
    id: 'F-29',
    phrases: ['скрой пользователя'],
    synonyms: [],
    screens: FEED_AND_POST,
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Скрыть пользователя? Скажите: да, подтверждаю',
    handler: hideAuthor,
  }),
  feedCommand({
    id: 'F-30',
    phrases: ['удали пост'],
    synonyms: [],
    screens: FEED_AND_POST,
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Удалить ваш пост? Скажите: да, подтверждаю',
    handler: deleteOwnPost,
  }),
  feedCommand({
    id: 'F-31',
    phrases: ['копируй ссылку поста'],
    synonyms: [],
    screens: FEED_AND_POST,
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Ссылка скопирована',
    handler: copyPostLink,
  }),
]
