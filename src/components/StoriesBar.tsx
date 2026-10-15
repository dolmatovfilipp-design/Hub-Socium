import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { IconPlus } from './Icons'
import { StoryCamera, type StoryCapture } from '../stories/StoryCamera'
import { StoryEditor } from '../stories/StoryEditor'
import { StoryFrame, type StoryFrameMedia } from '../stories/StoryFrame'
import { openStoryCamera, releaseStoryCamera, retainStoryCamera } from '../stories/cameraSession'
import { StoryIconClose, StoryIconMusic } from '../stories/icons'
import {
  apiCreateConversation,
  apiListStoryRing,
  apiListUserStories,
  apiSendMessageFull,
  isApiMode,
  type ApiStory,
  type ApiStoryRingItem,
} from '../lib/api'
import { useStore } from '../store/useStore'
import { useTabVisible } from '../lib/tabVisible'

type Flow = 'camera' | 'editor' | null

function frameKind(story: ApiStory): StoryFrameMedia {
  if (story.media_kind === 'video' || story.media_kind === 'audio' || story.media_kind === 'image' || story.media_kind === 'text') {
    return story.media_kind
  }
  const url = story.media_url || ''
  if (/\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(url)) return 'video'
  if (/\.(mp3|m4a|wav|ogg|aac|flac)(?:[?#]|$)/i.test(url)) return 'audio'
  if (url) return 'image'
  return 'text'
}

export function StoriesBar() {
  const showToast = useStore((s) => s.showToast)
  const me = useStore((s) => s.currentUserId)
  const [items, setItems] = useState<ApiStoryRingItem[]>([])
  const [viewer, setViewer] = useState<{ authorId: string; stories: ApiStory[]; idx: number } | null>(null)
  const [flow, setFlow] = useState<Flow>(null)
  const [capture, setCapture] = useState<StoryCapture | null>(null)

  const tabVisible = useTabVisible()
  const load = () => {
    if (!isApiMode()) return
    void apiListStoryRing()
      .then((r) => setItems(r.items ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    if (!tabVisible) return
    load()
  }, [tabVisible])

  const flowOpen = flow !== null
  useEffect(() => {
    if (!flowOpen) return
    retainStoryCamera()
    return () => releaseStoryCamera()
  }, [flowOpen])

  const dropCapture = () => {
    setCapture((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
  }

  const closeFlow = () => {
    dropCapture()
    setFlow(null)
  }

  const open = async (authorId: string) => {
    try {
      const r = await apiListUserStories(authorId)
      if (!r.items?.length) {
        showToast('Нет активных историй')
        return
      }
      setViewer({ authorId, stories: r.items, idx: 0 })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const cur = viewer ? viewer.stories[viewer.idx] : null
  const otherItems = items.filter((it) => !it.is_me)
  const curKind = cur ? frameKind(cur) : 'text'

  return (
    <>
      <div className="stories-scroller flex gap-3 overflow-x-auto px-4 py-3 scrollbar-none">
        <button
          type="button"
          onClick={() => {
            // Start getUserMedia inside the tap. iOS Safari drops the gesture if it begins in an effect.
            void openStoryCamera('user').catch(() => {})
            setFlow('camera')
          }}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
          aria-label="Добавить историю"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-white/30 bg-[#1c1c1e] text-white">
            <IconPlus size={25} strokeWidth={1.35} />
          </span>
          <span className="truncate text-[11px] text-[#8e8e93]">Ваша история</span>
        </button>
        {isApiMode() && otherItems.map((it) => (
          <button
            key={it.author.id}
            type="button"
            onClick={() => void open(it.author.id)}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <span
              className={`rounded-full p-[2px] ${it.seen ? 'bg-white/20' : 'bg-gradient-to-tr from-[#ff7a18] to-[#af002d]'}`}
            >
              <Avatar
                name={it.author.display_name || it.author.username}
                id={it.author.id}
                src={it.author.avatar_url}
                size={52}
              />
            </span>
            <span className="w-full truncate text-center text-[11px] text-[#c7c7cc]">
              {it.author.username}
            </span>
          </button>
        ))}
      </div>

      {flow === 'camera' && (
        <StoryCamera
          onClose={closeFlow}
          onCapture={(next) => {
            setCapture((current) => {
              if (current) URL.revokeObjectURL(current.url)
              return next
            })
            setFlow('editor')
          }}
        />
      )}
      {flow === 'editor' && capture && (
        <StoryEditor
          capture={capture}
          onBack={() => {
            dropCapture()
            setFlow('camera')
          }}
          onPublished={() => {
            closeFlow()
            load()
          }}
        />
      )}

      {viewer && cur && (
        <div className="fixed inset-0 z-[var(--hub-z-modal)] h-[100dvh] bg-black">
          <StoryFrame
            mediaUrl={cur.media_url}
            mediaKind={curKind}
            filterId={cur.filter_id}
            mirrored={cur.mirrored}
            body={cur.body}
            textStyle={cur.text_style}
            textX={cur.text_x}
            textY={cur.text_y}
            placeName={cur.place_name}
            placeX={cur.place_x}
            placeY={cur.place_y}
            videoMuted={!!cur.song_url}
          />
          {cur.song_url ? (
            <audio src={cur.song_url} autoPlay />
          ) : null}
          <div className="absolute inset-x-0 top-0 z-20 px-3 pt-[max(12px,env(safe-area-inset-top))]">
            <div className="flex gap-1">
              {viewer.stories.map((_, i) => (
                <div key={i} className={`h-0.5 flex-1 rounded-full ${i <= viewer.idx ? 'bg-white' : 'bg-white/25'}`} />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-white">
              <p className="text-[13px] text-white/80">24ч</p>
              <button type="button" aria-label="Закрыть" onClick={() => setViewer(null)}>
                <StoryIconClose size={24} />
              </button>
            </div>
            {cur.song_title ? (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-white">
                <StoryIconMusic size={16} />
                {cur.song_title}
              </p>
            ) : null}
          </div>
          <button type="button" className="absolute bottom-0 left-0 top-24 z-10 w-1/3" aria-label="Назад" onClick={() => setViewer((v) => (v && v.idx > 0 ? { ...v, idx: v.idx - 1 } : v))} />
          <button
            type="button"
            className="absolute bottom-0 right-0 top-24 z-10 w-1/3"
            aria-label="Далее"
            onClick={() => setViewer((v) => {
              if (!v) return v
              if (v.idx < v.stories.length - 1) return { ...v, idx: v.idx + 1 }
              return null
            })}
          />
          {me && viewer.authorId !== me ? (
            <button
              type="button"
              className="absolute bottom-[max(24px,env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2 text-[15px] font-medium text-white"
              onClick={() => {
                const text = window.prompt('Ответ на историю') || ''
                if (!text.trim() || !cur) return
                void apiCreateConversation({ user_id: viewer.authorId })
                  .then((c) => apiSendMessageFull(c.id, { body: text.trim(), story_id: cur.id }))
                  .then(() => { showToast('Отправлено в сообщения'); setViewer(null) })
                  .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось'))
              }}
            >
              Ответить
            </button>
          ) : null}
        </div>
      )}
    </>
  )
}
