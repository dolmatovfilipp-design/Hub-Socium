export type VoiceIntent =
  | { type: 'nav'; to: string; say: string; feedTab?: 'feed' | 'market' }
  | { type: 'back' }
  | { type: 'stop' }
  | { type: 'help' }
  | { type: 'where' }
  | { type: 'read-last' }
  | { type: 'read-incoming' }
  | { type: 'open-chat'; query: string }
  | { type: 'voice-off' }
  | { type: 'unknown' }

const EXACT: Record<string, VoiceIntent> = {
  лента: { type: 'nav', to: '/app', say: 'Лента', feedTab: 'feed' },
  домой: { type: 'nav', to: '/app', say: 'Лента', feedTab: 'feed' },
  'на главную': { type: 'nav', to: '/app', say: 'Лента', feedTab: 'feed' },
  главная: { type: 'nav', to: '/app', say: 'Лента', feedTab: 'feed' },
  маркет: { type: 'nav', to: '/app', say: 'Бизнес', feedTab: 'market' },
  бизнес: { type: 'nav', to: '/app', say: 'Бизнес', feedTab: 'market' },
  сообщения: { type: 'nav', to: '/app/messages', say: 'Сообщения' },
  чаты: { type: 'nav', to: '/app/messages', say: 'Сообщения' },
  'открой сообщения': { type: 'nav', to: '/app/messages', say: 'Сообщения' },
  профиль: { type: 'nav', to: '/app/profile', say: 'Профиль' },
  'мой профиль': { type: 'nav', to: '/app/profile', say: 'Профиль' },
  настройки: { type: 'nav', to: '/app/settings', say: 'Настройки' },
  'открой настройки': { type: 'nav', to: '/app/settings', say: 'Настройки' },
  поиск: { type: 'nav', to: '/app/explore', say: 'Поиск' },
  'открой поиск': { type: 'nav', to: '/app/explore', say: 'Поиск' },
  назад: { type: 'back' },
  вернись: { type: 'back' },
  стоп: { type: 'stop' },
  хватит: { type: 'stop' },
  замолчи: { type: 'stop' },
  помощь: { type: 'help' },
  'что можно сказать': { type: 'help' },
  команды: { type: 'help' },
  'где я': { type: 'where' },
  'какой экран': { type: 'where' },
  'прочитай последнее': { type: 'read-last' },
  'прочитай новые': { type: 'read-incoming' },
  'выключи голос': { type: 'voice-off' },
  'выключи голосовое управление': { type: 'voice-off' },
}

export function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?…:;"'«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchUtterance(raw: string): VoiceIntent {
  const phrase = normalizePhrase(raw)
  if (!phrase) return { type: 'unknown' }
  const exact = EXACT[phrase]
  if (exact) return exact
  const open = 'открой чат с '
  if (phrase.startsWith(open)) {
    const query = phrase.slice(open.length).trim()
    if (query) return { type: 'open-chat', query }
  }
  if (phrase.startsWith('чат с ')) {
    const query = phrase.slice('чат с '.length).trim()
    if (query) return { type: 'open-chat', query }
  }
  return { type: 'unknown' }
}

export function screenTitle(path: string): string {
  if (path === '/app' || path === '/app/') return 'Лента'
  if (path.startsWith('/app/messages/')) return 'Чат'
  if (path.startsWith('/app/messages')) return 'Сообщения'
  if (path.startsWith('/app/activity')) return 'Действия'
  if (path.startsWith('/app/profile')) return 'Профиль'
  if (path.startsWith('/app/settings')) return 'Настройки'
  if (path.startsWith('/app/explore')) return 'Поиск'
  if (path.startsWith('/app/p/')) return 'Пост'
  if (path.startsWith('/app/channels')) return 'Сообщества'
  if (path.startsWith('/app/compose')) return 'Публикация'
  return 'Get Hub'
}

export function helpLine(path: string): string {
  const base = 'Можно сказать: лента, сообщения, уведомления, профиль, настройки, назад, стоп, где я.'
  if (path === '/app' || path === '/app/') return `${base} На ленте: дальше, лайк, прочитай пост.`
  if (path.startsWith('/app/messages/')) return `${base} В чате: прочитай последнее, прочитай новые.`
  if (path.startsWith('/app/messages')) return `${base} Откройте чат фразой: открой чат с именем.`
  return base
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const d = levenshtein(a, b)
  return 1 - d / Math.max(a.length, b.length)
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const row = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) row[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = tmp
    }
  }
  return row[n]
}

export type NameHit = { id: string; label: string; username?: string; score: number }

export function rankNames(query: string, rows: { id: string; label: string; username?: string }[]): NameHit[] {
  const q = normalizePhrase(query).replace(/^@/, '')
  const words = q.split(' ').filter(Boolean)
  return rows
    .map((row) => {
      const label = normalizePhrase(row.label)
      const username = normalizePhrase(row.username ?? '').replace(/^@/, '')
      let score = Math.max(similarity(q, label), similarity(q, username))
      if (label === q || username === q) score = 1
      else if (words.length && words.every((w) => label.includes(w) || username.includes(w))) score = Math.max(score, 0.92)
      return { id: row.id, label: row.label, username: row.username, score }
    })
    .filter((row) => row.score >= 0.72)
    .sort((a, b) => b.score - a.score)
}

export function ambiguous(hits: NameHit[]): boolean {
  return hits.length >= 2 && hits[0].score - hits[1].score < 0.08
}
