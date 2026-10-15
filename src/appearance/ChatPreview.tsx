import { cssImage } from './chatBackground'
import type { ChatBackground } from './types'

export function ChatPreview({
  image,
  background,
  accentFill,
  accentInk,
  fontPx,
}: {
  image: string | null
  background: ChatBackground
  accentFill: string
  accentInk: string
  fontPx: number
}) {
  const shown = background.kind !== 'none' && !!image
  return (
    <div className="appearance-stage" aria-label="Предпросмотр чата">
      {shown ? (
        <div
          className="appearance-stage-bg"
          style={{
            backgroundImage: cssImage(image),
            ['--chat-bg-blur' as string]: `${background.blur}px`,
          }}
        />
      ) : null}
      {shown ? <div className="appearance-stage-dim" style={{ opacity: background.dim / 100 }} /> : null}
      <div className="appearance-stage-thread">
        <div className="appearance-bubble appearance-bubble-theirs" style={{ fontSize: fontPx }}>
          Как читается текст
        </div>
        <div
          className="appearance-bubble appearance-bubble-mine"
          style={{ fontSize: fontPx, background: accentFill, color: accentInk }}
        >
          На любом фоне
        </div>
      </div>
    </div>
  )
}
