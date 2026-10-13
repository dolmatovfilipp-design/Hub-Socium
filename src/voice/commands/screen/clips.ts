import { apiCreateClip, apiLikeClip, apiListClips, apiUploadMedia } from '../../../lib/api.ts'
import { requireConfirm } from './confirm.ts'
import { VOICE_CLIP_CAPTION, emitVoice, refreshVoiceScreen } from './events.ts'
import { setVoiceContinuation } from './pending.ts'
import {
  RESULT_CANCELLED,
  SAY_API_ONLY,
  SAY_EMPTY,
  SAY_NOT_HERE,
  errorSay,
  type VoiceCommandContext,
  type VoiceCommandDefinition,
  type VoiceCommandResult,
} from './types.ts'

const MAX_BYTES = 40 * 1024 * 1024

let clipIndex = 0
let muteNoted = false
let captionDraft = ''
let armed = false
let pendingFile: File | null = null

function clipNodes(): HTMLElement[] {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll<HTMLElement>('.clips-snap-item')]
}

function visibleIndex(nodes: HTMLElement[]): number {
  const root = typeof document === 'undefined' ? null : document.querySelector('.clips-snap')
  if (!root || !nodes.length) return clipIndex
  const top = root.getBoundingClientRect().top
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  nodes.forEach((node, index) => {
    const distance = Math.abs(node.getBoundingClientRect().top - top)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
}

function withMute(line: string): string {
  if (muteNoted) return line
  muteNoted = true
  return `${line}. Ролики без звука`
}

function move(direction: 1 | -1): VoiceCommandResult {
  const nodes = clipNodes()
  if (!nodes.length) return { say: SAY_EMPTY }
  const current = visibleIndex(nodes)
  const next = current + direction
  if (next < 0) return { say: 'Это первый ролик' }
  if (next >= nodes.length) return { say: 'Дальше роликов нет' }
  clipIndex = next
  nodes[next]?.scrollIntoView({ block: 'start', inline: 'nearest' })
  return { say: withMute(direction > 0 ? 'Следующий ролик' : 'Предыдущий ролик') }
}

function currentNode(): HTMLElement | null {
  const nodes = clipNodes()
  if (!nodes.length) return null
  const index = Math.min(visibleIndex(nodes), nodes.length - 1)
  clipIndex = index
  return nodes[index] ?? null
}

function videoOf(node: HTMLElement | null): HTMLVideoElement | null {
  const video = node?.querySelector('video')
  return video instanceof HTMLVideoElement ? video : null
}

async function like(): Promise<VoiceCommandResult> {
  const node = currentNode()
  if (!node) return { say: SAY_EMPTY }
  const button = node.querySelector('button')
  const liked = button?.textContent?.includes('♥') ?? false
  if (liked) return { say: 'Лайк уже стоит' }
  const id = node.dataset.clipId
  if (!id) return { say: SAY_EMPTY }
  try {
    await apiLikeClip(id)
    refreshVoiceScreen('clips')
    return { say: 'Лайк' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

function readCaption(): VoiceCommandResult {
  const node = currentNode()
  if (!node) return { say: SAY_EMPTY }
  const lines = [...node.querySelectorAll('p')].map((paragraph) => paragraph.textContent?.trim() || '').filter(Boolean)
  const username = lines[0] || '@user'
  const caption = lines[1] || 'Без подписи'
  return { say: `${username}. ${caption}` }
}

function isMp4OrQuickTime(file: File): boolean {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return type === 'video/mp4' || type === 'video/quicktime' || name.endsWith('.mp4') || name.endsWith('.mov')
}

function openUploadPanel(): void {
  if (typeof document === 'undefined') return
  const button = [...document.querySelectorAll('button')].find((candidate) => {
    const label = candidate.textContent?.trim()
    return label === 'Загрузить' || label === 'Загрузить первое'
  })
  button?.click()
}

/** Returns true when voice upload is waiting, so the manual button does not publish immediately. */
export function offerVoiceClipFile(file: File): boolean {
  if (!armed) return false
  pendingFile = file
  armed = false
  setVoiceContinuation((ctx) => finishClipUpload(ctx))
  return true
}

export function cancelClipUpload(): boolean {
  const had = armed || pendingFile !== null || captionDraft !== ''
  armed = false
  pendingFile = null
  captionDraft = ''
  return had
}

async function finishClipUpload(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  const file = pendingFile
  if (!file) return { say: 'Сначала выберите MP4' }
  if (!isMp4OrQuickTime(file)) return { say: 'Нужен файл MP4' }
  if (file.size > MAX_BYTES) return { say: 'Максимум 40 МБ' }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  const accepted = await requireConfirm(ctx, `Опубликовать ролик ${file.name}?`, 'yes')
  if (!accepted) return RESULT_CANCELLED
  try {
    const media = await apiUploadMedia(file)
    await apiCreateClip(media.url, captionDraft.trim(), 0)
    pendingFile = null
    captionDraft = ''
    armed = false
    refreshVoiceScreen('clips')
    ctx.toast('Видео опубликовано')
    return { say: 'Видео опубликовано' }
  } catch (error) {
    return { say: errorSay(error) }
  }
}

async function upload(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (ctx.pathname !== '/app/clips') return { say: SAY_NOT_HERE }
  if (!ctx.isApiMode()) return { say: SAY_API_ONLY }
  if (pendingFile) return finishClipUpload(ctx)
  const caption = await ctx.dictate('Диктуйте подпись')
  if (caption === null) return RESULT_CANCELLED
  captionDraft = caption.trim()
  emitVoice(VOICE_CLIP_CAPTION, captionDraft)
  openUploadPanel()
  armed = true
  return { say: 'Сначала выберите MP4' }
}

export const clipsCommands: readonly VoiceCommandDefinition[] = [
  {
    id: 'G-10',
    title: 'Видео',
    group: 'Общие',
    phrases: ['видео', 'клипы'],
    synonyms: ['открой видео'],
    screens: ['*'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Видео',
    starter: true,
    handler: async (ctx) => {
      if (!ctx.isApiMode()) return { say: 'Видео. Здесь пусто', navigateTo: '/app/clips' }
      try {
        const response = await apiListClips()
        if (!(response.items ?? []).length) return { say: 'Видео. Здесь пусто', navigateTo: '/app/clips' }
      } catch (error) {
        return { say: errorSay(error), navigateTo: '/app/clips' }
      }
      return { say: 'Видео', navigateTo: '/app/clips' }
    },
  },
  {
    id: 'V-01',
    title: 'Следующий ролик',
    group: 'Видео',
    phrases: ['следующий ролик'],
    synonyms: ['дальше видео'],
    screens: ['clips'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Следующий ролик',
    starter: true,
    handler: () => Promise.resolve(move(1)),
  },
  {
    id: 'V-02',
    title: 'Предыдущий ролик',
    group: 'Видео',
    phrases: ['предыдущий ролик'],
    synonyms: [],
    screens: ['clips'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Предыдущий ролик',
    starter: true,
    handler: () => Promise.resolve(move(-1)),
  },
  {
    id: 'V-03',
    title: 'Лайк ролика',
    group: 'Видео',
    phrases: ['лайк'],
    synonyms: [],
    screens: ['clips'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Лайк',
    starter: true,
    handler: () => like(),
  },
  {
    id: 'V-04',
    title: 'Пауза ролика',
    group: 'Видео',
    phrases: ['пауза'],
    synonyms: ['останови видео'],
    screens: ['clips'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Пауза',
    starter: true,
    handler: () => {
      const video = videoOf(currentNode())
      if (!video) return Promise.resolve({ say: SAY_EMPTY })
      video.pause()
      return Promise.resolve({ say: 'Пауза' })
    },
  },
  {
    id: 'V-05',
    title: 'Смотреть',
    group: 'Видео',
    phrases: ['смотри'],
    synonyms: ['играй'],
    screens: ['clips'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Смотрю',
    starter: true,
    handler: () => {
      const video = videoOf(currentNode())
      if (!video) return Promise.resolve({ say: SAY_EMPTY })
      void video.play().catch(() => {})
      return Promise.resolve({ say: withMute('Смотрю') })
    },
  },
  {
    id: 'V-06',
    title: 'Прочитай подпись',
    group: 'Видео',
    phrases: ['прочитай подпись'],
    synonyms: [],
    screens: ['clips'],
    confirmation: 'none',
    confirmPrompt: '',
    reply: 'Читает логин и подпись',
    starter: true,
    handler: () => Promise.resolve(readCaption()),
  },
  {
    id: 'V-07',
    title: 'Загрузить ролик',
    group: 'Видео',
    phrases: ['загрузи ролик'],
    synonyms: [],
    screens: ['clips'],
    // Catalog column and section 12 accept «да» or «отправить».
    confirmation: 'yes',
    confirmInHandler: true,
    confirmPrompt: 'Опубликовать ролик?',
    reply: 'Сначала выберите MP4',
    starter: false,
    handler: (ctx) => upload(ctx),
  },
]
