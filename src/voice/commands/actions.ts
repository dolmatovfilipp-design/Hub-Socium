import {
  apiAcceptGroupInvite,
  apiApproveFollowRequest,
  apiDeclineGroupInvite,
  apiDenyFollowRequest,
  apiListActivity,
  apiListFollowRequests,
  type ApiActivityItem,
} from '../../lib/api.ts'
import { requireConfirm } from './confirm.ts'
import { VOICE_ACTIVITY, emitVoice } from './events.ts'
import {
  RESULT_CANCELLED,
  SAY_API_ONLY,
  SAY_EMPTY,
  errorSay,
  type LocalActivityCard,
  type VoiceCommandContext,
  type VoiceCommandDefinition,
  type VoiceCommandResult,
} from './types.ts'

type Filter = 'all' | 'follows' | 'replies' | 'mentions'

type Row =
  | { kind: 'request'; id: string; userId: string; name: string }
  | { kind: 'invite'; id: string; userId: string; name: string; conversationId: string; title: string }
  | { kind: 'event'; id: string; userId: string; name: string; eventType: string; postId?: string; text?: string; read: boolean }

const LABELS: Record<string, string> = {
  like: 'нравится ваша публикация',
  follow: 'подписались на вас',
  mention: 'упомянули вас',
  reply: 'ответили вам',
  comment: 'ответили вам',
  repost: 'сделали репост',
  follow_request: 'подписались на вас',
}

let filter: Filter = 'all'
let index = 0
let cache: Row[] | null = null

function describe(row: Row): string {
  if (row.kind === 'request') return `${row.name} просит подписку`
  if (row.kind === 'invite') return `${row.name} пригласили в группу «${row.title}»`
  const action = LABELS[row.eventType] || 'написали вам'
  return row.text ? `${row.name} ${action}: «${row.text}»` : `${row.name} ${action}`
}

function localRows(cards: LocalActivityCard[]): Row[] {
  return cards
    .filter((card) => {
      if (filter === 'follows') return card.type === 'follow'
      if (filter === 'replies') return card.type === 'reply'
      if (filter === 'mentions') return card.type === 'mention'
      return true
    })
    .map((card) => ({
      kind: 'event' as const,
      id: card.id,
      userId: card.actorId,
      name: card.actorName || 'Кто-то',
      eventType: card.type,
      postId: card.targetPostId,
      text: card.text,
      read: card.read,
    }))
}

function eventRow(item: ApiActivityItem): Row | null {
  if (item.type === 'group_invite') {
    const conversationId = typeof item.meta?.conversation_id === 'string' ? item.meta.conversation_id : ''
    const title = typeof item.meta?.title === 'string' && item.meta.title ? item.meta.title : 'группу'
    return {
      kind: 'invite',
      id: item.id,
      userId: item.actor?.id || item.actor_id,
      name: item.actor?.display_name || item.actor?.username || 'Кто-то',
      conversationId,
      title,
    }
  }
  const text = typeof item.meta?.text === 'string' ? item.meta.text : undefined
  return {
    kind: 'event',
    id: item.id,
    userId: item.actor?.id || item.actor_id,
    name: item.actor?.display_name || item.actor?.username || 'Кто-то',
    eventType: item.type,
    postId: item.post_id || undefined,
    text,
    read: item.read,
  }
}

async function load(ctx: VoiceCommandContext): Promise<Row[] | VoiceCommandResult> {
  if (cache) return cache
  if (!ctx.isApiMode()) {
    cache = localRows(ctx.localActivities())
    return cache
  }
  try {
    const [requests, activity] = await Promise.all([
      apiListFollowRequests().catch(() => ({ items: [] })),
      apiListActivity(filter, 30),
    ])
    const rows: Row[] = []
    for (const request of requests.items ?? []) {
      rows.push({
        kind: 'request',
        id: request.id,
        userId: request.from_user.id,
        name: request.from_user.display_name || request.from_user.username,
      })
    }
    for (const item of activity.items ?? []) {
      const row = eventRow(item)
      if (row) rows.push(row)
    }
    cache = rows
    return rows
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function isRows(value: Row[] | VoiceCommandResult): value is Row[] {
  return Array.isArray(value)
}

function focused(rows: Row[]): Row | undefined {
  if (!rows.length) return undefined
  if (index < 0) index = 0
  if (index >= rows.length) index = rows.length - 1
  return rows[index]
}

function hide(id: string, bucket: 'event' | 'request'): void {
  cache = (cache ?? []).filter((row) => row.id !== id)
  if (index >= (cache?.length ?? 0)) index = Math.max(0, (cache?.length ?? 1) - 1)
  emitVoice(VOICE_ACTIVITY, { type: 'hide', id, bucket })
}

async function readNew(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  cache = null
  const rows = await load(ctx)
  if (!isRows(rows)) return rows
  const events = rows.filter((row): row is Extract<Row, { kind: 'event' }> => row.kind === 'event')
  const unread = events.filter((row) => !row.read)
  const spoken = unread.length ? unread : events
  if (!spoken.length) return { say: 'Пока тихо' }
  return { say: `Читаю новое. ${spoken.map((row) => describe(row)).join('. ')}` }
}

async function step(ctx: VoiceCommandContext, direction: 1 | -1): Promise<VoiceCommandResult> {
  const rows = await load(ctx)
  if (!isRows(rows)) return rows
  if (!rows.length) return { say: direction > 0 ? 'Дальше событий нет' : 'Это первое событие' }
  const next = index + direction
  if (next < 0) return { say: 'Это первое событие' }
  if (next >= rows.length) return { say: 'Дальше событий нет' }
  index = next
  const row = rows[index]
  if (!row) return { say: SAY_EMPTY }
  const prefix = direction > 0 ? 'Следующее' : 'Предыдущее'
  return { say: `${prefix}. ${describe(row)}` }
}

async function openRow(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const rows = await load(ctx)
  if (!isRows(rows)) return rows
  const row = focused(rows)
  if (!row) return { say: SAY_EMPTY }
  if (row.kind === 'event' && row.postId) return { say: 'Открываю', navigateTo: `/app/p/${row.postId}` }
  return { say: 'Открываю', navigateTo: `/app/profile/${row.userId}` }
}

async function openProfile(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const rows = await load(ctx)
  if (!isRows(rows)) return rows
  const row = focused(rows)
  if (!row) return { say: SAY_EMPTY }
  return { say: 'Профиль', navigateTo: `/app/profile/${row.userId}` }
}

function setFilter(next: Filter, reply: string): VoiceCommandResult {
  filter = next
  index = 0
  cache = null
  emitVoice(VOICE_ACTIVITY, { type: 'filter', filter: next })
  return { say: reply }
}

async function accept(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  const rows = await load(ctx)
  if (!isRows(rows)) return rows
  const row = focused(rows)
  if (!row || (row.kind !== 'request' && row.kind !== 'invite')) return { say: 'Здесь нечего принимать' }
  const accepted = await requireConfirm(ctx, 'Принять?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    if (row.kind === 'request') {
      await apiApproveFollowRequest(row.id)
      hide(row.id, 'request')
      ctx.toast('Запрос принят')
      return { say: 'Запрос принят' }
    }
    if (!row.conversationId) return { say: 'Здесь нечего принимать' }
    await apiAcceptGroupInvite(row.conversationId)
    hide(row.id, 'event')
    ctx.toast('Вы в группе')
    return { say: 'Вы в группе', navigateTo: `/app/messages/${row.conversationId}` }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function decline(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  const rows = await load(ctx)
  if (!isRows(rows)) return rows
  const row = focused(rows)
  if (!row || (row.kind !== 'request' && row.kind !== 'invite')) return { say: 'Здесь нечего отклонять' }
  const accepted = await requireConfirm(ctx, 'Отклонить?', 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    if (row.kind === 'request') await apiDenyFollowRequest(row.id)
    else {
      if (!row.conversationId) return { say: 'Здесь нечего отклонять' }
      await apiDeclineGroupInvite(row.conversationId)
    }
    hide(row.id, row.kind === 'request' ? 'request' : 'event')
    ctx.toast('Отклонено')
    return { say: 'Отклонено' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function removeEvent(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const rows = await load(ctx)
  if (!isRows(rows)) return rows
  const row = focused(rows)
  if (!row || row.kind === 'request') return { say: SAY_EMPTY }
  const accepted = await requireConfirm(ctx, 'Удалить карточку события? Скажите: да, подтверждаю', 'dangerous')
  if (!accepted) return RESULT_CANCELLED
  if (ctx.isApiMode()) {
    hide(row.id, 'event')
    return { say: 'Убрала с этого экрана. На сервере событие может остаться' }
  }
  ctx.removeLocalActivity(row.id)
  hide(row.id, 'event')
  return { say: 'Убрала с этого экрана' }
}

export const actionsCommands: readonly VoiceCommandDefinition[] = [
  {
    id: 'G-07',
    title: 'Действия',
    group: 'Общие',
    phrases: ['действия'],
    synonyms: ['уведомления', 'открой действия'],
    screens: ['*'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Действия',
    starter: true,
    handler: () => Promise.resolve({ say: 'Действия', navigateTo: '/app/activity' }),
  },
  {
    id: 'A-01',
    title: 'Что нового',
    group: 'Действия',
    phrases: ['что нового'],
    synonyms: ['прочитай новое'],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Читаю новое',
    starter: true,
    handler: (ctx) => readNew(ctx),
  },
  {
    id: 'A-02',
    title: 'Следующее',
    group: 'Действия',
    phrases: ['следующее'],
    synonyms: ['дальше событие'],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Следующее',
    starter: true,
    handler: (ctx) => step(ctx, 1),
  },
  {
    id: 'A-03',
    title: 'Предыдущее событие',
    group: 'Действия',
    phrases: ['предыдущее событие'],
    synonyms: [],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Предыдущее',
    starter: true,
    handler: (ctx) => step(ctx, -1),
  },
  {
    id: 'A-04',
    title: 'Открыть событие',
    group: 'Действия',
    phrases: ['открой'],
    synonyms: ['открой событие'],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Открываю',
    starter: true,
    handler: (ctx) => openRow(ctx),
  },
  {
    id: 'A-05',
    title: 'Профиль в событии',
    group: 'Действия',
    phrases: ['профиль автора события'],
    synonyms: [],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Профиль',
    starter: true,
    handler: (ctx) => openProfile(ctx),
  },
  {
    id: 'A-06',
    title: 'Фильтр все',
    group: 'Действия',
    phrases: ['все события'],
    synonyms: ['фильтр все'],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Фильтр: все',
    starter: true,
    handler: () => Promise.resolve(setFilter('all', 'Фильтр: все')),
  },
  {
    id: 'A-07',
    title: 'Фильтр подписки',
    group: 'Действия',
    phrases: ['только подписки'],
    synonyms: [],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Фильтр: подписки',
    starter: true,
    handler: () => Promise.resolve(setFilter('follows', 'Фильтр: подписки')),
  },
  {
    id: 'A-08',
    title: 'Фильтр ответы',
    group: 'Действия',
    phrases: ['только ответы'],
    synonyms: [],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Фильтр: ответы',
    starter: true,
    handler: () => Promise.resolve(setFilter('replies', 'Фильтр: ответы')),
  },
  {
    id: 'A-09',
    title: 'Фильтр упоминания',
    group: 'Действия',
    phrases: ['только упоминания'],
    synonyms: [],
    screens: ['activity'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Фильтр: упоминания',
    starter: true,
    handler: () => Promise.resolve(setFilter('mentions', 'Фильтр: упоминания')),
  },
  {
    id: 'A-10',
    title: 'Принять',
    group: 'Действия',
    phrases: ['прими'],
    synonyms: ['принять'],
    screens: ['activity'],
    confirmation: 'yes',
    confirmPrompt: 'Принять?',
    reply: 'Принять?',
    starter: false,
    handler: (ctx) => accept(ctx),
  },
  {
    id: 'A-11',
    title: 'Отклонить',
    group: 'Действия',
    phrases: ['отклони'],
    synonyms: ['отклонить'],
    screens: ['activity'],
    confirmation: 'yes',
    confirmPrompt: 'Отклонить?',
    reply: 'Отклонить?',
    starter: false,
    handler: (ctx) => decline(ctx),
  },
  {
    id: 'A-12',
    title: 'Удалить событие',
    group: 'Действия',
    phrases: ['удали событие'],
    synonyms: [],
    screens: ['activity'],
    confirmation: 'dangerous',
    confirmPrompt: 'Удалить карточку события? Скажите: да, подтверждаю',
    reply: 'Удалить карточку события? Скажите: да, подтверждаю',
    starter: false,
    handler: (ctx) => removeEvent(ctx),
  },
]
