/**
 * Runnable checks for the Phase 4 registries. Executed with vite-node;
 * not imported by the app.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileShelfHost } from '../../FileShelfHost.tsx'
import { matchPhase4, phase4Commands } from './index.ts'
import { dismissFileShelf, getFileShelfSnapshot, ingestPickedFiles } from './files.ts'
import { chooseByName, parseRuDateTime } from './phrase.ts'
import { RESULT_CANCELLED, type VoiceCommandContext, type VoiceCommandDefinition } from './types.ts'

const failures: string[] = []

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function fakeContext(patch: Partial<VoiceCommandContext> = {}): VoiceCommandContext {
  return {
    pathname: '/app',
    say() {},
    navigate() {},
    toast() {},
    confirm: async () => false,
    dictate: async () => null,
    confirmationGranted: null,
    isApiMode: () => false,
    currentUserId: () => 'u1',
    localActivities: () => [],
    removeLocalActivity() {},
    ...patch,
  }
}

function triggers(command: VoiceCommandDefinition): string[] {
  return [...command.phrases, ...command.synonyms]
}

const wake = /^(хаб|hey hub|окей хаб|ok hub)\b/

for (const command of phase4Commands) {
  check(command.phrases.length > 0, `${command.id} has no phrases`)
  check(typeof command.handler === 'function', `${command.id} has no handler`)
  check(command.confirmation === 'none' || command.confirmation === 'yes' || command.confirmation === 'dangerous', `${command.id} confirmation`)
  for (const phrase of triggers(command)) {
    const normalized = phrase.toLowerCase().replace(/ё/g, 'е')
    check(!wake.test(normalized), `${command.id} uses a wake word: ${phrase}`)
  }
  if (command.confirmation !== 'none' && !command.confirmInHandler) {
    check(command.confirmPrompt.length > 0, `${command.id} missing confirm prompt`)
  }
}

const ids = phase4Commands.map((command) => command.id)
check(new Set(ids).size === ids.length, 'duplicate command ids')

const dangerous = ['CN-03', 'CN-06', 'CN-08', 'CN-09', 'A-12']
for (const id of dangerous) {
  const command = phase4Commands.find((item) => item.id === id)
  check(command?.confirmation === 'dangerous', `${id} must require «да, подтверждаю»`)
}

const send = phase4Commands.find((command) => command.id === 'FS-SEND')
check(send?.confirmation === 'yes' && send.confirmInHandler === true, 'file send must confirm inside the handler')
if (!send) throw new Error('FS-SEND missing')

const clipUpload = phase4Commands.find((command) => command.id === 'V-07')
check(clipUpload?.confirmation === 'yes', 'clip upload requires confirmation')

const actionsOpen = matchPhase4('уведомления', '/app/clips')
check(actionsOpen.status === 'ok' && actionsOpen.command.id === 'G-07', 'уведомления maps to Действия')
if (actionsOpen.status === 'ok') {
  const result = await actionsOpen.command.handler(fakeContext(), actionsOpen.match)
  check(result.say === 'Действия' && result.navigateTo === '/app/activity', 'G-07 opens /app/activity')
}

const shouted = matchPhase4('Уведомления!', '/app')
check(shouted.status === 'ok' && shouted.command.id === 'G-07', 'normalization strips punctuation and case')

const videoOnChat = matchPhase4('видео', '/app/messages/c1')
check(videoOnChat.status === 'ok' && videoOnChat.command.id === 'G-10', 'bare «видео» stays the clips navigation')

const videoShelf = matchPhase4('видео в чат', '/app/messages/c1')
check(videoShelf.status === 'ok' && videoShelf.command.id === 'C-19', '«видео в чат» opens the video shelf')

const communities = matchPhase4('каналы', '/app/settings')
check(communities.status === 'ok' && communities.command.id === 'G-19', 'каналы opens communities')

const meetups = matchPhase4('встречи', '/app')
check(meetups.status === 'none', 'встречи is not a command')
const openMeetup = matchPhase4('открой встречу', '/app')
check(openMeetup.status === 'none', 'открой встречу is not a command')

const likeOnFeed = matchPhase4('лайк', '/app')
check(likeOnFeed.status === 'none', 'clip like does not fire on the feed')

const likeOnClips = matchPhase4('лайк', '/app/clips')
check(likeOnClips.status === 'ok' && likeOnClips.command.id === 'V-03', 'лайк on clips is V-03')

const newsOnActivity = matchPhase4('что нового', '/app/activity')
check(newsOnActivity.status === 'ok' && newsOnActivity.command.id === 'A-01', 'что нового on actions is A-01')

check(parseRuDateTime('завтра') === null, 'unparsed dates are not replaced with tomorrow')
check(parseRuDateTime('12 октября 2026') === null, 'a date without a time is refused')
const parsed = parseRuDateTime('12 октября 2026 в 18:00')
check(
  parsed !== null && parsed.getFullYear() === 2026 && parsed.getMonth() === 9 && parsed.getDate() === 12 && parsed.getHours() === 18,
  'russian date with time parses',
)
const numeric = parseRuDateTime('12.10.2026 18:30')
check(numeric !== null && numeric.getMinutes() === 30, 'numeric date parses')

const asked = chooseByName(
  'андрей',
  [
    { title: 'Андрей Малыкцев' },
    { title: 'Андрей М' },
  ],
  (item) => [item.title],
  'Уточните имя',
)
check(asked.kind === 'ask', 'close names are asked, not guessed')

dismissFileShelf()
const photo = phase4Commands.find((command) => command.id === 'C-18')
if (!photo) failures.push('missing C-18')
else {
  const opened = await photo.handler(
    fakeContext({ pathname: '/app/messages/c1', isApiMode: () => true }),
    { utterance: 'фото', phrase: 'фото', slot: '' },
  )
  check(opened.say === 'Выберите фото', 'photo shelf asks to pick files')
  const html = renderToStaticMarkup(createElement(FileShelfHost, { conversationId: 'c1' }))
  check(html.includes('Выбрать файлы'), 'shelf shows the pick button and does not open the system dialog itself')
  const files = Array.from({ length: 21 }, (_, index) => new File(['x'], `pic-${index}.png`, { type: 'image/png' }))
  const ingested = ingestPickedFiles(files)
  check(ingested.truncated && getFileShelfSnapshot().items.length === 20, 'shelf keeps the first twenty files')
  const prompts: string[] = []
  const sendResult = await send.handler(
    fakeContext({
      pathname: '/app/messages/c1',
      isApiMode: () => true,
      confirm: async (prompt, kind) => {
        prompts.push(`${kind}:${prompt}`)
        return false
      },
    }),
    { utterance: 'отправить', phrase: 'отправить', slot: '' },
  )
  check(!sendResult.cancelled && prompts.length === 0, 'several files are not sent until one is chosen')
  const chosen = matchPhase4('первое', '/app/messages/c1')
  check(chosen.status === 'ok' && chosen.command.id === 'C-22', 'первое is the shelf selector while the shelf is open')
  if (chosen.status === 'ok') {
    const selected = await chosen.command.handler(
      fakeContext({ pathname: '/app/messages/c1', isApiMode: () => true }),
      chosen.match,
    )
    check(selected.say.includes('pic-0.png'), 'первое selects the first picked file')
  }
  const refused = await send.handler(
    fakeContext({
      pathname: '/app/messages/c1',
      isApiMode: () => true,
      confirm: async (prompt, kind) => {
        prompts.push(`${kind}:${prompt}`)
        return false
      },
    }),
    { utterance: 'отправить', phrase: 'отправить', slot: '' },
  )
  check(refused === RESULT_CANCELLED, 'refused file send does not upload')
  check(prompts.some((prompt) => prompt.includes('pic-0.png') && prompt.startsWith('yes:')), 'file send question names the file')
}

if (newsOnActivity.status === 'ok') {
  const read = await newsOnActivity.command.handler(
    fakeContext({
      pathname: '/app/activity',
      localActivities: () => [
        {
          id: 'a1',
          type: 'like',
          actorId: 'u2',
          actorName: 'Анна',
          createdAt: '2026-10-12T10:00:00.000Z',
          read: false,
        },
      ],
    }),
    newsOnActivity.match,
  )
  check(read.say.includes('Анна') && read.say.includes('Читаю новое'), 'actions reads the card')
}

let removed = ''
const deleteHit = matchPhase4('удали событие', '/app/activity')
check(deleteHit.status === 'ok' && deleteHit.command.id === 'A-12', 'delete event is A-12')
if (deleteHit.status === 'ok') {
  const refusedDelete = await deleteHit.command.handler(
    fakeContext({
      pathname: '/app/activity',
      confirm: async (_prompt, kind) => kind === 'dangerous' && false,
      removeLocalActivity: (id) => {
        removed = id
      },
    }),
    deleteHit.match,
  )
  check(refusedDelete.cancelled === true && removed === '', 'dangerous delete waits for confirmation')
}

dismissFileShelf()

if (failures.length) {
  throw new Error(failures.join('\n'))
}
console.log(`phase4 commands ok: ${phase4Commands.length}`)
