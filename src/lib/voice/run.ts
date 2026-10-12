import {
  apiCreateConversation,
  apiListConversations,
  apiSearchUsers,
  isApiMode,
} from '../api'
import { useStore } from '../../store/useStore'
import { ambiguous, helpLine, rankNames, screenTitle, type VoiceIntent } from './match'

export async function runVoiceIntent(
  intent: VoiceIntent,
  path: string,
  navigate: (to: string | number) => void,
): Promise<string> {
  switch (intent.type) {
    case 'unknown':
      return ''
    case 'stop':
      window.speechSynthesis?.cancel()
      return 'Остановила'
    case 'back':
      navigate(-1)
      return 'Назад'
    case 'help':
      return helpLine(path)
    case 'where':
      return screenTitle(path)
    case 'voice-off':
      return ''
    case 'nav': {
      if (intent.feedTab) {
        window.dispatchEvent(new CustomEvent('hub:voice-feed-tab', { detail: intent.feedTab }))
      }
      if (path !== intent.to) navigate(intent.to)
      return intent.say
    }
    case 'read-last':
      return readMessage(path, false)
    case 'read-incoming':
      return readMessage(path, true)
    case 'open-chat':
      return openChat(intent.query, navigate)
    default:
      return ''
  }
}

function readMessage(path: string, incomingOnly: boolean): string {
  if (!path.startsWith('/app/messages/')) return 'Эта команда здесь не действует'
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-voice-msg]'))
  const list = incomingOnly ? nodes.filter((node) => node.getAttribute('data-voice-mine') === '0') : nodes
  const node = list[list.length - 1]
  if (!node) return incomingOnly ? 'Входящих на экране нет' : 'В чате пусто'
  const text = node.getAttribute('data-voice-msg') || ''
  return text || 'Пустое сообщение'
}

async function openChat(query: string, navigate: (to: string) => void): Promise<string> {
  if (isApiMode()) {
    try {
      const conv = await apiListConversations()
      const rows = (conv.items ?? []).map((item) => ({
        id: item.id,
        label: item.is_group ? item.title || 'Группа' : item.peer?.display_name || item.peer?.username || '',
        username: item.is_group ? '' : item.peer?.username,
        kind: 'chat' as const,
        userId: item.peer?.id,
      }))
      const ranked = rankNames(query, rows)
      if (ranked.length && !ambiguous(ranked)) {
        navigate(`/app/messages/${ranked[0].id}`)
        return `Открываю чат с ${ranked[0].label}`
      }
      if (ambiguous(ranked) && ranked[1]) {
        return `${ranked[0].label} или ${ranked[1].label}?`
      }
      const found = await apiSearchUsers({ q: query, limit: 8 })
      const people = rankNames(
        query,
        (found.items ?? []).map((user) => ({
          id: user.id,
          label: user.display_name || user.username,
          username: user.username,
        })),
      )
      if (!people.length) return 'Такого чата нет'
      if (ambiguous(people) && people[1]) return `${people[0].label} или ${people[1].label}?`
      const created = await apiCreateConversation({ user_id: people[0].id, username: people[0].username })
      navigate(`/app/messages/${created.id}`)
      return `Открываю чат с ${people[0].label}`
    } catch (err) {
      return err instanceof Error ? err.message : 'Не удалось открыть чат'
    }
  }

  const state = useStore.getState()
  const me = state.currentUserId
  const people = state.users
    .filter((user) => user.id !== me)
    .map((user) => ({ id: user.id, label: user.name || user.username, username: user.username }))
  const ranked = rankNames(query, people)
  if (!ranked.length) return 'Такого человека нет'
  if (ambiguous(ranked) && ranked[1]) return `${ranked[0].label} или ${ranked[1].label}?`
  const id = state.ensureConversation(ranked[0].id)
  if (!id) return 'Не удалось открыть чат'
  navigate(`/app/messages/${id}`)
  return `Открываю чат с ${ranked[0].label}`
}
