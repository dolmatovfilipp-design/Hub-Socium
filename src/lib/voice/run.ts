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
    case 'next-post':
      return movePost(1)
    case 'prev-post':
      return movePost(-1)
    case 'like':
      return likeFocused()
    case 'read-post':
      return readFocusedPost()
    case 'read-last':
      return readMessage(false)
    case 'read-incoming':
      return readMessage(true)
    case 'open-chat':
      return openChat(intent.query, navigate)
    default:
      return ''
  }
}

function feedPosts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-voice-post]'))
}

function focusedPostId(): string | null {
  const nodes = feedPosts()
  if (!nodes.length) return null
  const mid = window.innerHeight / 2
  let best: HTMLElement | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue
    const dist = Math.abs(rect.top + rect.height / 2 - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  return (best ?? nodes[0]).getAttribute('data-voice-post')
}

function movePost(dir: 1 | -1): string {
  const tab = document.querySelector('[data-voice-tab]')?.getAttribute('data-voice-tab')
  if (tab === 'market') return 'Сейчас маркет. Скажите: лента'
  const nodes = feedPosts()
  if (!nodes.length) return 'Здесь нет ленты'
  const current = focusedPostId()
  const index = Math.max(0, nodes.findIndex((node) => node.getAttribute('data-voice-post') === current))
  const next = nodes[index + dir]
  if (!next) return dir > 0 ? 'Дальше постов нет' : 'Это начало ленты'
  next.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return dir > 0 ? 'Следующий пост' : 'Предыдущий пост'
}

function likeFocused(): string {
  const id = focusedPostId()
  if (!id) return 'Сейчас не на что поставить лайк'
  const state = useStore.getState()
  const post = state.posts.find((item) => item.id === id)
  if (!post) return 'Пост не найден'
  if (state.currentUserId && post.likes.includes(state.currentUserId)) return 'Уже отмечено'
  void state.toggleLike(id)
  return 'Лайк поставлен'
}

function readFocusedPost(): string {
  const id = focusedPostId()
  if (!id) return 'Нет поста в фокусе'
  const post = useStore.getState().posts.find((item) => item.id === id)
  if (!post) return 'Пост не найден'
  const author = useStore.getState().users.find((user) => user.id === post.authorId)
  const who = author?.name || author?.username || 'Автор'
  const text = post.text.trim() || 'В посте нет текста'
  return `${who}. ${text}`
}

function readMessage(incomingOnly: boolean): string {
  if (!location.pathname.startsWith('/app/messages/')) return 'Эта команда здесь не действует'
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
