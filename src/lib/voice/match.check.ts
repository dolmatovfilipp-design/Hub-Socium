import { matchUtterance, normalizePhrase, rankNames, ambiguous, screenTitle } from './match.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const messages = matchUtterance('Сообщения')
assert(messages.type === 'nav' && messages.to === '/app/messages', 'messages')

const notes = matchUtterance('уведомления')
assert(notes.type === 'nav' && notes.to === '/app/activity', 'activity')

const chatter = matchUtterance('давай потом в сообщения')
assert(chatter.type === 'unknown', 'no partial match')

const chat = matchUtterance('открой чат с Андреем Малыкцевым')
assert(chat.type === 'open-chat', 'open chat type')
if (chat.type === 'open-chat') {
  assert(normalizePhrase(chat.query).includes('андре'), chat.query)
}

const hits = rankNames('андрей малыкцев', [
  { id: '1', label: 'Андрей Малыкцев', username: 'malyktsev' },
  { id: '2', label: 'Олег', username: 'oleg' },
])
assert(hits[0]?.id === '1' && !ambiguous(hits), 'name')

const both = rankNames('андрей', [
  { id: '1', label: 'Андрей Малыкцев' },
  { id: '2', label: 'Андрей Петров' },
])
assert(ambiguous(both), 'ambiguous')

assert(screenTitle('/app/messages/abc') === 'Чат', 'screen')
console.log('voice match ok')
