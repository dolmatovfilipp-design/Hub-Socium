import type { ProfileSnapshot, VoiceCommandContext, VoiceCommandDefinition, VoiceCommandResult } from './types.ts'
import { apiOnly, fail, gate, isResume, said, wrongScreen } from './runtime.ts'

function person(ctx: VoiceCommandContext): ProfileSnapshot | VoiceCommandResult {
  if (ctx.screen !== 'profile' && !isResume(ctx)) return wrongScreen(ctx)
  if (!ctx.profile.user) return { ok: false, spoken: 'Здесь пусто', code: 'empty' }
  return ctx.profile.user
}

function isUser(value: ProfileSnapshot | VoiceCommandResult): value is ProfileSnapshot {
  return 'username' in value
}

function ruCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

export function describeProfile(user: ProfileSnapshot): string {
  const parts = [`${user.name}, @${user.username}`]
  if (user.bio.trim()) parts.push(user.bio.trim())
  if (user.about.trim()) parts.push(`О себе: ${user.about.trim()}`)
  if (user.services.trim()) parts.push(`Услуги: ${user.services.trim()}`)
  parts.push(ruCount(user.followers, 'подписчик', 'подписчика', 'подписчиков'))
  parts.push(ruCount(user.following, 'подписка', 'подписки', 'подписок'))
  return parts.join('. ')
}

async function readProfile(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  return said(describeProfile(user))
}

async function setTab(
  ctx: VoiceCommandContext,
  tab: ProfileSnapshot['tab'],
  spoken: string,
): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  ctx.profile.setTab(tab)
  return said(spoken)
}

async function follow(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (user.isMe) return { ok: false, spoken: 'Это ваш профиль', code: 'denied' }
  if (user.isFollowing) return said('Вы уже подписаны')
  if (user.followRequested) return said('Запрос на подписку отправлен')
  const result = await ctx.profile.follow()
  if (!result.ok) return fail(ctx, result.error || 'Не удалось подписаться')
  if (result.requested) return said('Запрос на подписку отправлен')
  return said('Подписка')
}

async function unfollow(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (user.isMe) return { ok: false, spoken: 'Это ваш профиль', code: 'denied' }
  if (!user.isFollowing) return said('Вы не подписаны')
  const blocked = gate(ctx, 'yes', 'Отписаться?', 'unfollow')
  if (blocked) return blocked
  const result = await ctx.profile.unfollow()
  if (!result.ok) return fail(ctx, result.error || 'Не удалось отписаться')
  return said('Отписка оформлена')
}

async function attention(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (user.isMe) return { ok: false, spoken: 'Это ваш профиль', code: 'denied' }
  if (!ctx.apiMode) return apiOnly(ctx, 'Это доступно при подключении к серверу')
  const blocked = gate(ctx, 'yes', 'Отправить внимание?', 'attention')
  if (blocked) return blocked
  const result = await ctx.profile.sendAttention()
  if (!result.ok) return fail(ctx, result.error || 'Ошибка')
  return said('Внимание отправлено')
}

async function addClose(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (user.isMe) return { ok: false, spoken: 'Это ваш профиль', code: 'denied' }
  if (user.isCloseFriend) return said('Уже в близких друзьях')
  if (!ctx.apiMode) return apiOnly(ctx, 'Это доступно при подключении к серверу')
  const blocked = gate(ctx, 'yes', 'Добавить в близкие друзья?', 'close')
  if (blocked) return blocked
  const result = await ctx.profile.addCloseFriend()
  if (!result.ok) return fail(ctx, result.error || 'Ошибка')
  return said('В близких друзьях')
}

async function removeClose(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (user.isMe) return { ok: false, spoken: 'Это ваш профиль', code: 'denied' }
  if (!user.isCloseFriend) return said('Этого человека нет в близких')
  if (!ctx.apiMode) return apiOnly(ctx, 'Это доступно при подключении к серверу')
  const blocked = gate(ctx, 'yes', 'Убрать из близких друзей?', 'unclose')
  if (blocked) return blocked
  const result = await ctx.profile.removeCloseFriend()
  if (!result.ok) return fail(ctx, result.error || 'Ошибка')
  return said('Убран из близких друзей')
}

async function archiveProfile(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (user.isMe) return { ok: false, spoken: 'Это ваш профиль', code: 'denied' }
  if (!ctx.apiMode) return apiOnly(ctx, 'Архив — в API-режиме')
  const blocked = gate(ctx, 'yes', 'Убрать профиль в архив?', 'archive')
  if (blocked) return blocked
  const result = await ctx.profile.archiveProfile()
  if (!result.ok) return fail(ctx, result.error || 'Не удалось')
  return said('Профиль в архиве')
}

async function reportProfile(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (user.isMe) return { ok: false, spoken: 'Это ваш профиль', code: 'denied' }
  if (!ctx.apiMode) return apiOnly(ctx, 'Жалоба доступна в API-режиме')
  const blocked = gate(ctx, 'dangerous', 'Пожаловаться на профиль? Скажите: да, подтверждаю', 'report')
  if (blocked) return blocked
  const result = await ctx.profile.reportProfile()
  if (!result.ok) return fail(ctx, result.error || 'Ошибка')
  return said('Жалоба отправлена')
}

async function shareProfile(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  const blocked = gate(ctx, 'yes', 'Открыть лист шаринга?', 'share')
  if (blocked) return blocked
  ctx.profile.openShare()
  return said('Открыт лист шаринга')
}

async function followers(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  ctx.navigate(`/app/profile/${encodeURIComponent(user.id)}/followers`)
  return said('Подписчики')
}

async function following(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  ctx.navigate(`/app/profile/${encodeURIComponent(user.id)}/following`)
  return said('Подписки')
}

async function editProfile(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (!user.isMe) return { ok: false, spoken: 'Редактировать можно только свой профиль', code: 'denied' }
  ctx.navigate('/app/profile/edit')
  return said('Редактирование')
}

async function openAvatar(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  ctx.profile.openAvatar()
  return said('Аватар')
}

async function closeAvatar(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (!user.avatarOpen) return said('Аватар закрыт')
  ctx.profile.closeAvatar()
  return said('Закрыла')
}

async function openSettings(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const user = person(ctx)
  if (!isUser(user)) return user
  if (!user.isMe) return wrongScreen(ctx)
  ctx.navigate('/app/settings')
  return said('Настройки')
}

function profile(
  partial: Omit<VoiceCommandDefinition, 'group' | 'screens'>,
): VoiceCommandDefinition {
  return { group: 'profile', screens: ['profile'], ...partial }
}

/** Profile commands P-01 … P-19. */
export const profileCommands: readonly VoiceCommandDefinition[] = [
  profile({
    id: 'P-01',
    phrases: ['прочитай профиль'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Читает имя, логин и био',
    handler: readProfile,
  }),
  profile({
    id: 'P-02',
    phrases: ['посты'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Посты',
    handler: (ctx) => setTab(ctx, 'posts', 'Посты'),
  }),
  profile({
    id: 'P-03',
    phrases: ['ответы'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Ответы',
    handler: (ctx) => setTab(ctx, 'replies', 'Ответы'),
  }),
  profile({
    id: 'P-04',
    phrases: ['медиа профиля'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Медиа',
    handler: (ctx) => setTab(ctx, 'media', 'Медиа'),
  }),
  profile({
    id: 'P-05',
    phrases: ['репосты'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Репосты',
    handler: (ctx) => setTab(ctx, 'reposts', 'Репосты'),
  }),
  profile({
    id: 'P-06',
    phrases: ['подпишись'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Подписка',
    handler: follow,
  }),
  profile({
    id: 'P-07',
    phrases: ['отпишись'],
    synonyms: [],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Отписаться?',
    handler: unfollow,
  }),
  profile({
    id: 'P-08',
    phrases: ['внимание'],
    synonyms: ['отправь внимание'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Отправить внимание?',
    handler: attention,
  }),
  profile({
    id: 'P-09',
    phrases: ['в близкие'],
    synonyms: ['добавь в близкие'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Добавить в близкие друзья?',
    handler: addClose,
  }),
  profile({
    id: 'P-10',
    phrases: ['убери из близких'],
    synonyms: [],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Убрать из близких друзей?',
    handler: removeClose,
  }),
  profile({
    id: 'P-11',
    phrases: ['профиль в архив'],
    synonyms: [],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Убрать профиль в архив?',
    handler: archiveProfile,
  }),
  profile({
    id: 'P-12',
    phrases: ['пожалуйся на профиль'],
    synonyms: [],
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Пожаловаться на профиль? Скажите: да, подтверждаю',
    handler: reportProfile,
  }),
  profile({
    id: 'P-13',
    phrases: ['поделиться профилем'],
    synonyms: [],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Открыть лист шаринга?',
    handler: shareProfile,
  }),
  profile({
    id: 'P-14',
    phrases: ['подписчики'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Подписчики',
    handler: followers,
  }),
  profile({
    id: 'P-15',
    phrases: ['подписки'],
    synonyms: ['на кого подписан'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Подписки',
    handler: following,
  }),
  profile({
    id: 'P-16',
    phrases: ['редактировать'],
    synonyms: ['измени профиль'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Редактирование',
    handler: editProfile,
  }),
  profile({
    id: 'P-17',
    phrases: ['аватар'],
    synonyms: ['открой аватар'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Аватар',
    handler: openAvatar,
  }),
  profile({
    id: 'P-18',
    phrases: ['закрой аватар'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Закрыла',
    handler: closeAvatar,
  }),
  profile({
    id: 'P-19',
    phrases: ['настройки профиля'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Настройки',
    handler: openSettings,
  }),
]
