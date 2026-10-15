import type { ReactNode } from 'react'
import { useChatBackground } from './chatBackground'

export function ChatFrame({
  conversationId,
  className,
  children,
}: {
  conversationId?: string
  className?: string
  children: ReactNode
}) {
  const wall = useChatBackground(conversationId)
  return (
    <div className={`${className ?? ''} ${wall.active ? 'chat-wallpaper-on' : ''}`.trim()} style={wall.layerStyle}>
      {wall.active ? (
        <div className="chat-wallpaper-layer" aria-hidden="true">
          <div className="chat-wallpaper-image" />
          <div className="chat-wallpaper-dim" />
        </div>
      ) : null}
      {children}
    </div>
  )
}
