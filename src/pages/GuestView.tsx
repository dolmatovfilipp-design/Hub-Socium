import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGuestView } from '../lib/api'
import { Avatar } from '../components/Avatar'
import { IconVerified } from '../components/Icons'
import { HubEmptyState } from '../components/HubEmptyState'

/** T16: read-only guest/family view via invite link — no account. */
export function GuestView() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setErr('Нет ссылки')
      setLoading(false)
      return
    }
    void apiGuestView(token)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ссылка недействительна'))
      .finally(() => setLoading(false))
  }, [token])

  const host = data?.host
  const posts = data?.posts || []

  return (
    <div className="flex h-full min-h-[100dvh] flex-col bg-black text-white">
      <header className="safe-top border-b border-white/[0.06] px-4 pb-3 pt-2">
        <p className="text-[12px] font-medium uppercase tracking-wide text-[#8e8e93]">
          {data?.label || 'Семья'}
        </p>
        <h1 className="text-[17px] font-semibold">Просмотр без аккаунта</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="py-10 text-center text-[14px] text-[#8e8e93]">Загрузка…</p>
        ) : null}
        {err ? (
          <div className="py-8">
            <HubEmptyState title="Ссылка недоступна" subtitle={err} />
            <div className="mt-6 text-center">
              <Link
                to="/"
                className="pressable inline-block rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black"
              >
                Войти в Hub
              </Link>
            </div>
          </div>
        ) : null}
        {host ? (
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <Avatar name={host.display_name || host.username} id={host.id} src={host.avatar_url} size={56} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[18px] font-bold">
                  <span className="truncate">{host.display_name}</span>
                  {host.is_verified ? <IconVerified size={16} /> : null}
                </p>
                <p className="text-[14px] text-[#8e8e93]">@{host.username}</p>
              </div>
            </div>
            {host.bio ? <p className="mt-3 whitespace-pre-wrap text-[15px] text-[#e5e5ea]">{host.bio}</p> : null}
            <p className="mt-3 text-[12px] text-[#777]">{data?.note || 'Только просмотр. Писать нельзя.'}</p>
          </div>
        ) : null}
        {!loading && !err && host && posts.length === 0 ? (
          <HubEmptyState title="Пока пусто" subtitle="У хозяина ещё нет публичных постов." />
        ) : null}
        <div className="space-y-3">
          {posts.map((p: any) => (
            <article key={p.id} className="hub-card p-3">
              <p className="whitespace-pre-wrap text-[15px] text-white">{p.body}</p>
              {p.image_url ? (
                <img src={p.image_url} alt="" className="mt-2 max-h-64 w-full rounded-xl object-cover" />
              ) : null}
            </article>
          ))}
        </div>
        {!loading && !err ? (
          <div className="mt-8 pb-10 text-center">
            <Link
              to="/"
              className="pressable inline-block rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black"
            >
              Войти в Hub
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
