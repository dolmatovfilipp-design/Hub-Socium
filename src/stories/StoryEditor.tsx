import { useEffect, useRef, useState } from 'react'
import { apiCreateStory, apiUploadMedia, isApiMode } from '../lib/api'
import { useStore } from '../store/useStore'
import type { StoryCapture } from './StoryCamera'
import { StoryFrame } from './StoryFrame'
import { STORY_FILTERS, TEXT_STYLES, stepFilter, type StoryTextStyle } from './filters'
import { StoryIconClose, StoryIconMusic, StoryIconPin, StoryIconText } from './icons'

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
        <p className="pointer-events-none absolute left-1/2 top-[38%] z-20 -translate-x-1/2 rounded-full border border-white/20 bg-black/40 px-4 py-1.5 text-[15px] font-medium backdrop-blur-xl">
          {filterFlash}
        </p>
      ) : null}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
        <button type="button" aria-label="Назад" className="text-white" onClick={onBack}>
          <StoryIconClose />
        </button>
        <span className="text-[13px] text-white/80">{activeFilter}</span>
        <span className="w-6" />
      </div>

      {editingText ? (
        <div className="absolute inset-0 z-30 flex flex-col bg-black/45 px-5 pt-[max(18px,env(safe-area-inset-top))]">
          <div className="flex justify-end">
            <button type="button" className="text-[16px] font-semibold text-white" onClick={commitText}>
              Готово
            </button>
          </div>
          <div className="mt-6 flex justify-center gap-5">
            {TEXT_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                aria-pressed={draftStyle === style.id}
                className={`text-[15px] ${draftStyle === style.id ? 'font-semibold text-white' : 'text-white/55'}`}
                onClick={() => setDraftStyle(style.id)}
              >
                {style.label}
              </button>
            ))}
          </div>
          <textarea
            value={draft}
            autoFocus
            placeholder="Текст"
            rows={3}
            maxLength={300}
            onChange={(event) => setDraft(event.target.value.slice(0, 300))}
            className={`mt-8 w-full resize-none bg-transparent text-center text-[28px] font-semibold leading-tight outline-none placeholder:text-white/40 ${draftStyle === 'plate' ? 'text-black' : 'text-white'}`}
            style={draftStyle === 'plate' ? { background: 'white', borderRadius: 16, padding: '8px 12px' } : undefined}
          />
        </div>
      ) : null}

      {editingPlace ? (
        <div className="absolute inset-x-0 top-[max(64px,env(safe-area-inset-top))] z-30 px-4">
          <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-black/50 px-3 py-2 backdrop-blur-xl">
            <input
              value={placeDraft}
              autoFocus
              placeholder="Место"
              maxLength={80}
              onChange={(event) => setPlaceDraft(event.target.value.slice(0, 80))}
              className="w-full bg-transparent text-[16px] text-white outline-none placeholder:text-white/40"
            />
            <button type="button" className="shrink-0 text-[15px] font-semibold" onClick={commitPlace}>
              Добавить место
            </button>
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div
          data-testid="story-filters"
          className="mb-3 flex gap-4 overflow-x-auto rounded-full border border-white/15 bg-white/[0.08] px-4 py-2.5 backdrop-blur-xl scrollbar-none"
        >
          {STORY_FILTERS.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={filterId === item.id}
              className={`shrink-0 snap-center text-[14px] ${filterId === item.id ? 'font-semibold text-white' : 'text-white/55'}`}
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
            className="mb-3 flex items-center gap-2 text-[14px] text-white"
            onClick={() => {
              if (songUrl) URL.revokeObjectURL(songUrl)
              setSongFile(null)
              setSongUrl(null)
            }}
          >
            <StoryIconMusic size={18} />
            <span className="truncate">{songLabel(songFile.name)}</span>
            <span className="text-white/50">Убрать</span>
          </button>
        ) : null}
        <div className="mb-4 flex items-center justify-around text-white">
          <button type="button" aria-label="Текст" className="flex flex-col items-center gap-1" onClick={openText}>
            <StoryIconText />
            <span className="text-[11px] text-white/70">Текст</span>
          </button>
          <button
            type="button"
            aria-label="Место"
            className="flex flex-col items-center gap-1"
            onClick={() => {
              setPlaceDraft(placeName)
              setEditingText(false)
              setEditingPlace(true)
            }}
          >
            <StoryIconPin />
            <span className="text-[11px] text-white/70">Место</span>
          </button>
          <button type="button" aria-label="Песня" className="flex flex-col items-center gap-1" onClick={() => songRef.current?.click()}>
            <StoryIconMusic />
            <span className="text-[11px] text-white/70">Песня</span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-[14px] text-white/80"
            onClick={() => setAudience((value) => (value === 'all' ? 'close_friends' : 'all'))}
          >
            {audience === 'all' ? 'Всем' : 'Близким'}
          </button>
          <button
            type="button"
            disabled={publishing}
            onClick={() => void publish()}
            className="ml-auto h-12 rounded-full border border-white/20 px-5 text-[16px] font-semibold text-white disabled:opacity-50"
            style={{
              background:
                'linear-gradient(165deg, rgba(255,255,255,0.16), rgba(255,255,255,0.05) 45%, rgba(255,255,255,0.1)), rgba(22,22,22,0.72)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 20px rgba(0,0,0,0.4)',
              backdropFilter: 'blur(18px)',
            }}
          >
            {publishing ? 'Публикация…' : 'Опубликовать'}
          </button>
        </div>
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
