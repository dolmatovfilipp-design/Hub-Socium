/** Local parental-control scaffold (PIN + enable). */

const KEY = 'hub_parental_v1'

export type ParentalPrefs = {
  enabled: boolean
  pin: string
  ageGateNote: boolean
}

const DEFAULTS: ParentalPrefs = {
  enabled: false,
  pin: '',
  ageGateNote: true,
}

export function loadParentalPrefs(): ParentalPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<ParentalPrefs>
    return {
      enabled: !!parsed.enabled,
      pin: typeof parsed.pin === 'string' ? parsed.pin : '',
      ageGateNote: parsed.ageGateNote !== false,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveParentalPrefs(next: ParentalPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(next))
}
