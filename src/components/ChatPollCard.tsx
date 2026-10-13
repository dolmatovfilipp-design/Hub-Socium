import { apiCloseChatPoll, apiVoteChatPoll, type ChatPoll } from '../lib/api'
import { useStore } from '../store/useStore'
import { ruPlural } from '../utils/ru'

export function ChatPollCard({
  conversationId,
  messageId,
  poll,
  onUpdate,
}: {
  conversationId: string
  messageId: string
  poll: ChatPoll
  onUpdate?: (poll: ChatPoll) => void
}) {
  const showToast = useStore((s) => s.showToast)
  const votesSum = poll.options.reduce((a, o) => a + (o.votes || 0), 0)
  const voted = (poll.my_votes?.length ?? 0) > 0 || poll.options.some((o) => o.voted)

  const vote = async (idx: number) => {
    if (poll.closed) return
    try {
      const res = await apiVoteChatPoll(conversationId, messageId, idx)
      if (res.poll) onUpdate?.(res.poll)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Голос не принят')
    }
  }

  const close = async () => {
    try {
      const res = await apiCloseChatPoll(conversationId, messageId)
      if (res.poll) onUpdate?.(res.poll)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось завершить')
    }
  }

  return (
    <div className="min-w-[200px] max-w-[260px]">
      <p className="mb-2 text-[14px] font-semibold text-white">{poll.question}</p>
      <ul className="space-y-1.5">
        {poll.options.map((o) => {
          const pct = votesSum > 0 ? Math.round((100 * (o.votes || 0)) / votesSum) : 0
          const showBar = voted || poll.closed
          return (
            <li key={o.idx}>
              <button
                type="button"
                disabled={poll.closed || (voted && !poll.multiple)}
                onClick={() => void vote(o.idx)}
                className="pressable relative w-full overflow-hidden rounded-xl bg-black/25 px-3 py-2 text-left text-[13px] text-white disabled:opacity-90"
              >
                {showBar ? (
                  <span className="absolute inset-y-0 left-0 bg-white/15" style={{ width: `${pct}%` }} />
                ) : null}
                <span className="relative flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {o.voted ? '✓ ' : ''}
                    {o.label}
                  </span>
                  {showBar ? <span className="shrink-0 tabular-nums text-[#c8c8c8]">{pct}%</span> : null}
                </span>
              </button>
              {!poll.anonymous && o.voters && o.voters.length > 0 ? (
                <p className="mt-0.5 truncate px-1 text-[11px] text-[#8e8e93]">{o.voters.join(', ')}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-[11px] text-[#8e8e93]">
        {ruPlural(poll.total_voters || 0, 'голос', 'голоса', 'голосов')}
        {poll.anonymous ? ' · анонимно' : ''}
        {poll.multiple ? ' · несколько' : ''}
        {poll.closed ? ' · завершён' : ''}
      </p>
      {poll.can_close && !poll.closed ? (
        <button type="button" className="mt-1 text-[12px] font-medium text-[#8e8e93]" onClick={() => void close()}>
          Завершить
        </button>
      ) : null}
    </div>
  )
}
