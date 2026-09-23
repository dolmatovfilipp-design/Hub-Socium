import { apiVotePoll, isApiMode, type ApiPoll } from '../lib/api'
import { useStore } from '../store/useStore'

export function PollBlock({
  poll,
  onUpdate,
}: {
  poll: ApiPoll
  onUpdate?: (p: ApiPoll) => void
}) {
  const showToast = useStore((s) => s.showToast)
  const total = poll.total_votes ?? poll.options.reduce((a, o) => a + (o.votes || 0), 0)
  const voted = (poll.my_votes && poll.my_votes.length > 0) || poll.options.some((o) => o.voted)

  const vote = async (optionId: string) => {
    if (!isApiMode()) return
    try {
      const next = await apiVotePoll(poll.id, optionId)
      onUpdate?.(next)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Голос не принят')
    }
  }

  return (
    <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="mb-2 text-[14px] font-semibold text-white">{poll.question}</p>
      <ul className="space-y-2">
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((100 * (o.votes || 0)) / total) : 0
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={voted && !poll.multi}
                onClick={() => void vote(o.id)}
                className="relative w-full overflow-hidden rounded-xl border border-white/10 px-3 py-2 text-left text-[13px] text-white disabled:opacity-90"
              >
                <span
                  className="absolute inset-y-0 left-0 bg-white/10"
                  style={{ width: voted || total > 0 ? `${pct}%` : '0%' }}
                />
                <span className="relative flex justify-between gap-2">
                  <span>
                    {o.voted ? '✓ ' : ''}
                    {o.label}
                  </span>
                  {(voted || total > 0) && <span className="tabular-nums text-[#8e8e93]">{pct}%</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-[11px] text-[#8e8e93]">{total} голосов</p>
    </div>
  )
}
