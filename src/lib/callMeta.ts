/** Shared call-card labels for 1:1 history (msg_type=call). */
export type CallMeta = {
  call_id?: string
  video?: boolean
  outcome?: string
  duration_sec?: number
  initiator_id?: string
}

export type CallDirection = 'missed' | 'incoming' | 'outgoing'

export function formatCallDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function callDirection(meta: CallMeta, myId: string): CallDirection {
  const mine = !!meta.initiator_id && meta.initiator_id === myId
  switch (meta.outcome) {
    case 'completed':
      return mine ? 'outgoing' : 'incoming'
    case 'cancelled':
      return mine ? 'outgoing' : 'missed'
    case 'declined':
      return mine ? 'outgoing' : 'incoming'
    default:
      return mine ? 'outgoing' : 'missed'
  }
}

export function callCardTitle(meta: CallMeta, myId: string): string {
  const dir = callDirection(meta, myId)
  const video = !!meta.video
  if (dir === 'missed') return video ? 'Пропущенный видеозвонок' : 'Пропущенный звонок'
  if (dir === 'incoming') return video ? 'Входящий видеозвонок' : 'Входящий звонок'
  return video ? 'Исходящий видеозвонок' : 'Исходящий звонок'
}

export function callCardSubtitle(meta: CallMeta, myId: string): string | null {
  if (meta.outcome === 'completed' && (meta.duration_sec ?? 0) > 0) {
    return formatCallDuration(meta.duration_sec ?? 0)
  }
  const mine = !!meta.initiator_id && meta.initiator_id === myId
  if (meta.outcome === 'cancelled' && mine) return 'Отменён'
  if (meta.outcome === 'declined') return mine ? 'Отклонён' : 'Вы отклонили'
  if ((meta.outcome === 'missed' || meta.outcome === 'cancelled') && mine) return 'Нет ответа'
  return null
}

export function callIsVideo(meta: CallMeta | undefined, fallbackBody?: string): boolean {
  if (meta && typeof meta.video === 'boolean') return meta.video
  const body = fallbackBody || ''
  return body.startsWith('Видео') || body.toLowerCase().includes('видео')
}
