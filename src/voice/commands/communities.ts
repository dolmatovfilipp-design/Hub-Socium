import {
  apiCreateChannel,
  apiCreateChannelPost,
  apiDeleteChannelPost,
  apiGetChannel,
  apiJoinChannel,
  apiKickChannelMember,
  apiLeaveChannel,
  apiListChannelMembers,
  apiListChannelPosts,
  apiListChannels,
  apiSetChannelMemberRole,
  type ApiChannel,
} from '../../lib/api.ts'
import { requireConfirm } from './confirm.ts'
import { refreshVoiceScreen } from './events.ts'
import { channelIdFromPath, chooseByName, hasCyrillic, isLatinSlug } from './phrase.ts'
import {
  RESULT_CANCELLED,
  SAY_API_ONLY,
  SAY_EMPTY,
  SAY_NOT_HERE,
  errorSay,
  type VoiceCommandContext,
  type VoiceCommandDefinition,
  type VoiceCommandResult,
  type VoiceMatch,
} from './types.ts'

type Member = { user_id: string; role: string; username: string; display_name: string }

let focusIndex = 0
let postFocusIndex = 0
let memberFocusIndex = 0
let membersCache: { channelId: string; items: Member[] } | null = null

export function setCommunityFocus(index: number): void {
  focusIndex = Math.max(0, index)
}

async function listChannels(ctx: VoiceCommandContext): Promise<ApiChannel[] | VoiceCommandResult> {
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  try {
    const response = await apiListChannels()
    return response.items ?? []
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function isResult(value: ApiChannel[] | VoiceCommandResult): value is VoiceCommandResult {
  return !Array.isArray(value)
}

async function openCommunity(ctx: VoiceCommandContext, match: VoiceMatch): Promise<VoiceCommandResult> {
  const listed = await listChannels(ctx)
  if (isResult(listed)) return listed
  if (!listed.length) return { say: SAY_EMPTY }
  let channel: ApiChannel | undefined
  if (match.slot.trim()) {
    const picked = chooseByName(
      match.slot,
      listed,
      (item) => [item.title, item.slug],
      'Уточните название',
    )
    if (picked.kind === 'ask') return { say: picked.say }
    if (picked.kind === 'none') return { say: 'Не нашла такое сообщество' }
    channel = picked.item
  } else {
    channel = listed[Math.min(focusIndex, listed.length - 1)]
  }
  if (!channel) return { say: SAY_EMPTY }
  focusIndex = Math.max(0, listed.findIndex((item) => item.id === channel?.id))
  return { say: 'Сообщество', navigateTo: `/app/channels/${channel.id}` }
}

async function currentChannel(ctx: VoiceCommandContext): Promise<ApiChannel | VoiceCommandResult> {
  const id = channelIdFromPath(ctx.pathname)
  if (!id) return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  try {
    return await apiGetChannel(id)
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function isChannel(value: ApiChannel | VoiceCommandResult): value is ApiChannel {
  return 'id' in value && 'title' in value && !('say' in value)
}

async function join(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  if (channel.my_role === 'owner') return { say: 'Вы владелец' }
  if (channel.joined) return { say: 'Вы уже в сообществе' }
  const accepted = await requireConfirm(ctx, 'Вступить в сообщество?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    await apiJoinChannel(channel.id)
    refreshVoiceScreen('channel')
    ctx.toast('Вы вступили')
    return { say: 'Вы вступили' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function leave(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  if (channel.my_role === 'owner') return { say: 'Вы владелец' }
  if (!channel.joined) return { say: 'Вы не в сообществе' }
  const accepted = await requireConfirm(ctx, 'Выйти из сообщества? Скажите: да, подтверждаю', 'dangerous')
  if (!accepted) return RESULT_CANCELLED
  try {
    await apiLeaveChannel(channel.id)
    refreshVoiceScreen('channel')
    ctx.toast('Вы вышли')
    return { say: 'Вы вышли' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function postText(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  if (!channel.joined) return { say: 'Сначала вступите' }
  const text = await ctx.dictate('Диктуйте пост')
  if (text === null) return RESULT_CANCELLED
  if (!text.trim()) return { say: 'Пустой пост не опубликован' }
  const accepted = await requireConfirm(ctx, 'Опубликовать пост?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    await apiCreateChannelPost(channel.id, text.trim())
    refreshVoiceScreen('channel')
    return { say: 'Пост опубликован' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function postPoll(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  if (!channel.joined) return { say: 'Сначала вступите' }
  const question = await ctx.dictate('Назовите вопрос')
  if (question === null) return RESULT_CANCELLED
  if (!question.trim()) return { say: 'Нужны вопрос и хотя бы два варианта' }
  const options: string[] = []
  while (options.length < 10) {
    const prompt = options.length < 2 ? `Вариант ${options.length + 1}` : 'Ещё вариант или скажите готово'
    const line = await ctx.dictate(prompt)
    if (line === null) return RESULT_CANCELLED
    const trimmed = line.trim()
    if (!trimmed || trimmed.toLowerCase().replace(/ё/g, 'е') === 'готово' || trimmed.toLowerCase().replace(/ё/g, 'е') === 'хватит') {
      break
    }
    options.push(trimmed)
  }
  if (options.length < 2) return { say: 'Нужны вопрос и хотя бы два варианта' }
  const accepted = await requireConfirm(ctx, 'Опубликовать опрос?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    await apiCreateChannelPost(channel.id, question.trim(), { question: question.trim(), options })
    refreshVoiceScreen('channel')
    return { say: 'Опрос опубликован' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function deletePost(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  try {
    const response = await apiListChannelPosts(channel.id)
    const posts = response.items ?? []
    const post = posts[Math.min(postFocusIndex, Math.max(0, posts.length - 1))]
    if (!post) return { say: SAY_EMPTY }
    const me = ctx.currentUserId()
    const isMod = channel.my_role === 'owner' || channel.my_role === 'admin'
    if (post.author_id !== me && !isMod) return { say: 'Чужой пост без прав не удаляется' }
    const accepted = await requireConfirm(ctx, 'Удалить пост? Скажите: да, подтверждаю', 'dangerous')
    if (!accepted) return RESULT_CANCELLED
    await apiDeleteChannelPost(channel.id, post.id)
    refreshVoiceScreen('channel')
    ctx.toast('Пост удалён')
    return { say: 'Пост удалён' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function showMembers(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  const isMod = channel.my_role === 'owner' || channel.my_role === 'admin'
  if (!isMod) return { say: 'Список участников вам недоступен' }
  try {
    const response = await apiListChannelMembers(channel.id)
    const items = response.items ?? []
    membersCache = { channelId: channel.id, items }
    memberFocusIndex = 0
    if (!items.length) return { say: 'Участники' }
    const names = items.map((member) => member.display_name || member.username).join(', ')
    return { say: `Участники. ${names}` }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function loadMembers(channel: ApiChannel): Promise<Member[]> {
  if (membersCache?.channelId === channel.id) return membersCache.items
  const response = await apiListChannelMembers(channel.id)
  const items = response.items ?? []
  membersCache = { channelId: channel.id, items }
  return items
}

function canKick(channel: ApiChannel, member: Member, me: string | null): boolean {
  const isMod = channel.my_role === 'owner' || channel.my_role === 'admin'
  if (!isMod || member.user_id === me || member.role === 'owner') return false
  if (channel.my_role === 'admin' && member.role === 'admin') return false
  return true
}

async function pickMember(channel: ApiChannel, match: VoiceMatch): Promise<Member | VoiceCommandResult> {
  const items = await loadMembers(channel)
  if (!items.length) return { say: 'Список участников вам недоступен' }
  if (!match.slot.trim()) {
    const focused = items[Math.min(memberFocusIndex, items.length - 1)]
    return focused ?? { say: SAY_EMPTY }
  }
  const picked = chooseByName(
    match.slot,
    items,
    (member) => [member.display_name, member.username],
    'Уточните имя',
  )
  if (picked.kind === 'ask') return { say: picked.say }
  if (picked.kind === 'none') return { say: 'Не нашла такого участника' }
  return picked.item
}

function isMember(value: Member | VoiceCommandResult): value is Member {
  return 'user_id' in value
}

async function kick(ctx: VoiceCommandContext, match: VoiceMatch): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  const isMod = channel.my_role === 'owner' || channel.my_role === 'admin'
  if (!isMod) return { say: 'Список участников вам недоступен' }
  try {
    const member = await pickMember(channel, match)
    if (!isMember(member)) return member
    if (member.role === 'owner') return { say: 'Владельца исключить нельзя' }
    if (!canKick(channel, member, ctx.currentUserId())) return { say: 'Исключить этого участника нельзя' }
    const accepted = await requireConfirm(ctx, 'Исключить? Скажите: да, подтверждаю', 'dangerous')
    if (!accepted) return RESULT_CANCELLED
    await apiKickChannelMember(channel.id, member.user_id)
    membersCache = null
    refreshVoiceScreen('channel')
    ctx.toast('Участник исключён')
    return { say: 'Участник исключён' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function setRole(ctx: VoiceCommandContext, match: VoiceMatch): Promise<VoiceCommandResult> {
  const channel = await currentChannel(ctx)
  if (!isChannel(channel)) return channel
  if (channel.my_role !== 'owner') return { say: 'Изменить роль может только владелец' }
  const role: 'admin' | 'member' = match.phrase === 'сними админа' ? 'member' : 'admin'
  try {
    const member = await pickMember(channel, match)
    if (!isMember(member)) return member
    if (member.role === 'owner') return { say: 'Роль владельца не меняется' }
    if (member.role === role) return { say: role === 'admin' ? 'Уже админ' : 'Это не админ' }
    const accepted = await requireConfirm(ctx, 'Изменить роль? Скажите: да, подтверждаю', 'dangerous')
    if (!accepted) return RESULT_CANCELLED
    await apiSetChannelMemberRole(channel.id, member.user_id, role)
    membersCache = null
    refreshVoiceScreen('channel')
    return { say: role === 'admin' ? 'Админ назначен' : 'Права админа сняты' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function createCommunity(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (channelIdFromPath(ctx.pathname) || ctx.pathname !== '/app/channels') return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  const title = await ctx.dictate('Название')
  if (title === null) return RESULT_CANCELLED
  const slugRaw = await ctx.dictate('Адрес латиницей')
  if (slugRaw === null) return RESULT_CANCELLED
  if (hasCyrillic(slugRaw)) return { say: 'Продиктуйте адрес латиницей' }
  const slug = slugRaw.trim().toLowerCase()
  if (!isLatinSlug(slug)) return { say: 'Продиктуйте адрес латиницей' }
  const description = await ctx.dictate('Описание')
  if (description === null) return RESULT_CANCELLED
  const rules = await ctx.dictate('Правила')
  if (rules === null) return RESULT_CANCELLED
  if (!title.trim()) return { say: 'Нужно название и адрес' }
  const accepted = await requireConfirm(ctx, 'Создать сообщество?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    const created = await apiCreateChannel({
      title: title.trim(),
      slug,
      description: description.trim(),
      rules: rules.trim(),
    })
    refreshVoiceScreen('channels')
    ctx.toast('Сообщество создано')
    return { say: 'Сообщество создано', navigateTo: `/app/channels/${created.id}` }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

export const communitiesCommands: readonly VoiceCommandDefinition[] = [
  {
    id: 'G-19',
    title: 'Сообщества',
    group: 'Общие',
    phrases: ['сообщества'],
    synonyms: ['каналы'],
    screens: ['*'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Сообщества',
    starter: true,
    handler: () => Promise.resolve({ say: 'Сообщества', navigateTo: '/app/channels' }),
  },
  {
    id: 'CN-01',
    title: 'Открыть сообщество',
    group: 'Сообщества',
    phrases: ['открой сообщество'],
    synonyms: [],
    screens: ['channels', 'channel'],
    slot: 'name',
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Сообщество',
    starter: true,
    handler: openCommunity,
  },
  {
    id: 'CN-02',
    title: 'Вступить',
    group: 'Сообщества',
    phrases: ['вступи'],
    synonyms: [],
    screens: ['channel'],
    confirmation: 'yes',
    confirmPrompt: 'Вступить в сообщество?',
    reply: 'Вступить в сообщество?',
    starter: false,
    handler: (ctx) => join(ctx),
  },
  {
    id: 'CN-03',
    title: 'Выйти из сообщества',
    group: 'Сообщества',
    phrases: ['выйти из сообщества'],
    synonyms: [],
    screens: ['channel'],
    confirmation: 'dangerous',
    confirmPrompt: 'Выйти из сообщества? Скажите: да, подтверждаю',
    reply: 'Выйти из сообщества? Скажите: да, подтверждаю',
    starter: false,
    handler: (ctx) => leave(ctx),
  },
  {
    id: 'CN-04',
    title: 'Пост в сообщество',
    group: 'Сообщества',
    phrases: ['напиши в сообщество'],
    synonyms: [],
    screens: ['channel'],
    confirmation: 'yes',
    confirmInHandler: true,
    confirmPrompt: 'Опубликовать пост?',
    reply: 'Диктуйте пост',
    starter: false,
    handler: (ctx) => postText(ctx),
  },
  {
    id: 'CN-05',
    title: 'Опрос в сообществе',
    group: 'Сообщества',
    phrases: ['опрос'],
    synonyms: [],
    screens: ['channel'],
    confirmation: 'yes',
    confirmInHandler: true,
    confirmPrompt: 'Опубликовать опрос?',
    reply: 'Назовите вопрос и варианты',
    starter: false,
    handler: (ctx) => postPoll(ctx),
  },
  {
    id: 'CN-06',
    title: 'Удалить пост сообщества',
    group: 'Сообщества',
    phrases: ['удали пост сообщества'],
    synonyms: [],
    screens: ['channel'],
    confirmation: 'dangerous',
    confirmPrompt: 'Удалить пост? Скажите: да, подтверждаю',
    reply: 'Удалить пост? Скажите: да, подтверждаю',
    starter: false,
    handler: (ctx) => deletePost(ctx),
  },
  {
    id: 'CN-07',
    title: 'Участники',
    group: 'Сообщества',
    phrases: ['участники'],
    synonyms: [],
    screens: ['channel'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Участники',
    starter: true,
    handler: (ctx) => showMembers(ctx),
  },
  {
    id: 'CN-08',
    title: 'Исключить из сообщества',
    group: 'Сообщества',
    phrases: ['исключи из сообщества'],
    synonyms: [],
    screens: ['channel'],
    slot: 'name',
    confirmation: 'dangerous',
    confirmPrompt: 'Исключить? Скажите: да, подтверждаю',
    reply: 'Исключить? Скажите: да, подтверждаю',
    starter: false,
    handler: kick,
  },
  {
    id: 'CN-09',
    title: 'Сделать админом',
    group: 'Сообщества',
    phrases: ['сделай админом'],
    synonyms: ['сними админа'],
    screens: ['channel'],
    slot: 'name',
    confirmation: 'dangerous',
    confirmPrompt: 'Изменить роль? Скажите: да, подтверждаю',
    reply: 'Изменить роль? Скажите: да, подтверждаю',
    starter: false,
    handler: setRole,
  },
  {
    id: 'CN-10',
    title: 'Создать сообщество',
    group: 'Сообщества',
    phrases: ['создай сообщество'],
    synonyms: [],
    screens: ['channels'],
    confirmation: 'yes',
    confirmInHandler: true,
    confirmPrompt: 'Создать сообщество?',
    reply: 'Название, адрес, описание и правила',
    starter: false,
    handler: (ctx) => createCommunity(ctx),
  },
]
