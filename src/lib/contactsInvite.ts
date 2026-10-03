/** Device contacts + referral invite helpers (Messages search). */

export const REFERRAL_INVITE_TEXT =
  'Привет, я пользуюсь приложением Hub, присоединяйся ко мне'

export type DeviceContact = { name: string; tel: string }

type ContactsManager = {
  select: (
    props: string[],
    opts?: { multiple?: boolean },
  ) => Promise<Array<{ name?: string[]; tel?: string[] }>>
}

export function contactsPickerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window
}

/** Contact Picker API (Chrome Android). Returns [] if unsupported / cancelled. */
export async function pickDeviceContacts(): Promise<DeviceContact[]> {
  if (!contactsPickerSupported()) return []
  try {
    const contacts = (navigator as Navigator & { contacts: ContactsManager }).contacts
    const raw = await contacts.select(['name', 'tel'], { multiple: true })
    const out: DeviceContact[] = []
    for (const c of raw) {
      const name = (c.name && c.name[0]) || 'Контакт'
      for (const tel of c.tel || []) {
        const t = String(tel).trim()
        if (t) out.push({ name, tel: t })
      }
    }
    return out
  } catch {
    return []
  }
}

export function buildInviteShareText(inviteUrl: string, message = REFERRAL_INVITE_TEXT): string {
  return `${message}\n${inviteUrl}`
}

/** sms: URI — works on phones; desktop may no-op. */
export function smsInviteHref(phone: string, body: string): string {
  const tel = phone.replace(/[^\d+]/g, '')
  const encoded = encodeURIComponent(body)
  // iOS prefers &body= with ;, Android ?body=. Empty tel opens SMS composer.
  if (!tel) return `sms:?body=${encoded}`
  return `sms:${tel}?body=${encoded}`
}

export async function shareInvite(text: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: 'Hub', text, url })
      return 'shared'
    } catch {
      /* cancel or fail → copy */
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** Clipboard with textarea fallback. Returns false if both fail. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
