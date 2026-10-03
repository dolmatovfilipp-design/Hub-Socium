import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from './Avatar'
import { useStore } from '../store/useStore'
import { formatCount, formatTimeAgo } from '../utils/validation'
import { IconHeart, IconReply, IconRepost, IconShare, IconMore, IconPlus } from './Icons'
import { ShareSheet } from './ShareSheet'
import { PostMoreSheet } from './PostMoreSheet'
import { MentionText } from './MentionText'
import { ImageCarousel } from './ImageCarousel'
import { PollBlock } from './PollBlock'

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
  const followingIds = useStore((s) => s.followingIds)
  const followUser = useStore((s) => s.followUser)
  const [followBusy, setFollowBusy] = useState(false)
  const [heartAnim, setHeartAnim] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => {
    if (!heartAnim) return
    const t = window.setTimeout(() => setHeartAnim(false), 350)
    return () => window.clearTimeout(t)
  }, [heartAnim])

  if (!post) {
    return (
      <article className="animate-fade-in px-4 py-4" aria-hidden>
        <div className="flex gap-3.5">
          <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06]" />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <div className="h-3 w-28 rounded bg-white/[0.06]" />
            <div className="h-3 w-full rounded bg-white/[0.04]" />
            <div className="h-3 w-2/3 rounded bg-white/[0.04]" />
          </div>
        </div>
      </article>
    )
  }

  if (!author) {
    return (
      <article className="animate-fade-in hub-row-divider px-4 py-4">
        <div className="flex gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[12px] text-[#777]">
            ?
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[#8e8e93]">Профиль недоступен</p>
            <p className="mt-1 break-words whitespace-pre-wrap text-[15px] leading-[1.5] text-white/80 text-pretty">
              {post.text || 'Публикация'}
            </p>
          </div>
        </div>
      </article>
    )
  }

  const liked = uid ? post.likes.includes(uid) : false
  const reposted = uid ? post.reposts.includes(uid) : false
  const isOther = uid !== author.id
  const following = followingIds.includes(author.id)

  const onLike = () => {
    toggleLike(post.id)
    if (!liked) setHeartAnim(true)
  }

  return (
    <>
      <article className="animate-fade-in hub-row-divider px-4 py-4">
        <div className="flex gap-3.5">
          <div className="flex w-10 shrink-0 flex-col items-center">
            <div className="relative">
              <Link to={`/app/profile/${author.id}`}>
                <Avatar name={author.name} id={author.id} src={author.avatar} size={40} />
              </Link>
              {showFollowPlus && isOther && !following && (
                <button
                  type="button"
                  aria-label={`Подписаться на @${author.username}`}
                  disabled={followBusy}
                  className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-black shadow-[0_0_0_2px_#000] disabled:opacity-50"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (followBusy) return
                    setFollowBusy(true)
                    void followUser(author.id).finally(() => setFollowBusy(false))
                  }}
                >
                  <IconPlus size={10} strokeWidth={2.6} />
                </button>
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
                className="pressable ml-auto flex h-11 w-11 shrink-0 items-center justify-center text-[#8e8e93]"
                aria-label="Ещё"
                onClick={() => setMoreOpen(true)}
              >
                <IconMore size={18} />
              </button>
            </div>

            <p className="mt-1.5 break-words whitespace-pre-wrap text-[15px] leading-[1.5] text-white text-pretty">
              <MentionText text={post.text} />
            </p>
            {(post as { original?: { text?: string; authorId?: string }; quoteText?: string; isQuote?: boolean }).original ||
            (post as { quoteText?: string }).quoteText ? (
              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                {(post as { quoteText?: string }).quoteText ? (
                  <p className="mb-2 text-[13px] text-[#8e8e93]">Цитата / репост</p>
                ) : (
                  <p className="mb-2 text-[13px] text-[#8e8e93]">Репост</p>
                )}
                {(post as { original?: { text: string } }).original?.text ? (
                  <MentionText
                    text={(post as { original: { text: string } }).original.text}
                    className="whitespace-pre-wrap text-[14px] text-[#c7c7cc]"
                  />
                ) : null}
              </div>
            ) : null}

            {(post.images?.length || post.image) && (
              <div className="mt-2.5">
                <ImageCarousel urls={post.images?.length ? post.images : post.image ? [post.image] : []} />
              </div>
            )}
            {post.poll ? (
              <PollBlock
                poll={post.poll as any}
                onUpdate={(next) => {
                  useStore.setState((s) => ({
                    posts: s.posts.map((x) => (x.id === post.id ? { ...x, poll: next as any } : x)),
                  }))
                }}
              />
            ) : null}

            <div className="mt-3 flex items-center gap-4 text-[#c7c7cc]">
              <button
                type="button"
                className="pressable flex min-h-[44px] min-w-[44px] items-center gap-1.5 py-2.5 -my-1"
                onClick={onLike}
                aria-label="Нравится"
              >
                <span className={heartAnim ? 'heart-pop inline-flex' : 'inline-flex'}>
                  <IconHeart
                    size={22}
                    filled={liked}
                    strokeWidth={1.7}
                    className={liked ? 'text-[#ff3040]' : 'text-[#c7c7cc]'}
                  />
                </span>
                {post.likes.length > 0 && (
                  <span className="text-[13px] tabular-nums text-[#c7c7cc]">
                    {formatCount(post.likes.length)}
                  </span>
                )}
              </button>

              {showReplyHint && (
                <Link
                  to={`/app/compose?reply=${post.id}`}
                  className="pressable flex min-h-[44px] min-w-[44px] items-center gap-1.5 py-2.5 -my-1 text-[#c7c7cc]"
                  aria-label="Ответить"
                >
                  <IconReply size={22} strokeWidth={1.7} />
                  {post.replies.length > 0 && (
                    <span className="text-[13px] tabular-nums">
                      {formatCount(post.replies.length)}
                    </span>
                  )}
                </Link>
              )}

              <button
                type="button"
                className={`pressable flex min-h-[44px] min-w-[44px] items-center gap-1.5 py-2.5 -my-1 ${
                  reposted ? 'text-white' : 'text-[#c7c7cc]'
                }`}
                onClick={() => toggleRepost(post.id)}
                aria-label="Репост"
              >
                <IconRepost size={22} strokeWidth={1.7} />
                {post.reposts.length > 0 && (
                  <span className="text-[13px] tabular-nums">
                    {formatCount(post.reposts.length)}
                  </span>
                )}
              </button>

              <button
                type="button"
                className="pressable flex min-h-[44px] min-w-[44px] items-center gap-1.5 py-2.5 -my-1 text-[#c7c7cc]"
                aria-label="Поделиться"
                onClick={() => setShareOpen(true)}
              >
                <IconShare size={21} strokeWidth={1.7} />
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
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Поделиться публикацией"
        path={`/app/p/${post.id}`}
      />
    </>
  )
}
