import { apiCatchUp, apiCreateReminder, apiSetTranslatePref } from '../../../lib/liveApi.ts'
import { chatIdFromPath } from './phrase.ts'
import type { VoiceCommandDefinition } from './types.ts'

function emit(action: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('hub:chat-action', { detail: action }))
}

export const liveChatCommands: VoiceCommandDefinition[] = [
  {
    id: 'C-40',
    title: 'Что я пропустил',
    group: 'Чат',
    phrases: ['что я пропустил', 'что я пропустила'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Смотрю, что вы пропустили',
    starter: false,
    handler: async (ctx) => {
      const id = chatIdFromPath(ctx.pathname)
      emit('missed')
      if (id && ctx.isApiMode()) {
        const res = await apiCatchUp(id).catch(() => null)
        if (res?.disabled) return { say: res.message || 'AI не подключён' }
        if (res?.summary) return { say: res.summary }
      }
      return { say: 'Смотрю, что вы пропустили' }
    },
  },
  {
    id: 'C-41',
    title: 'Умные ответы',
    group: 'Чат',
    phrases: ['умные ответы'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Подбираю ответы',
    starter: false,
    handler: async () => {
      emit('replies')
      return { say: 'Подбираю ответы' }
    },
  },
  {
    id: 'C-42',
    title: 'Перевод чата',
    group: 'Чат',
    phrases: ['включи перевод', 'выключи перевод'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Перевод',
    starter: false,
    handler: async (ctx, match) => {
      const id = chatIdFromPath(ctx.pathname)
      const on = match.phrase.startsWith('включи')
      emit(on ? 'translate-on' : 'translate-off')
      if (id && ctx.isApiMode()) {
        const res = await apiSetTranslatePref(id, on, 'ru').catch(() => null)
        if (res?.disabled || res?.message) return { say: res.message || 'Перевод не подключён' }
      }
      return { say: on ? 'Перевод включён' : 'Перевод выключен' }
    },
  },
  {
    id: 'C-43',
    title: 'Напомнить ответить',
    group: 'Чат',
    phrases: ['напомни ответить'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Напомню ответить через час',
    starter: false,
    handler: async (ctx) => {
      const id = chatIdFromPath(ctx.pathname)
      emit('remind')
      if (id && ctx.isApiMode()) {
        const at = new Date(Date.now() + 60 * 60 * 1000).toISOString()
        await apiCreateReminder(id, at, 'Ответить позже').catch(() => null)
      }
      return { say: 'Напомню ответить через час' }
    },
  },
  {
    id: 'C-44',
    title: 'Исчезающие сообщения',
    group: 'Чат',
    phrases: ['исчезающие сообщения'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Таймер чата',
    starter: false,
    handler: async () => {
      emit('disappear')
      return { say: 'Таймер чата' }
    },
  },
  {
    id: 'C-45',
    title: 'Стикер',
    group: 'Чат',
    phrases: ['создать стикер'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Опишите стикер',
    starter: false,
    handler: async () => {
      emit('sticker')
      return { say: 'Опишите стикер' }
    },
  },
  {
    id: 'C-46',
    title: 'Ветка',
    group: 'Чат',
    phrases: ['открыть ветку'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Ветка',
    starter: false,
    handler: async () => {
      emit('thread')
      return { say: 'Открываю ветку' }
    },
  },
  {
    id: 'C-47',
    title: 'Заказ в чате',
    group: 'Чат',
    phrases: ['создать заказ'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Карточка заказа',
    starter: false,
    handler: async () => {
      emit('order')
      return { say: 'Карточка заказа' }
    },
  },
  {
    id: 'C-48',
    title: 'Черновик продавца',
    group: 'Чат',
    phrases: ['черновик продавца'],
    synonyms: [],
    screens: ['chat'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Готовлю ответ',
    starter: false,
    handler: async () => {
      emit('seller')
      return { say: 'Готовлю ответ' }
    },
  },
]
