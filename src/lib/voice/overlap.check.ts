import './overlap.env.ts'
import { matchVoiceCommand, phase4VoiceCommands, screenFromRoute } from '../../voice/commands/index.ts'
import { matchPhase4 } from '../../voice/commands/screen/index.ts'
import { chooseVoiceTarget } from './route.ts'
import { loadVoicePrefs, saveVoicePrefs, VOICE_PREFS_KEY } from './prefs.ts'
import { matchUtterance } from './match.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const prior = localStorage.getItem(VOICE_PREFS_KEY)
localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ gestures: { enabled: true, fps: 15 }, voiceEnabled: false }))
saveVoicePrefs({ ...loadVoicePrefs(), voiceEnabled: true, preset: 'reading', commands: {} })
const bag = JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || '{}') as { gestures?: { enabled?: boolean } }
assert(bag.gestures?.enabled === true, 'voice save keeps the gestures key')

assert(matchUtterance('уведомления').type === 'unknown', 'phase 1 does not own уведомления')
assert(matchUtterance('лайк').type === 'unknown', 'лайк is not global')
assert(matchUtterance('видео').type === 'unknown', 'видео is not global')

const activity = chooseVoiceTarget('что нового', '/app/activity')
assert(activity.kind === 'screen' && activity.id === 'A-01', `activity whats-new -> ${JSON.stringify(activity)}`)

const clips = chooseVoiceTarget('лайк', '/app/clips')
assert(clips.kind === 'screen' && clips.id === 'V-03', `clips like -> ${JSON.stringify(clips)}`)

const feedLike = chooseVoiceTarget('лайк', '/app')
assert(feedLike.kind === 'feed' && feedLike.id === 'F-03', `feed like -> ${JSON.stringify(feedLike)}`)

const feedNews = chooseVoiceTarget('что нового', '/app')
assert(feedNews.kind === 'feed' && feedNews.id === 'F-19', `feed news -> ${JSON.stringify(feedNews)}`)

const notes = matchPhase4('уведомления', '/app')
assert(notes.status === 'ok' && notes.command.id === 'G-07', 'уведомления is G-07')

const profile = screenFromRoute('/app/profile')
const onProfile = matchVoiceCommand(phase4VoiceCommands, 'подпишись', profile)
assert(onProfile.kind === 'matched' && onProfile.command.id !== 'F-16', `profile subscribe -> ${onProfile.kind}`)

const onFeed = matchVoiceCommand(phase4VoiceCommands, 'подпишись', 'feed')
assert(onFeed.kind === 'matched' && onFeed.command.id === 'F-16', 'feed subscribe is F-16')

if (prior === null) localStorage.removeItem(VOICE_PREFS_KEY)
else localStorage.setItem(VOICE_PREFS_KEY, prior)

console.log('voice overlap ok')
