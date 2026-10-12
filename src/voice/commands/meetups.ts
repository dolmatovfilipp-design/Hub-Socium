import {
  apiCreateMeetup,
  apiGetMeetup,
  apiListMeetups,
  apiMeetupCancel,
  apiMeetupGoing,
} from '../../lib/api.ts'
import { requireConfirm } from './confirm.ts'
import { refreshVoiceScreen } from './events.ts'
import { chooseByName, meetupIdFromPath, parseRuDateTime } from './phrase.ts'
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

interface MeetupCard {
  id: string
  title?: string
  city?: string
  place?: string
  description?: string
  starts_at?: string
  going?: number
  i_go?: boolean
  conversation_id?: string
}

let focusIndex = 0

function formatWhen(value?: string): string {
  if (!value) return 'время не указано'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'время не указано'
  return date.toLocaleString('ru-RU')
}

function readCard(card: MeetupCard): string {
  const title = card.title?.trim() || 'Без названия'
  const place = [card.city, card.place].filter(Boolean).join(', ') || 'место не указано'
  const description = card.description?.trim() ? card.description.trim() : 'Без описания'
  const guests = card.going ?? 0
  return `${title}. ${description}. ${place}. ${formatWhen(card.starts_at)}. Гостей: ${guests}.`
}

async function listed(ctx: VoiceCommandContext): Promise<MeetupCard[] | VoiceCommandResult> {
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  try {
    const response = await apiListMeetups()
    return (response.items ?? []) as MeetupCard[]
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function isCards(value: MeetupCard[] | VoiceCommandResult): value is MeetupCard[] {
  return Array.isArray(value)
}

async function openMeetup(ctx: VoiceCommandContext, match: VoiceMatch): Promise<VoiceCommandResult> {
  const items = await listed(ctx)
  if (!isCards(items)) return items
  if (!items.length) return { say: SAY_EMPTY }
  let card: MeetupCard | undefined
  if (match.slot.trim()) {
    const picked = chooseByName(match.slot, items, (item) => [item.title || ''], 'Уточните название')
    if (picked.kind === 'ask') return { say: picked.say }
    if (picked.kind === 'none') return { say: 'Не нашла такую встречу' }
    card = picked.item
  } else {
    const current = meetupIdFromPath(ctx.pathname)
    card = (current ? items.find((item) => item.id === current) : undefined) ?? items[Math.min(focusIndex, items.length - 1)]
  }
  if (!card) return { say: SAY_EMPTY }
  focusIndex = Math.max(0, items.findIndex((item) => item.id === card?.id))
  return { say: 'Встреча', navigateTo: `/app/meetups/${card.id}` }
}

async function readMeetup(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  const id = meetupIdFromPath(ctx.pathname)
  try {
    if (id) {
      const card = (await apiGetMeetup(id)) as MeetupCard
      return { say: readCard(card) }
    }
    const items = await listed(ctx)
    if (!isCards(items)) return items
    const card = items[Math.min(focusIndex, Math.max(0, items.length - 1))]
    if (!card) return { say: SAY_EMPTY }
    return { say: readCard(card) }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function detail(ctx: VoiceCommandContext): Promise<MeetupCard | VoiceCommandResult> {
  const id = meetupIdFromPath(ctx.pathname)
  if (!id) return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  try {
    return (await apiGetMeetup(id)) as MeetupCard
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function isMeetup(value: MeetupCard | VoiceCommandResult): value is MeetupCard {
  return 'id' in value && !('say' in value)
}

async function going(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const card = await detail(ctx)
  if (!isMeetup(card)) return card
  if (card.i_go) return { say: 'Вы уже идёте' }
  const accepted = await requireConfirm(ctx, 'Отметить, что вы идёте?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    const result = await apiMeetupGoing(card.id)
    refreshVoiceScreen('meetup')
    ctx.toast('Вы идёте')
    if (result.conversation_id) {
      const openChat = await requireConfirm(ctx, 'Открыть чат?', 'yes')
      if (openChat) return { say: 'Чат', navigateTo: `/app/messages/${result.conversation_id}` }
    }
    return { say: 'Вы идёте' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function notGoing(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const card = await detail(ctx)
  if (!isMeetup(card)) return card
  if (!card.i_go) return { say: 'Вы и так не идёте' }
  const accepted = await requireConfirm(ctx, 'Снять участие?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    await apiMeetupCancel(card.id)
    refreshVoiceScreen('meetup')
    ctx.toast('Отменено')
    return { say: 'Участие снято' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function openChat(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const card = await detail(ctx)
  if (!isMeetup(card)) return card
  if (!card.i_go || !card.conversation_id) return { say: 'Сначала отметьте, что идёте' }
  return { say: 'Чат', navigateTo: `/app/messages/${card.conversation_id}` }
}

async function createMeetup(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (ctx.pathname !== '/app/meetups') return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  const title = await ctx.dictate('Название')
  if (title === null) return RESULT_CANCELLED
  const city = await ctx.dictate('Город')
  if (city === null) return RESULT_CANCELLED
  const place = await ctx.dictate('Место')
  if (place === null) return RESULT_CANCELLED
  const dateRaw = await ctx.dictate('Дата и время')
  if (dateRaw === null) return RESULT_CANCELLED
  const starts = parseRuDateTime(dateRaw)
  if (!title.trim() || !starts) {
    if (!starts) return { say: 'Дату не разобрала. Назовите день, месяц, год и время.' }
    return { say: 'Без названия и даты встречу не создать' }
  }
  const accepted = await requireConfirm(ctx, 'Создать встречу?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    const created = await apiCreateMeetup({
      title: title.trim(),
      city: city.trim(),
      place: place.trim(),
      starts_at: starts.toISOString(),
    })
    refreshVoiceScreen('meetups')
    ctx.toast('Встреча создана')
    const id = typeof created?.id === 'string' ? created.id : ''
    return { say: 'Встреча создана', navigateTo: id ? `/app/meetups/${id}` : undefined }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

export const meetupsCommands: readonly VoiceCommandDefinition[] = [
  {
    id: 'G-20',
    title: 'Встречи',
    group: 'Общие',
    phrases: ['встречи'],
    synonyms: [],
    screens: ['*'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Встречи',
    starter: true,
    handler: () => Promise.resolve({ say: 'Встречи', navigateTo: '/app/meetups' }),
  },
  {
    id: 'MT-01',
    title: 'Открыть встречу',
    group: 'Встречи',
    phrases: ['открой встречу'],
    synonyms: [],
    screens: ['meetups', 'meetup'],
    slot: 'name',
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Встреча',
    starter: true,
    handler: openMeetup,
  },
  {
    id: 'MT-02',
    title: 'Прочитай встречу',
    group: 'Встречи',
    phrases: ['прочитай встречу'],
    synonyms: [],
    screens: ['meetups', 'meetup'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Читает название, место, время и число гостей',
    starter: true,
    handler: (ctx) => readMeetup(ctx),
  },
  {
    id: 'MT-03',
    title: 'Пойду',
    group: 'Встречи',
    phrases: ['пойду'],
    synonyms: [],
    screens: ['meetup'],
    confirmation: 'yes',
    confirmPrompt: 'Отметить, что вы идёте?',
    reply: 'Отметить, что вы идёте?',
    starter: false,
    handler: (ctx) => going(ctx),
  },
  {
    id: 'MT-04',
    title: 'Не пойду',
    group: 'Встречи',
    phrases: ['не пойду'],
    synonyms: [],
    screens: ['meetup'],
    confirmation: 'yes',
    confirmPrompt: 'Снять участие?',
    reply: 'Снять участие?',
    starter: false,
    handler: (ctx) => notGoing(ctx),
  },
  {
    id: 'MT-05',
    title: 'Чат встречи',
    group: 'Встречи',
    phrases: ['чат встречи'],
    synonyms: [],
    screens: ['meetup'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Чат',
    starter: true,
    handler: (ctx) => openChat(ctx),
  },
  {
    id: 'MT-06',
    title: 'Создать встречу',
    group: 'Встречи',
    phrases: ['создай встречу'],
    synonyms: [],
    screens: ['meetups'],
    confirmation: 'yes',
    confirmInHandler: true,
    confirmPrompt: 'Создать встречу?',
    reply: 'Название, город, место и дата',
    starter: false,
    handler: (ctx) => createMeetup(ctx),
  },
]
