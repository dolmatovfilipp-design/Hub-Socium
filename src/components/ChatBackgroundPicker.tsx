import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import {
  loadWallpaperManifest,
  rememberCustomImage,
  setConversationBackground,
  setGlobalBackground,
  useChatBackground,
} from '../appearance'
import {
  BLUR_MAX,
  DIM_MAX,
  noneBackground,
  type ChatBackground,
  type ChatBackgroundPickerProps,
  type WallpaperEntry,
} from '../appearance/types'
import { apiUploadMedia, isApiMode } from '../lib/api'

type Palette = 'all' | 'Холодные' | 'Тёплые'
type Scope = 'all' | 'chat'
type CatalogItem = WallpaperEntry & { group: Palette; thumb: string }

const PALETTES: { id: Palette; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'Холодные', label: 'Холодные' },
  { id: 'Тёплые', label: 'Тёплые' },
]

const SOFT_BLUR = 6
const SOFT_DIM = 20

function softnessOf(background: ChatBackground): number {
  if (background.kind === 'none') return 0
  const blur = (background.blur / BLUR_MAX) * 100
  const dim = (background.dim / DIM_MAX) * 100
  return Math.round((blur + dim) / 2)
}

function levelsFromSoftness(value: number): { blur: number; dim: number } {
  const t = Math.min(100, Math.max(0, value)) / 100
  return { blur: Math.round(t * BLUR_MAX), dim: Math.round(t * DIM_MAX) }
}

function keptLevels(background: ChatBackground): { blur: number; dim: number } {
  if (background.kind === 'none') return { blur: SOFT_BLUR, dim: SOFT_DIM }
  return { blur: background.blur, dim: background.dim }
}

function thumbSrc(file: string, id: string): string {
  const name = file.trim() || `thumbs/${id}.webp`
  if (name.startsWith('/')) return name
  return `/wallpapers/${name.replace(/^\/+/, '')}`
}

async function loadCatalog(): Promise<CatalogItem[]> {
  const [entries, res] = await Promise.all([
    loadWallpaperManifest(),
    fetch('/wallpapers/manifest.json', { cache: 'no-cache' }),
  ])
  const meta = new Map<string, { group?: string; thumb?: string }>()
  if (res.ok) {
    const body = (await res.json()) as { wallpapers?: { id?: string; group?: string; thumb?: string }[] }
    for (const row of body.wallpapers ?? []) {
      if (row.id) meta.set(row.id, row)
    }
  }
  return entries.map((entry) => {
    const row = meta.get(entry.id)
    const group: Palette = row?.group === 'Тёплые' ? 'Тёплые' : 'Холодные'
    return { ...entry, group, thumb: thumbSrc(row?.thumb || '', entry.id) }
  })
}

async function compressWallpaperFile(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
    const width = Math.max(1, Math.round(bmp.width * scale))
    const height = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(bmp, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) throw new Error('encode')
    return blob
  } finally {
    bmp.close()
  }
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="wall-check-icon" aria-hidden>
      <path
        d="M3.2 8.3 6.4 11.4 12.8 4.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChatBackgroundPicker({ conversationId, onClose }: ChatBackgroundPickerProps) {
  const globalWall = useChatBackground()
  const chatWall = useChatBackground(conversationId)
  const [scope, setScope] = useState<Scope>(conversationId ? 'chat' : 'all')
  const [palette, setPalette] = useState<Palette>('all')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [customPreview, setCustomPreview] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const customUrlRef = useRef('')
  const activeScope: Scope = conversationId ? scope : 'all'
  const wall = activeScope === 'chat' ? chatWall : globalWall
  const background = wall.background
  const backgroundKey = `${background.kind}|${background.id ?? ''}|${background.url ?? ''}|${background.blur}|${background.dim}`
  const [softness, setSoftness] = useState(() => softnessOf(background))
  const [softKey, setSoftKey] = useState(backgroundKey)
  if (softKey !== backgroundKey) {
    const painted = levelsFromSoftness(softness)
    const same = background.kind !== 'none' && painted.blur === background.blur && painted.dim === background.dim
    setSoftKey(backgroundKey)
    if (!same) setSoftness(softnessOf(background))
  }

  function rememberCustom() {
    if (background.kind === 'custom' && background.url) customUrlRef.current = background.url
  }

  useEffect(() => {
    let dead = false
    void loadCatalog()
      .then((items) => {
        if (!dead) setCatalog(items)
      })
      .catch(() => {
        if (!dead) setNote('Каталог фонов не загрузился')
      })
    return () => {
      dead = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (customPreview.startsWith('blob:')) URL.revokeObjectURL(customPreview)
    }
  }, [customPreview])

  function commit(next: ChatBackground) {
    if (conversationId && activeScope === 'chat') {
      void setConversationBackground(conversationId, next)
      return
    }
    setGlobalBackground(next)
    if (conversationId) void setConversationBackground(conversationId, null)
  }

  function selectWallpaper(item: CatalogItem) {
    setNote('')
    rememberCustom()
    const levels = keptLevels(background)
    commit({ kind: 'wallpaper', id: item.id, url: item.src, ...levels })
  }

  function selectNone() {
    setNote('')
    rememberCustom()
    commit(noneBackground())
  }

  function selectRememberedCustom() {
    const url = customUrlRef.current
    if (!url) {
      fileRef.current?.click()
      return
    }
    setNote('')
    commit({ kind: 'custom', url, ...keptLevels(background) })
  }

  async function onFile(file: File) {
    setBusy(true)
    setNote('')
    try {
      const blob = await compressWallpaperFile(file)
      const preview = URL.createObjectURL(blob)
      setCustomPreview((prev) => {
        if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return preview
      })
      const owner = conversationId && activeScope === 'chat' ? conversationId : undefined
      await rememberCustomImage(owner, blob)
      if (!isApiMode()) {
        setNote('Своё фото сохраняется на сервере. Сейчас можно выбрать фон из каталога.')
        return
      }
      const uploaded = await apiUploadMedia(new File([blob], 'wallpaper.jpg', { type: 'image/jpeg' }))
      if (!uploaded.url.startsWith('/v1/media/')) {
        setNote('Сервер вернул ссылку, которую фон чата не принимает.')
        return
      }
      customUrlRef.current = uploaded.url
      commit({ kind: 'custom', url: uploaded.url, ...keptLevels(background) })
    } catch {
      setNote('Не удалось загрузить фото. Войдите и попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  const visible = palette === 'all' ? catalog : catalog.filter((item) => item.group === palette)
  const customSelected = background.kind === 'custom'
  const noneSelected = background.kind === 'none'
  const customThumb = customSelected ? wall.image || customPreview : customPreview

  return (
    <section
      className={onClose ? 'wall-picker wall-picker-sheet' : 'appearance-block wall-picker'}
      data-testid="chat-wallpaper-picker"
      aria-label="Фон чата"
    >
      {onClose ? null : <h2 id="chat-wallpaper-title">Фон чата</h2>}
      {conversationId ? (
        <div className="appearance-theme wall-scope" role="radiogroup" aria-label="Куда применить фон">
          <button
            type="button"
            role="radio"
            aria-checked={activeScope === 'chat'}
            onClick={() => setScope('chat')}
          >
            Этот чат
          </button>
          <button type="button" role="radio" aria-checked={activeScope === 'all'} onClick={() => setScope('all')}>
            Все чаты
          </button>
        </div>
      ) : (
        <p className="wall-note">Для всех чатов</p>
      )}

      <div className="wall-chips" role="tablist" aria-label="Палитра">
        {PALETTES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={palette === item.id}
            onClick={() => setPalette(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="wall-grid">
        <button
          type="button"
          className="wall-tile wall-tile-plain"
          aria-pressed={customSelected}
          aria-busy={busy}
          onClick={() => {
            if (customSelected || !customUrlRef.current) fileRef.current?.click()
            else selectRememberedCustom()
          }}
        >
          {customThumb ? <img src={customThumb} alt="" /> : <ImagePlus size={22} strokeWidth={1.6} aria-hidden />}
          <span className="wall-tile-name">{busy ? 'Загрузка' : 'Своё фото'}</span>
          {customSelected ? (
            <span className="wall-check">
              <CheckMark />
            </span>
          ) : null}
        </button>
        <button type="button" className="wall-tile wall-tile-plain" aria-pressed={noneSelected} onClick={selectNone}>
          <span className="wall-tile-name">Без фона</span>
          {noneSelected ? (
            <span className="wall-check">
              <CheckMark />
            </span>
          ) : null}
        </button>
        {visible.map((item) => {
          const pressed = background.kind === 'wallpaper' && background.id === item.id
          return (
            <button key={item.id} type="button" className="wall-tile" aria-pressed={pressed} onClick={() => selectWallpaper(item)}>
              <img src={item.thumb} alt="" loading="lazy" decoding="async" />
              <span className="wall-tile-name">{item.name}</span>
              {pressed ? (
                <span className="wall-check">
                  <CheckMark />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <input
        ref={fileRef}
        className="wall-file"
        type="file"
        accept="image/*"
        aria-label="Загрузить своё фото"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void onFile(file)
        }}
      />

      <label className="wall-slider" htmlFor="wallpaper-softness">
        <span>Размытие и затемнение</span>
        <span>{background.kind === 'none' ? 'Выключено' : softness}</span>
      </label>
      <input
        id="wallpaper-softness"
        className="appearance-range wall-range"
        type="range"
        min={0}
        max={100}
        step={1}
        disabled={background.kind === 'none'}
        value={softness}
        aria-valuetext={background.kind === 'none' ? 'Без фона' : String(softness)}
        onChange={(event) => {
          const value = Number(event.target.value)
          setSoftness(value)
          if (background.kind === 'none') return
          commit({ ...background, ...levelsFromSoftness(value) })
        }}
      />

      {conversationId && activeScope === 'chat' ? (
        <button
          type="button"
          className="wall-inherit"
          onClick={() => {
            setNote('')
            void setConversationBackground(conversationId, null)
          }}
        >
          Как во всех чатах
        </button>
      ) : null}
      {note ? (
        <p className="wall-note" role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}
