import type { VoiceScreen } from './types.ts'

/** Command match form: lower case, ё→е, punctuation gone, single spaces. No wake word. */
export function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/@/g, '')
    .replace(/[.,!?;:«»"'`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keeps digits, dots and colons so a dictated date can be parsed. */
export function normalizeLoose(input: string): string {
  return input.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

export function routeMatches(pathname: string, screens: readonly VoiceScreen[]): boolean {
  if (screens.includes('*')) return pathname === '/app' || pathname.startsWith('/app/')
  return screens.some((screen) => screenMatches(pathname, screen))
}

function screenMatches(pathname: string, screen: VoiceScreen): boolean {
  switch (screen) {
    case '*':
      return pathname === '/app' || pathname.startsWith('/app/')
    case 'channels':
      return pathname === '/app/channels'
    case 'channel':
      return /^\/app\/channels\/[^/]+$/.test(pathname)
    case 'clips':
      return pathname === '/app/clips'
    case 'activity':
      return pathname === '/app/activity'
    case 'chat':
      return /^\/app\/messages\/(?!new$|new-group$|requests$|hidden-words$)[^/]+$/.test(pathname)
    default:
      return false
  }
}

export function channelIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/app\/channels\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function chatIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/app\/messages\/([^/]+)$/)
  if (!match?.[1]) return null
  const id = decodeURIComponent(match[1])
  if (id === 'new' || id === 'new-group' || id === 'requests' || id === 'hidden-words') return null
  return id
}

const ORDINALS: Record<string, number> = {
  первое: 1,
  первый: 1,
  первая: 1,
  второе: 2,
  второй: 2,
  вторая: 2,
  третье: 3,
  третий: 3,
  третья: 3,
  четвертое: 4,
  четвертый: 4,
  пятое: 5,
  пятый: 5,
  шестое: 6,
  шестой: 6,
  седьмое: 7,
  седьмой: 7,
  восьмое: 8,
  восьмой: 8,
  девятое: 9,
  девятый: 9,
  десятое: 10,
  десятый: 10,
  одиннадцатое: 11,
  двенадцатое: 12,
  тринадцатое: 13,
  четырнадцатое: 14,
  пятнадцатое: 15,
  шестнадцатое: 16,
  семнадцатое: 17,
  восемнадцатое: 18,
  девятнадцатое: 19,
  двадцатое: 20,
}

const CARDINALS: Record<string, number> = {
  один: 1,
  одна: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
}

/** 1-based spoken index. «последнее» is not a number; callers handle it. */
export function parseSpokenNumber(input: string): number | undefined {
  const text = normalizePhrase(input)
  if (!text) return undefined
  if (/^\d+$/.test(text)) {
    const value = Number(text)
    return value >= 1 ? value : undefined
  }
  if (ORDINALS[text]) return ORDINALS[text]
  if (CARDINALS[text]) return CARDINALS[text]
  const numbered = text.match(/^номер\s+(.+)$/)
  if (numbered?.[1]) return parseSpokenNumber(numbered[1])
  return undefined
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0] ?? 0
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, prev + cost)
      prev = current
    }
  }
  return row[b.length] ?? 0
}

function ratio(a: string, b: string): number {
  if (!a && !b) return 1
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  return 1 - levenshtein(a, b) / max
}

/** Spec §11.2 score: 1 exact, 0.92 all words, otherwise Levenshtein. */
export function scoreName(query: string, candidate: string): number {
  const left = normalizePhrase(query)
  const right = normalizePhrase(candidate)
  if (!left || !right) return 0
  if (left === right) return 1
  const leftWords = left.split(' ')
  const rightWords = right.split(' ')
  if (leftWords.every((word) => rightWords.includes(word))) return 0.92
  let best = ratio(left, right)
  for (const word of rightWords) best = Math.max(best, ratio(left, word))
  for (const word of leftWords) best = Math.max(best, ratio(word, right))
  return best
}

export type NamePick<T> = { kind: 'one'; item: T } | { kind: 'none' } | { kind: 'ask'; say: string }

const NAME_THRESHOLD = 0.72
const NAME_GAP = 0.08

/**
 * Pick one labeled item. Two close candidates are asked back, never guessed.
 * More than two close candidates yield `askMany`.
 */
export function chooseByName<T>(
  query: string,
  items: readonly T[],
  labelsOf: (item: T) => readonly string[],
  askMany: string,
): NamePick<T> {
  const scored = items
    .map((item) => {
      const labels = labelsOf(item).map((label) => scoreName(query, label))
      const score = labels.reduce((max, value) => Math.max(max, value), 0)
      const title = labelsOf(item).find((label) => label.trim()) || 'без имени'
      return { item, score, title }
    })
    .filter((row) => row.score >= NAME_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best) return { kind: 'none' }
  const second = scored[1]
  if (second && best.score - second.score < NAME_GAP) {
    const third = scored[2]
    if (third && best.score - third.score < NAME_GAP) return { kind: 'ask', say: askMany }
    return { kind: 'ask', say: `${best.title} или ${second.title}?` }
  }
  return { kind: 'one', item: best.item }
}

const MONTHS: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
}

/**
 * Parse a dictated date. Returns null when the day, month, year or time is
 * missing or impossible. Does not substitute «завтра».
 */
export function parseRuDateTime(input: string): Date | null {
  const text = normalizeLoose(input).replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  const numeric = text.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(?:в\s+)?(\d{1,2})[:.](\d{2}))?$/,
  )
  if (numeric?.[1] && numeric[2] && numeric[3]) {
    if (!numeric[4] || !numeric[5]) return null
    return validDate(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]), Number(numeric[4]), Number(numeric[5]))
  }
  const named = text.match(
    /^(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?(?:\s+(?:в\s+)?(\d{1,2})[:.](\d{2}))?$/,
  )
  if (named?.[1] && named[2]) {
    const month = MONTHS[named[2]]
    if (month === undefined || !named[3] || !named[4] || !named[5]) return null
    return validDate(Number(named[3]), month, Number(named[1]), Number(named[4]), Number(named[5]))
  }
  if (/^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}/.test(text)) {
    const parsed = new Date(input)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function validDate(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  if (hour > 23 || minute > 59 || month < 0 || month > 11) return null
  const date = new Date(year, month, day, hour, minute, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date
}

export function hasCyrillic(input: string): boolean {
  return /[а-яё]/i.test(input)
}

export function isLatinSlug(input: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.trim().toLowerCase())
}
