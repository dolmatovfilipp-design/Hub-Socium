import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from './Avatar'
import { useStore } from '../store/useStore'
import { formatCount, formatTimeAgo } from '../utils/validation'
import { IconHeart, IconReply, IconRepost, IconShare, IconMore, IconPlus } from './Icons'
import { PostMoreSheet } from './PostMoreSheet'

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
  const showToast = useStore((s) => s.showToast)
  const [heartAnim, setHeartAnim] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

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
    <>
      <article className="animate-fade-in px-4 py-3.5">
        <div className="flex gap-3">
          <div className="flex w-9 shrink-0 flex-col items-center">
            <div className="relative">
              <Link to={`/app/profile/${author.id}`}>
                <Avatar name={author.name} id={author.id} src={author.avatar} size={36} />
              </Link>
              {showFollowPlus && isOther && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-white text-black shadow-[0_0_0_2px_#000]"
                  aria-hidden
                >
                  <IconPlus size={9} strokeWidth={2.6} />
                </span>
              )}
            </div>
            <div className="thread-line" />
          </div>

          <div className="min-w-0 flex-1 pb-0.5">
            <div className="flex items-center gap-1.5">
              <Link
                to={`/app/profile/${author.id}`}
                className="truncate text-[15px] font-semibold leading-tight text-white"
              >
                {author.username}
              </Link>
              <span className="shrink-0 text-[13px] leading-tight text-[#8e8e93]">
                {formatTimeAgo(post.createdAt)}
              </span>
              <button
                type="button"
                className="pressable ml-auto flex h-8 w-8 shrink-0 items-center justify-center text-[#8e8e93]"
                aria-label="Ещё"
                onClick={() => setMoreOpen(true)}
              >
                <IconMore size={18} />
              </button>
            </div>

            <p className="mt-1 whitespace-pre-wrap text-[15px] leading-[1.45] text-white">
              {post.text}
            </p>

            {post.image && (
              <div className="relative mt-2.5 overflow-hidden rounded-[12px] border border-white/[0.08]">
                <img
                  src={post.image}
                  alt=""
                  className="block max-h-[420px] w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}

            <div className="mt-2.5 flex items-center gap-5 text-[#a8a8a8]">
              <button
                type="button"
                className="pressable flex min-h-[32px] items-center gap-1.5"
                onClick={onLike}
                aria-label="Нравится"
              >
                <span className={heartAnim ? 'heart-pop inline-flex' : 'inline-flex'}>
                  <IconHeart
                    size={18}
                    filled={liked}
                    strokeWidth={1.35}
                    className={liked ? 'text-[#ff3040]' : 'text-[#a8a8a8]'}
                  />
                </span>
                {post.likes.length > 0 && (
                  <span className="text-[12px] tabular-nums text-[#a8a8a8]">
                    {formatCount(post.likes.length)}
                  </span>
                )}
              </button>

              {showReplyHint && (
                <Link
                  to={`/app/compose?reply=${post.id}`}
                  className="pressable flex min-h-[32px] items-center gap-1.5 text-[#a8a8a8]"
                  aria-label="Ответить"
                >
                  <IconReply size={18} strokeWidth={1.35} />
                  {post.replies.length > 0 && (
                    <span className="text-[12px] tabular-nums">
                      {formatCount(post.replies.length)}
                    </span>
                  )}
                </Link>
              )}

              <button
                type="button"
                className={`pressable flex min-h-[32px] items-center gap-1.5 ${
                  reposted ? 'text-white' : 'text-[#a8a8a8]'
                }`}
                onClick={() => toggleRepost(post.id)}
                aria-label="Репост"
              >
                <IconRepost size={18} strokeWidth={1.35} />
                {post.reposts.length > 0 && (
                  <span className="text-[12px] tabular-nums">
                    {formatCount(post.reposts.length)}
                  </span>
                )}
              </button>

              <button
                type="button"
                className="pressable flex min-h-[32px] items-center gap-1.5 text-[#a8a8a8]"
                aria-label="Поделиться"
                onClick={() => {
                  void navigator.clipboard?.writeText(post.text).then(
                    () => showToast('Скопировано'),
                    () => showToast('Не удалось скопировать'),
                  )
                }}
              >
                <IconShare size={17} strokeWidth={1.35} />
              </button>
            </div>
          </div>
        </div>
      </article>

      <PostMoreSheet
        postId={post.id}
        authorId={author.id}
        authorUsername={author.username}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
      />
    </>
  )
}
