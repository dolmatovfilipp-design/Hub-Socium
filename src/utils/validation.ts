export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

export function isValidEmailOrPhone(value: string): boolean {
  return isValidEmail(value) || isValidPhone(value)
}

export function isValidPassword(value: string): boolean {
  return value.length >= 4
}

export function isValidUsername(value: string): boolean {
  return /^[a-zA-Zа-яА-ЯёЁ0-9._]{2,24}$/.test(value.trim())
}

/** Threads-style relative time: «23 ч.», «2 дн.», «17 нед.» */
export function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'сейчас'
  if (mins < 60) return `${mins} мин.`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч.`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн.`
  const weeks = Math.floor(days / 7)
  if (weeks < 52) return `${weeks} нед.`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** «в сети» or «был(а) в сети …». gender: male | female | unknown. */
export function formatPresence(iso?: string | null, gender?: string | null, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const delta = Math.max(0, now - t)
  if (delta < 90_000) return 'в сети'
  const verb = gender === 'female' ? 'была' : gender === 'male' ? 'был' : 'был(а)'
  const mins = Math.max(1, Math.floor(delta / 60_000))
  let ago: string
  if (mins < 60) ago = `${mins} мин. назад`
  else if (mins < 24 * 60) ago = `${Math.floor(mins / 60)} ч. назад`
  else if (mins < 7 * 24 * 60) ago = `${Math.floor(mins / (24 * 60))} дн. назад`
  else ago = new Date(iso).toLocaleDateString('ru-RU')
  return `${verb} в сети ${ago}`
}

export function canViewAgeRating(
  rating: string | undefined,
  viewer: { id?: string | null; showAdult?: boolean; parentalEnabled?: boolean } | undefined,
  authorId: string,
): boolean {
  const r = rating || 'all'
  if (r === 'all') return true
  if (viewer?.id && viewer.id === authorId) return true
  if (viewer?.parentalEnabled) return false
  if (r === '12') return true
  if (r === '18') return viewer?.showAdult === true
  return true
}

export function formatCount(n: number): string {
  if (!n) return ''
  if (n < 1000) return String(n)
  const k = n / 1000
  const rounded = k >= 10 ? Math.round(k).toString() : k.toFixed(1).replace('.', ',')
  return `${rounded} тыс.`
}

export function formatPrice(n: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(n)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function avatarColor(id: string): string {
  const colors = ['#3a3a42', '#2e3440', '#3d3535', '#353a3d', '#3a3540', '#2f3a38']
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

/** Followers label: «432», «116 тыс.», «1,8 млн» */
export function formatFollowers(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    const s = k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace('.', ',')
    return `${s} тыс.`
  }
  const m = n / 1_000_000
  const s = m >= 10 ? String(Math.round(m)) : m.toFixed(1).replace('.', ',')
  return `${s} млн`
}
