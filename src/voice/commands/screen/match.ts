import { isFileShelfOpen } from './files.ts'
import { normalizePhrase, parseSpokenNumber, routeMatches } from './phrase.ts'
import type { VoiceCommandDefinition, VoiceMatchResult } from './types.ts'

function triggers(command: VoiceCommandDefinition): string[] {
  return [...command.phrases, ...command.synonyms].map((phrase) => normalizePhrase(phrase)).filter(Boolean)
}

function matchSet(utterance: string, commands: readonly VoiceCommandDefinition[]): VoiceMatchResult {
  const hits: { command: VoiceCommandDefinition; phrase: string; slot: string; length: number }[] = []
  for (const command of commands) {
    for (const phrase of triggers(command)) {
      if (utterance === phrase) {
        hits.push({ command, phrase, slot: '', length: phrase.length })
      } else if (command.slot && utterance.startsWith(`${phrase} `)) {
        const slot = utterance.slice(phrase.length).trim()
        if (slot) hits.push({ command, phrase, slot, length: phrase.length })
      }
    }
  }
  if (!hits.length) return { status: 'none' }
  const best = Math.max(...hits.map((hit) => hit.length))
  const top = hits.filter((hit) => hit.length === best)
  const ids = new Set(top.map((hit) => hit.command.id))
  if (ids.size > 1) return { status: 'ambiguous', say: 'Уточните команду' }
  const hit = top[0]
  if (!hit) return { status: 'none' }
  const number = parseSpokenNumber(hit.slot) ?? (hit.slot ? undefined : parseSpokenNumber(hit.phrase))
  return {
    status: 'ok',
    command: hit.command,
    match: {
      utterance,
      phrase: hit.phrase,
      slot: hit.slot,
      number,
    },
  }
}

/**
 * Match one normalized utterance against a command list.
 * Shelf-priority commands are tried first while the shelf is open.
 * There is no wake word.
 */
export function matchVoiceCommand(
  commands: readonly VoiceCommandDefinition[],
  utterance: string,
  pathname: string,
): VoiceMatchResult {
  const normalized = normalizePhrase(utterance)
  if (!normalized) return { status: 'none' }
  const onScreen = commands.filter((command) => routeMatches(pathname, command.screens))
  if (isFileShelfOpen()) {
    const shelfHit = matchSet(
      normalized,
      onScreen.filter((command) => command.priority === 'shelf'),
    )
    if (shelfHit.status !== 'none') return shelfHit
  }
  return matchSet(
    normalized,
    onScreen.filter((command) => !(command.priority === 'shelf' && command.shelfOnly)),
  )
}
