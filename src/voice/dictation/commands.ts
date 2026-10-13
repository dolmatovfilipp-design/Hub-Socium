/**
 * Phase 2 commands only. No wake word: the whole phrase must match a short name.
 * Phase 1 owns navigation («лента», «сообщения», …) and must not be swallowed here.
 */

export type VoicePresetName = 'reading' | 'chat' | 'publish'
export type ConfirmKind = 'none' | 'yes' | 'danger'

export type Phase2CatalogItem = {
  id: string
  title: string
  group: 'Чат' | 'Лента' | 'Публикация'
  /** Spoken forms, before normalization. */
  phrases: string[]
  confirm: ConfirmKind
  /**
   * Presets that turn the command on when there is no per-id override.
   * «reading» = starter set «Чтение и навигация» (on whenever voice is on).
   * «chat» = also «Переписка». «publish» = also «Публикации».
   * C-12 is in no preset.
   */
  presets: VoicePresetName[]
}

export const PHASE2_CATALOG: Phase2CatalogItem[] = [
  {
    id: 'C-06',
    title: 'Ответь',
    group: 'Чат',
    phrases: ['ответь', 'ответ'],
    confirm: 'yes',
    presets: ['chat', 'publish'],
  },
  {
    id: 'C-07',
    title: 'Запиши голосовое',
    group: 'Чат',
    phrases: ['запиши голосовое', 'голосовое'],
    confirm: 'none',
    presets: ['chat', 'publish'],
  },
  {
    id: 'C-08',
    title: 'Отправить',
    group: 'Чат',
    phrases: ['отправить', 'отправь'],
    confirm: 'yes',
    presets: ['chat', 'publish'],
  },
  {
    id: 'C-09',
    title: 'Перезаписать',
    group: 'Чат',
    phrases: ['перезаписать', 'заново'],
    confirm: 'none',
    presets: ['chat', 'publish'],
  },
  {
    id: 'C-10',
    title: 'Отменить запись',
    group: 'Чат',
    phrases: ['отмени запись'],
    confirm: 'none',
    presets: ['reading', 'chat', 'publish'],
  },
  {
    id: 'C-11',
    title: 'Редактировать последнее',
    group: 'Чат',
    phrases: ['редактировать последнее', 'исправь последнее'],
    confirm: 'yes',
    presets: ['chat', 'publish'],
  },
  {
    id: 'C-12',
    title: 'Удалить последнее',
    group: 'Чат',
    phrases: ['удали последнее', 'удалить последнее'],
    confirm: 'danger',
    presets: [],
  },
  {
    id: 'C-37',
    title: 'Ответь на это',
    group: 'Чат',
    phrases: ['ответь на это', 'ответь на сообщение'],
    confirm: 'none',
    presets: ['chat', 'publish'],
  },
  {
    id: 'F-05',
    title: 'Комментарий',
    group: 'Лента',
    phrases: ['комментарий', 'ответь на пост'],
    confirm: 'yes',
    presets: ['chat', 'publish'],
  },
  {
    id: 'CP-07',
    title: 'Голосовой ответ',
    group: 'Публикация',
    phrases: ['голосовой ответ', 'запиши ответ'],
    confirm: 'none',
    presets: ['chat', 'publish'],
  },
]

/** Lower case, ё→е, punctuation stripped, single spaces. */
export function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type CatalogMatch = { id: string; phrase: string }

/** Exact match of the whole phrase. The longest synonym wins. */
export function matchCatalog(input: string): CatalogMatch | null {
  const norm = normalizePhrase(input)
  if (!norm) return null
  let best: CatalogMatch | null = null
  for (const item of PHASE2_CATALOG) {
    for (const phrase of item.phrases) {
      const candidate = normalizePhrase(phrase)
      if (candidate !== norm) continue
      if (!best || candidate.length > best.phrase.length) {
        best = { id: item.id, phrase: candidate }
      }
    }
  }
  return best
}

const STOP = new Set(['стоп', 'хватит', 'замолчи'])
const CANCEL = new Set(['отмена', 'не надо', 'отмени'])
const SEND = new Set(['отправить', 'отправь'])
const YES = new Set(['да'])
const NO = new Set(['нет', 'отмена', 'не надо', 'отмени'])
const RERECORD = new Set(['перезаписать', 'заново'])
const DONE = new Set(['готово'])
const ERASE = new Set(['стереть последнее'])
const READ = new Set(['прочитай текст'])
export const DANGER_PHRASE = 'да подтверждаю'
export const CANCEL_RECORDING_PHRASE = 'отмени запись'

export function isStopPhrase(norm: string): boolean {
  return STOP.has(norm)
}
export function isCancelPhrase(norm: string): boolean {
  return CANCEL.has(norm)
}
export function isSendPhrase(norm: string): boolean {
  return SEND.has(norm)
}
export function isYesPhrase(norm: string): boolean {
  return YES.has(norm)
}
export function isNoPhrase(norm: string): boolean {
  return NO.has(norm)
}
export function isRerecordPhrase(norm: string): boolean {
  return RERECORD.has(norm)
}
export function isDonePhrase(norm: string): boolean {
  return DONE.has(norm)
}
export function isErasePhrase(norm: string): boolean {
  return ERASE.has(norm)
}
export function isReadPhrase(norm: string): boolean {
  return READ.has(norm)
}
export function isDangerPhrase(norm: string): boolean {
  return norm === DANGER_PHRASE
}
