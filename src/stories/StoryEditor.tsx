import { useEffect, useRef, useState } from 'react'
import { apiCreateStory, apiUploadMedia, isApiMode } from '../lib/api'
import { useStore } from '../store/useStore'
import type { StoryCapture } from './StoryCamera'
import { StoryFrame } from './StoryFrame'
import { STORY_FILTERS, TEXT_STYLES, stepFilter, type StoryTextStyle } from './filters'
import { IconClose, IconMusic, IconPencil, IconPin } from '../components/Icons'

function songLabel(name: string) {
  const base = name.replace(/\.[^.]+$/, '').trim()
  return (base || 'Песня').slice(0, 80)
}

export function StoryEditor({
  capture,
  onBack,
  onPublished,
}: {
  capture: StoryCapture
  onBack: () => void
  onPublished: () => void
}) {
  const showToast = useStore((s) => s.showToast)
  const songRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [filterId, setFilterId] = useState('')
  const [filterFlash, setFilterFlash] = useState('')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState('')
  const [textStyle, setTextStyle] = useState<StoryTextStyle>('classic')
  const [draftStyle, setDraftStyle] = useState<StoryTextStyle>('classic')
  const [editingText, setEditingText] = useState(false)
  const [textX, setTextX] = useState(50)
  const [textY, setTextY] = useState(42)
  const [placeName, setPlaceName] = useState('')
  const [placeDraft, setPlaceDraft] = useState('')
  const [editingPlace, setEditingPlace] = useState(false)
  const [placeX, setPlaceX] = useState(50)
  const [placeY, setPlaceY] = useState(72)
  const [songFile, setSongFile] = useState<File | null>(null)
  const [songUrl, setSongUrl] = useState<string | null>(null)
  const [audience, setAudience] = useState<'all' | 'close_friends'>('all')
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    return () => {
      if (songUrl) URL.revokeObjectURL(songUrl)
    }
  }, [songUrl])

  const chooseFilter = (id: string) => {
    setFilterId(id)
    const label = STORY_FILTERS.find((item) => item.id === id)?.label ?? ''
    setFilterFlash(label)
    window.setTimeout(() => setFilterFlash((current) => (current === label ? '' : current)), 700)
  }

  const openText = () => {
    setDraft(text)
    setDraftStyle(textStyle)
    setEditingPlace(false)
    setEditingText(true)
  }

  const commitText = () => {
    const next = draft.trim().slice(0, 300)
    setText(next)
    setTextStyle(draftStyle)
    setEditingText(false)
  }

  const commitPlace = () => {
    setPlaceName(placeDraft.trim().slice(0, 80))
    setEditingPlace(false)
  }

  const onSong = (file: File | undefined) => {
    if (!file) return
    if (file.type && !file.type.startsWith('audio/')) {
      showToast('Нужен аудиофайл')
      return
    }
    if (songUrl) URL.revokeObjectURL(songUrl)
    const url = URL.createObjectURL(file)
    setSongFile(file)
    setSongUrl(url)
    const audio = audioRef.current
    if (audio) {
      audio.src = url
      void audio.play().catch(() => {})
    }
  }

  const publish = async () => {
    if (publishing) return
    if (!isApiMode()) {
      showToast('Истории публикуются при подключении к серверу')
      return
    }
    setPublishing(true)
    try {
      const mediaUrl = (await apiUploadMedia(capture.file)).url
      let uploadedSong = ''
      if (songFile) {
        uploadedSong = (await apiUploadMedia(songFile)).url
      }
      await apiCreateStory(text.trim(), mediaUrl, audience, {
        filter_id: filterId,
        place_name: placeName.trim(),
        media_kind: capture.kind,
        text_style: text.trim() ? textStyle : '',
        text_x: textX,
        text_y: textY,
        place_x: placeX,
        place_y: placeY,
        song_url: uploadedSong,
        song_title: songFile ? songLabel(songFile.name) : '',
        mirrored: capture.mirrored,
      })
      showToast('История опубликована')
      onPublished()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось опубликовать историю')
    } finally {
      setPublishing(false)
    }
  }

  const activeFilter = STORY_FILTERS.find((item) => item.id === filterId)?.label ?? 'Нет'

  return (
    <div data-testid="story-editor" className="fixed inset-0 z-[var(--hub-z-modal)] h-[100dvh] w-full bg-black text-white">
      <StoryFrame
        mediaUrl={capture.url}
        mediaKind={capture.kind}
        filterId={filterId}
        mirrored={capture.mirrored}
        body={editingText ? '' : text}
        textStyle={textStyle}
        textX={textX}
        textY={textY}
        placeName={editingPlace ? '' : placeName}
        placeX={placeX}
        placeY={placeY}
        videoMuted
        draggable
        onTextMove={(x, y) => {
          setTextX(x)
          setTextY(y)
        }}
        onPlaceMove={(x, y) => {
          setPlaceX(x)
          setPlaceY(y)
        }}
        onFilterStep={(dir) => chooseFilter(stepFilter(filterId, dir))}
      />
      {filterFlash ? (
        <p aria-live="polite" className="glass-pill pointer-events-none absolute left-1/2 top-[38%] z-20 -translate-x-1/2 rounded-full px-4 py-1.5 text-[length:var(--hub-text-md)] font-medium leading-snug text-hub-text">
          {filterFlash}
        </p>
      ) : null}
      <div className="safe-top absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4">
        <button type="button" aria-label="Назад" className="pressable inline-flex h-11 w-11 items-center justify-center text-white" onClick={onBack}>
          <IconClose size={22} />
        </button>
        <span className="text-[length:var(--hub-text-sm)] leading-snug tracking-[0.01em] text-white/80">{activeFilter}</span>
        <span className="h-11 w-11" />
      </div>

      {editingText ? (
        <div className="safe-top absolute inset-0 z-30 flex flex-col bg-black/45 px-5">
          <div className="flex justify-end">
            <button type="button" className="pressable inline-flex h-11 items-center text-[length:var(--hub-text-lg)] font-semibold text-white" onClick={commitText}>
              Готово
            </button>
          </div>
          <div className="mt-8 flex justify-center gap-2">
            {TEXT_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                aria-pressed={draftStyle === style.id}
                className={`pressable inline-flex h-11 items-center px-3 text-[length:var(--hub-text-md)] ${draftStyle === style.id ? 'font-semibold text-white' : 'text-white/65'}`}
                onClick={() => setDraftStyle(style.id)}
              >
                {style.label}
              </button>
            ))}
          </div>
          <textarea
            value={draft}
            autoFocus
            aria-label="Текст"
            placeholder="Текст"
            rows={3}
            maxLength={300}
            onChange={(event) => setDraft(event.target.value.slice(0, 300))}
            className={`mt-10 w-full resize-none bg-transparent text-center text-[28px] font-semibold leading-snug tracking-[0.01em] break-words caret-white outline-none placeholder:text-white/75 ${draftStyle === 'plate' ? 'text-black caret-black placeholder:text-black/55 selection:bg-black/15' : 'text-white selection:bg-white/25'}`}
            style={draftStyle === 'plate' ? { background: 'white', borderRadius: 16, padding: '8px 12px' } : undefined}
          />
        </div>
      ) : null}

      {editingPlace ? (
        <div className="absolute inset-x-0 top-[max(64px,var(--hub-safe-top))] z-30 px-4">
          <div className="glass-pill flex items-center gap-2 rounded-2xl px-3 py-2">
            <input
              value={placeDraft}
              autoFocus
              aria-label="Место"
              placeholder="Место"
              maxLength={80}
              onChange={(event) => setPlaceDraft(event.target.value.slice(0, 80))}
              className="h-11 w-full bg-transparent text-[length:var(--hub-text-lg)] leading-snug text-hub-text caret-[color:var(--color-hub-text)] outline-none placeholder:text-hub-silver"
            />
            <button type="button" className="pressable inline-flex h-11 shrink-0 items-center text-[length:var(--hub-text-md)] font-semibold text-hub-text" onClick={commitPlace}>
              Добавить место
            </button>
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(16px,var(--hub-safe-bottom))]">
        <div
          data-testid="story-filters"
          className="glass-pill no-scrollbar mb-4 flex gap-1 overflow-x-auto rounded-full px-2 py-1"
        >
          {STORY_FILTERS.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={filterId === item.id}
              className={`pressable inline-flex h-11 shrink-0 snap-center items-center px-3 text-[length:var(--hub-text-sm)] leading-snug ${filterId === item.id ? 'font-semibold text-hub-text' : 'text-hub-silver'}`}
              onClick={() => chooseFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {songFile ? (
          <button
            type="button"
            data-testid="story-song"
            className="pressable mb-3 flex h-11 items-center gap-2 text-[length:var(--hub-text-sm)] leading-snug text-white"
            onClick={() => {
              if (songUrl) URL.revokeObjectURL(songUrl)
              setSongFile(null)
              setSongUrl(null)
            }}
          >
            <IconMusic size={18} />
            <span className="truncate">{songLabel(songFile.name)}</span>
            <span className="text-white/65">Убрать</span>
          </button>
        ) : null}
        <div className="mb-5 flex items-end justify-around text-white">
          <button type="button" aria-label="Текст" className="pressable flex min-h-11 min-w-11 flex-col items-center gap-1 px-3" onClick={openText}>
            <IconPencil size={22} />
            <span className="text-[length:var(--hub-text-xs)] leading-snug tracking-[0.01em] text-white/75">Текст</span>
          </button>
          <button
            type="button"
            aria-label="Место"
            className="pressable flex min-h-11 min-w-11 flex-col items-center gap-1 px-3"
            onClick={() => {
              setPlaceDraft(placeName)
              setEditingText(false)
              setEditingPlace(true)
            }}
          >
            <IconPin size={22} />
            <span className="text-[length:var(--hub-text-xs)] leading-snug tracking-[0.01em] text-white/75">Место</span>
          </button>
          <button type="button" aria-label="Песня" className="pressable flex min-h-11 min-w-11 flex-col items-center gap-1 px-3" onClick={() => songRef.current?.click()}>
            <IconMusic size={22} />
            <span className="text-[length:var(--hub-text-xs)] leading-snug tracking-[0.01em] text-white/75">Песня</span>
          </button>
        </div>
        <button
          type="button"
          aria-pressed={audience === 'close_friends'}
          className="pressable mb-2 inline-flex h-11 items-center text-[length:var(--hub-text-sm)] leading-snug text-white/80"
          onClick={() => setAudience((value) => (value === 'all' ? 'close_friends' : 'all'))}
        >
          {audience === 'all' ? 'Всем' : 'Близким'}
        </button>
        <button
          type="button"
          disabled={publishing}
          onClick={() => void publish()}
          className="btn-liquid-glass"
        >
          {publishing ? 'Публикация…' : 'Опубликовать'}
        </button>
      </div>
      <input
        ref={songRef}
        data-testid="story-song-input"
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          onSong(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <audio ref={audioRef} className="hidden" />
    </div>
  )
}
