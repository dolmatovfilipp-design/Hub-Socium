import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from './Avatar'
import { useStore } from '../store/useStore'
import { formatCount, formatTimeAgo } from '../utils/validation'
import { IconHeart, IconReply, IconRepost, IconShare, IconMore, IconPlus } from './Icons'

interface Props {
  postId: string
  showReplyHint?: boolean
  showFollowPlus?: boolean
}

export function PostCard({ postId, showReplyHint = true, showFollowPlus = true }: Props) {
  const post = useStore((s) => s.posts.find((p) => p.id === postId))
  const author = useStore((s) => (post ? s.users.find((u) => u.id === post.authorId) : undefined))
  const uid = useStore((s) => s.currentUserId)
  const toggleLike = useStore((s) => s.toggleLike)
  const toggleRepost = useStore((s) => s.toggleRepost)
  const [heartAnim, setHeartAnim] = useState(false)

  useEffect(() => {
    if (!heartAnim) return
    const t = window.setTimeout(() => setHeartAnim(false), 350)
    return () => window.clearTimeout(t)
  }, [heartAnim])

  if (!post || !author) return null

  const liked = uid ? post.likes.includes(uid) : false
  const reposted = uid ? post.reposts.includes(uid) : false
  const isOther = uid !== author.id

  const onLike = () => {
    toggleLike(post.id)
    if (!liked) setHeartAnim(true)
  }

  return (
    <article className="animate-fade-in px-4 py-3">
      <div className="flex gap-3">
        {/* Avatar rail */}
        <div className="flex w-10 shrink-0 flex-col items-center">
          <div className="relative">
            <Link to={`/app/profile/${author.id}`}>
              <Avatar name={author.name} id={author.id} src={author.avatar} size={36} />
            </Link>
            {showFollowPlus && isOther && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-black">
                <IconPlus size={10} strokeWidth={2.4} />
              </span>
            )}
          </div>
          <div className="thread-line" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 pb-1">
          <div className="flex items-center gap-1.5">
            <Link
              to={`/app/profile/${author.id}`}
              className="truncate text-[15px] font-semibold text-white"
            >
              {author.name}
            </Link>
            <span className="shrink-0 text-[13px] text-[#777]">
              {formatTimeAgo(post.createdAt)}
            </span>
            <button
              type="button"
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center text-[#777]"
              aria-label="Ещё"
            >
              <IconMore size={18} />
            </button>
          </div>

          <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[1.45] text-white">
            {post.text}
          </p>

          {post.image && (
            <div className="relative mt-2.5 overflow-hidden rounded-2xl border border-white/[0.08]">
              <img
                src={post.image}
                alt=""
                className="block max-h-[420px] w-full object-cover"
                loading="lazy"
              />
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-5 text-[#777]">
            <button
              type="button"
              className="pressable flex min-h-[36px] items-center gap-1.5"
              onClick={onLike}
              aria-label="Нравится"
            >
              <span className={heartAnim ? 'heart-pop inline-flex' : 'inline-flex'}>
                <IconHeart
                  size={18}
                  filled={liked}
                  className={liked ? 'text-[#ff3040]' : 'text-[#777]'}
                />
              </span>
              <span className="text-[12px] tabular-nums">{formatCount(post.likes.length)}</span>
            </button>

            {showReplyHint && (
              <Link
                to={`/app/compose?reply=${post.id}`}
                className="pressable flex min-h-[36px] items-center gap-1.5 text-[#777]"
                aria-label="Ответить"
              >
                <IconReply size={18} />
                <span className="text-[12px] tabular-nums">{formatCount(post.replies.length)}</span>
              </Link>
            )}

            <button
              type="button"
              className={`pressable flex min-h-[36px] items-center gap-1.5 ${
                reposted ? 'text-white' : 'text-[#777]'
              }`}
              onClick={() => toggleRepost(post.id)}
              aria-label="Репост"
            >
              <IconRepost size={18} />
              <span className="text-[12px] tabular-nums">{formatCount(post.reposts.length)}</span>
            </button>

            <button
              type="button"
              className="pressable flex min-h-[36px] items-center gap-1.5 text-[#777]"
              aria-label="Поделиться"
              onClick={() => {
                void navigator.clipboard?.writeText(post.text).catch(() => undefined)
              }}
            >
              <IconShare size={17} />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
