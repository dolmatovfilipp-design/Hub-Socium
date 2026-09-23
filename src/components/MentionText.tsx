import { Link } from 'react-router-dom'

/** Split text into plain + @mention links. */
export function MentionText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(@[A-Za-zА-Яа-яЁё0-9_]{1,32})/g)
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith('@') && part.length > 1) {
          const user = part.slice(1)
          return (
            <Link
              key={i}
              to={`/app/u/${encodeURIComponent(user)}`}
              className="font-semibold text-[#7aa2ff]"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </Link>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}
