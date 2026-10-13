import { RU_CITIES } from '../../data/ru-cities.ts'
import { formatPrice } from '../../utils/validation.ts'
import type { MarketListing, VoiceCommandContext, VoiceCommandDefinition, VoiceCommandResult } from './types.ts'
import {
  apiOnly,
  askSlot,
  emptyHere,
  fail,
  gate,
  isResume,
  normalizeUtterance,
  said,
  wrongScreen,
} from './runtime.ts'

const CATEGORIES = [
  'Все',
  'Транспорт',
  'Недвижимость',
  'Работа',
  'Услуги',
  'Личные вещи',
  'Для дома',
  'Запчасти',
  'Электроника',
  'Хобби',
  'Животные',
  'Бизнес',
  'Путешествия',
  'Подработка',
] as const

const CITY_ALIASES: Record<string, string> = {
  москва: 'Москва',
  мск: 'Москва',
  спб: 'СПб',
  питер: 'СПб',
  'санкт петербург': 'СПб',
  казань: 'Казань',
  новосибирск: 'Новосибирск',
  екатеринбург: 'Екатеринбург',
  'вся россия': 'Вся Россия',
  россия: 'Вся Россия',
}

function onMarket(ctx: VoiceCommandContext): boolean {
  return ctx.screen === 'market'
}

function focusedListing(ctx: VoiceCommandContext): MarketListing | VoiceCommandResult {
  if (!ctx.market.focused || ctx.market.count === 0) return emptyHere()
  return ctx.market.focused
}

function isListing(value: MarketListing | VoiceCommandResult): value is MarketListing {
  return 'price' in value && 'title' in value
}

export function resolveMarketCategory(slot: string): string | null {
  const normalized = normalizeUtterance(slot)
  if (!normalized) return null
  const found = CATEGORIES.find((category) => normalizeUtterance(category) === normalized)
  return found ?? null
}

export function resolveMarketCity(
  slot: string,
): { city: string } | { choices: string[] } | null {
  const normalized = normalizeUtterance(slot)
  if (!normalized) return null
  const alias = CITY_ALIASES[normalized]
  if (alias) return { city: alias }
  const exact = RU_CITIES.find((city) => normalizeUtterance(city) === normalized)
  if (exact) return { city: exact === 'Санкт-Петербург' ? 'СПб' : exact }
  const prefixes = RU_CITIES.filter((city) => normalizeUtterance(city).startsWith(normalized))
  if (prefixes.length === 1) {
    const city = prefixes[0] === 'Санкт-Петербург' ? 'СПб' : prefixes[0]
    return { city }
  }
  if (prefixes.length > 1) return { choices: prefixes.slice(0, 2) }
  return null
}

function hasWord(text: string, word: string): boolean {
  return ` ${text} `.includes(` ${word} `)
}

function findCityInText(text: string): { city: string; fragment: string } | null {
  const normalized = normalizeUtterance(text)
  const aliasKey = Object.keys(CITY_ALIASES).sort((a, b) => b.length - a.length)
  for (const key of aliasKey) {
    if (hasWord(normalized, key)) return { city: CITY_ALIASES[key], fragment: key }
  }
  const cities = [...RU_CITIES].sort((a, b) => b.length - a.length)
  for (const city of cities) {
    const name = normalizeUtterance(city)
    if (name.length < 3) continue
    if (hasWord(normalized, name)) {
      return { city: city === 'Санкт-Петербург' ? 'СПб' : city, fragment: name }
    }
  }
  return null
}

export function parseMarketAd(text: string): { title: string; price: number; city: string } | { missing: string } {
  const found = findCityInText(text)
  const city = found?.city ?? null
  const withoutCity = found
    ? normalizeUtterance(text).replace(found.fragment, ' ')
    : normalizeUtterance(text)
  const priceMatch = withoutCity.match(/(\d[\d\s]{0,14})/)
  const price = priceMatch ? Number(priceMatch[1].replace(/\s/g, '')) : NaN
  const title = withoutCity
    .replace(/(\d[\d\s]{0,14})/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) return { missing: 'Назовите название' }
  if (!Number.isFinite(price)) return { missing: 'Назовите цену' }
  if (!city) return { missing: 'Назовите город' }
  return { title, price, city }
}

function describeListing(item: MarketListing): string {
  const city = item.city ? item.city : 'город не указан'
  return `${item.title}. ${formatPrice(item.price)}. ${item.category}. ${city}`
}

async function searchAds(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  const query = ctx.slot.trim()
  if (!query) return askSlot('Что искать?', 'query')
  ctx.market.setQuery(query)
  return said('Ищу')
}

async function category(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  const name = resolveMarketCategory(ctx.slot)
  if (!name) {
    if (ctx.slot.trim()) return { ok: false, spoken: 'Такой категории нет', code: 'empty' }
    return askSlot('Назовите категорию', 'category')
  }
  ctx.market.setCategory(name)
  return said(`Категория ${name}`)
}

async function city(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  if (!ctx.slot.trim()) return askSlot('Назовите город', 'city')
  const resolved = resolveMarketCity(ctx.slot)
  if (!resolved) return { ok: false, spoken: 'Такого города нет', code: 'empty' }
  if ('choices' in resolved) {
    return askSlot(`Уточните: «${resolved.choices[0]}» или «${resolved.choices[1]}»`, 'city')
  }
  ctx.market.setCity(resolved.city)
  return said(`Город ${resolved.city}`)
}

async function price(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  const phrase = normalizeUtterance(ctx.matchedPhrase)
  const bound = phrase.includes('до') ? 'to' : 'from'
  const digits = ctx.slot.replace(/\s/g, '')
  if (!/^\d+$/.test(digits)) return askSlot('Назовите цену', bound)
  if (bound === 'to') ctx.market.setPriceTo(digits)
  else ctx.market.setPriceFrom(digits)
  return said('Цена')
}

async function sort(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  const blob = normalizeUtterance(`${ctx.matchedPhrase} ${ctx.slot}`)
  let next: 'default' | 'new' | 'cheap' | 'expensive' | null = null
  if (blob.includes('дешев')) next = 'cheap'
  else if (blob.includes('дорог')) next = 'expensive'
  else if (blob.includes('нов')) next = 'new'
  else if (blob.includes('умолчан')) next = 'default'
  if (!next) return askSlot('Сначала дешёвые, дорогие или новые?', 'sort')
  ctx.market.setSort(next)
  return said('Сортировка')
}

async function seller(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  const blob = normalizeUtterance(`${ctx.matchedPhrase} ${ctx.slot}`)
  if (blob.includes('частн')) ctx.market.setSellerType('private')
  else if (blob.includes('компан')) ctx.market.setSellerType('company')
  else ctx.market.setSellerType('all')
  return said('Фильтр продавца')
}

async function moveListing(ctx: VoiceCommandContext, delta: number): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  if (ctx.market.count === 0) return emptyHere()
  const next = ctx.market.moveFocus(delta)
  if (!next) {
    return {
      ok: false,
      spoken: delta > 0 ? 'Дальше объявлений нет' : 'Это первое объявление',
      code: 'edge',
    }
  }
  return said(delta > 0 ? 'Следующее объявление' : 'Предыдущее объявление')
}

async function readListing(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  const item = focusedListing(ctx)
  if (!isListing(item)) return item
  return said(describeListing(item))
}

async function messageSeller(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onMarket(ctx)) return wrongScreen(ctx)
  const item = focusedListing(ctx)
  if (!isListing(item)) return item
  const blocked = gate(ctx, 'yes', 'Открыть чат с продавцом?', 'seller')
  if (blocked) return blocked
  const result = await ctx.market.messageSeller(item.id)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось открыть чат')
  return said('Открываю чат')
}

async function archiveListing(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onMarket(ctx)) return wrongScreen(ctx)
  const item = focusedListing(ctx)
  if (!isListing(item)) return item
  if (!ctx.apiMode) return apiOnly(ctx, 'Архив — в API-режиме')
  const blocked = gate(ctx, 'yes', 'Убрать объявление в архив?', 'archive')
  if (blocked) return blocked
  const result = await ctx.market.archiveListing(item.id)
  if (!result.ok) return fail(ctx, result.error || 'Не удалось')
  return said('Объявление в архиве')
}

async function demoPay(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onMarket(ctx)) return wrongScreen(ctx)
  const item = focusedListing(ctx)
  if (!isListing(item)) return item
  if (!ctx.apiMode) return apiOnly(ctx, 'Оплата доступна при подключении к серверу')
  const blocked = gate(
    ctx,
    'dangerous',
    `Оплата ${formatPrice(item.price)}. Скажите: да, подтверждаю`,
    'pay',
  )
  if (blocked) return blocked
  const result = await ctx.market.demoPay(item.id)
  if (!result.ok) return fail(ctx, result.error || 'Оплата недоступна')
  if (result.confirmationUrl) {
    ctx.market.openPaymentUrl(result.confirmationUrl)
    return said('Открываю оплату')
  }
  return said(result.message || 'Оплата недоступна: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY')
}

async function publishAd(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onMarket(ctx)) return wrongScreen(ctx)
  if (!ctx.apiMode) return apiOnly(ctx, 'Это доступно при подключении к серверу')
  if (ctx.dictationEvent === 'append') return { ok: true, spoken: '', code: 'dictation' }
  if (ctx.dictationEvent === 'commit' || ctx.dictationEvent === 'send' || ctx.step === 'publish') {
    const parsed = parseMarketAd(ctx.dictationText ?? ctx.slot)
    if ('missing' in parsed) {
      return {
        ok: false,
        spoken: parsed.missing,
        code: 'dictation',
        startDictation: { step: 'ad', prompt: parsed.missing },
      }
    }
    const blocked = gate(
      ctx,
      'yes',
      `Опубликовать объявление «${parsed.title}» за ${formatPrice(parsed.price)} в городе ${parsed.city}?`,
      'publish',
    )
    if (blocked) return blocked
    const result = await ctx.market.createAd(parsed)
    if (!result.ok) return fail(ctx, result.error || 'Ошибка')
    return said('Объявление опубликовано')
  }
  return {
    ok: true,
    spoken: 'Продиктуйте название, цену и город',
    code: 'dictation',
    startDictation: { step: 'ad', prompt: 'Продиктуйте название, цену и город' },
  }
}

async function resetFilters(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  ctx.market.resetFilters()
  return said('Фильтры сброшены')
}

function parseRating(slot: string): number | null {
  const match = normalizeUtterance(slot).match(/[1-5]/)
  if (!match) return null
  return Number(match[0])
}

async function reviewSeller(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !onMarket(ctx)) return wrongScreen(ctx)
  if (!ctx.market.reviewOpen) return { ok: false, spoken: 'Лист отзыва закрыт', code: 'denied' }
  if (!ctx.apiMode) return apiOnly(ctx, 'Это доступно при подключении к серверу')
  if (ctx.dictationEvent === 'append') {
    ctx.market.setReviewBody(ctx.dictationText ?? '')
    return { ok: true, spoken: '', code: 'dictation' }
  }
  if (ctx.dictationEvent === 'commit' || ctx.dictationEvent === 'send' || ctx.step === 'send') {
    const blocked = gate(ctx, 'yes', 'Отправить отзыв?', 'send')
    if (blocked) return blocked
    if (ctx.dictationText) ctx.market.setReviewBody(ctx.dictationText)
    else {
      const rest = ctx.slot.replace(/[1-5]/, '').trim()
      if (rest) ctx.market.setReviewBody(rest)
    }
    const result = await ctx.market.submitReview()
    if (!result.ok) return fail(ctx, result.error || 'Ошибка')
    return said('Спасибо за отзыв')
  }
  const fromSlot = parseRating(ctx.slot)
  if (!fromSlot) return askSlot('Оценка от 1 до 5', 'rating')
  ctx.market.setReviewRating(fromSlot)
  const rest = ctx.slot.replace(/[1-5]/, '').trim()
  if (rest) {
    const blocked = gate(ctx, 'yes', 'Отправить отзыв?', 'send')
    if (blocked) return blocked
    ctx.market.setReviewBody(rest)
    const result = await ctx.market.submitReview()
    if (!result.ok) return fail(ctx, result.error || 'Ошибка')
    return said('Спасибо за отзыв')
  }
  return {
    ok: true,
    spoken: 'Диктуйте отзыв',
    code: 'dictation',
    startDictation: { step: 'body', prompt: 'Диктуйте отзыв' },
  }
}

async function closeReview(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!onMarket(ctx)) return wrongScreen(ctx)
  if (!ctx.market.reviewOpen) return { ok: false, spoken: 'Лист отзыва закрыт', code: 'denied' }
  ctx.market.closeReview()
  return said('Закрыла отзыв')
}

function market(
  partial: Omit<VoiceCommandDefinition, 'group'>,
): VoiceCommandDefinition {
  return { group: 'market', ...partial }
}

/** Market commands M-01 … M-16. */
export const marketCommands: readonly VoiceCommandDefinition[] = [
  market({
    id: 'M-01',
    phrases: ['найди объявление'],
    synonyms: ['найди товар'],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: true,
    reply: 'Ищу',
    handler: searchAds,
  }),
  market({
    id: 'M-02',
    phrases: ['категория'],
    synonyms: [],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: true,
    reply: 'Категория',
    handler: category,
  }),
  market({
    id: 'M-03',
    phrases: ['город'],
    synonyms: [],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: true,
    reply: 'Город',
    handler: city,
  }),
  market({
    id: 'M-04',
    phrases: ['цена от'],
    synonyms: ['цена до'],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: false,
    preset: 'none',
    takesSlot: true,
    reply: 'Цена',
    handler: price,
  }),
  market({
    id: 'M-05',
    phrases: ['сортировка'],
    synonyms: ['сначала дешёвые', 'сначала дорогие', 'сначала новые'],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: true,
    reply: 'Сортировка',
    handler: sort,
  }),
  market({
    id: 'M-06',
    phrases: ['частные'],
    synonyms: ['компании', 'все продавцы'],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Фильтр продавца',
    handler: seller,
  }),
  market({
    id: 'M-07',
    phrases: ['следующее объявление'],
    synonyms: ['дальше объявление'],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Следующее объявление',
    handler: (ctx) => moveListing(ctx, 1),
  }),
  market({
    id: 'M-08',
    phrases: ['предыдущее объявление'],
    synonyms: [],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Предыдущее объявление',
    handler: (ctx) => moveListing(ctx, -1),
  }),
  market({
    id: 'M-09',
    phrases: ['прочитай объявление'],
    synonyms: [],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Читает название, цену, категорию и город',
    handler: readListing,
  }),
  market({
    id: 'M-10',
    phrases: ['написать продавцу'],
    synonyms: ['напиши продавцу'],
    screens: ['market'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Открыть чат с продавцом?',
    handler: messageSeller,
  }),
  market({
    id: 'M-11',
    phrases: ['объявление в архив'],
    synonyms: [],
    screens: ['market'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Убрать объявление в архив?',
    handler: archiveListing,
  }),
  market({
    id: 'M-12',
    phrases: ['оплатить', 'оплати'],
    synonyms: ['демо-оплата'],
    screens: ['market'],
    confirmation: 'dangerous',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Оплата. Сумма N. Скажите: да, подтверждаю',
    handler: demoPay,
  }),
  market({
    id: 'M-13',
    phrases: ['опубликуй объявление'],
    synonyms: [],
    screens: ['market'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'publications',
    takesSlot: false,
    reply: 'Продиктуйте название, цену и город',
    handler: publishAd,
  }),
  market({
    id: 'M-14',
    phrases: ['сбрось фильтры'],
    synonyms: ['сбросить'],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Фильтры сброшены',
    handler: resetFilters,
  }),
  market({
    id: 'M-15',
    phrases: ['отзыв'],
    synonyms: ['оцени продавца'],
    screens: ['market'],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: true,
    reply: 'Оценка от 1 до 5',
    handler: reviewSeller,
  }),
  market({
    id: 'M-16',
    phrases: ['позже'],
    synonyms: ['не сейчас'],
    screens: ['market'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Закрыла отзыв',
    handler: closeReview,
  }),
]
