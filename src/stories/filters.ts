export const STORY_FILTERS = [
  { id: '', label: 'Нет', css: 'none' },
  { id: 'warm', label: 'Тёплый', css: 'sepia(0.35) saturate(1.25)' },
  { id: 'cool', label: 'Холодный', css: 'saturate(0.85) hue-rotate(18deg)' },
  { id: 'mono', label: 'Ч/б', css: 'grayscale(1)' },
  { id: 'fade', label: 'Выцветший', css: 'contrast(0.92) saturate(0.75) brightness(1.05)' },
] as const

export type StoryFilterId = (typeof STORY_FILTERS)[number]['id']

export function filterCss(id?: string): string {
  return STORY_FILTERS.find((item) => item.id === (id || ''))?.css ?? 'none'
}

export function stepFilter(id: string, dir: -1 | 1): StoryFilterId {
  const index = Math.max(0, STORY_FILTERS.findIndex((item) => item.id === (id || '')))
  const next = (index + dir + STORY_FILTERS.length) % STORY_FILTERS.length
  return STORY_FILTERS[next].id
}

export const TEXT_STYLES = [
  { id: 'classic', label: 'Классика' },
  { id: 'plate', label: 'Плашка' },
  { id: 'outline', label: 'Контур' },
] as const

export type StoryTextStyle = (typeof TEXT_STYLES)[number]['id']

export function textStyleClass(id?: string): string {
  if (id === 'plate') return 'rounded-2xl bg-white px-3 py-1 text-black'
  if (id === 'outline') return 'text-white [-webkit-text-stroke:1.25px_rgba(0,0,0,0.9)]'
  return 'text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.72)]'
}
