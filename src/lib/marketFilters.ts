import type { MarketItem } from '../types'

export type SellerFilter = 'all' | 'private' | 'company'
export type SortFilter = 'default' | 'new' | 'cheap' | 'expensive'

export interface MarketFilterState {
  categories: string[]
  city: string
  cityQuery: string
  priceFrom: string
  priceTo: string
  onlyWithPrice: boolean
  sellerType: SellerFilter
  sort: SortFilter
}

export const DEFAULT_MARKET_FILTERS: MarketFilterState = {
  categories: [],
  city: 'Москва',
  cityQuery: '',
  priceFrom: '',
  priceTo: '',
  onlyWithPrice: false,
  sellerType: 'all',
  sort: 'default',
}

export const MARKET_FILTER_CATEGORIES = [
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

export const MARKET_CITY_CHIPS = [
  'Москва',
  'СПб',
  'Казань',
  'Новосибирск',
  'Екатеринбург',
  'Вся Россия',
] as const

export function applyMarketFilters(
  items: MarketItem[],
  q: string,
  filters: MarketFilterState,
  orbitCategory: string | null,
): MarketItem[] {
  const query = q.trim().toLowerCase()
  const from = filters.priceFrom.trim()
    ? Number(filters.priceFrom.replace(/\s/g, ''))
    : null
  const to = filters.priceTo.trim()
    ? Number(filters.priceTo.replace(/\s/g, ''))
    : null
  const cityActive =
    filters.city && filters.city !== 'Вся Россия' ? filters.city : null
  const cityQ = filters.cityQuery.trim().toLowerCase()

  let list = items.filter((item) => {
    if (orbitCategory && item.category !== orbitCategory) return false
    if (filters.categories.length && !filters.categories.includes(item.category)) {
      return false
    }
    if (cityActive && item.city && item.city !== cityActive) return false
    if (cityQ) {
      const hay = `${item.city ?? ''}`.toLowerCase()
      if (!hay.includes(cityQ)) return false
    }
    if (filters.onlyWithPrice && !(item.price > 0)) return false
    if (from != null && !Number.isNaN(from) && item.price < from) return false
    if (to != null && !Number.isNaN(to) && item.price > to) return false
    if (
      filters.sellerType !== 'all' &&
      item.sellerType &&
      item.sellerType !== filters.sellerType
    ) {
      return false
    }
    if (query) {
      const blob =
        `${item.title} ${item.category} ${item.description} ${item.city ?? ''}`.toLowerCase()
      if (!blob.includes(query)) return false
    }
    return true
  })

  if (filters.sort === 'new') {
    list = [...list].sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0
      return tb - ta
    })
  } else if (filters.sort === 'cheap') {
    list = [...list].sort((a, b) => a.price - b.price)
  } else if (filters.sort === 'expensive') {
    list = [...list].sort((a, b) => b.price - a.price)
  }

  return list
}

export function lotWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'лот'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'лота'
  return 'лотов'
}
