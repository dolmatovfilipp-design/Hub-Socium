import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiNearby, isApiMode } from '../lib/api'
import { FeedSkeleton } from '../components/Skeleton'
import { HubEmptyState } from '../components/HubEmptyState'
import { useNavMotion } from '../components/NavMotion'

export function Nearby() {
  const { motionClass, dismiss } = useNavMotion('push')
  const [city, setCity] = useState('')
  const [note, setNote] = useState<string | undefined>()
  const [posts, setPosts] = useState<any[]>([])
  const [ads, setAds] = useState<any[]>([])
  const [meetups, setMeetups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    void apiNearby()
      .then((d) => {
        setCity(d.city || '')
        setNote(d.note)
        setPosts(d.posts || [])
        setAds(d.ads || [])
        setMeetups(d.meetups || [])
      })
      .catch(() => setNote('Не удалось загрузить'))
      .finally(() => setLoading(false))
  }, [])

  const empty = !loading && !posts.length && !ads.length && !meetups.length

  return (
    <div className={`flex h-full flex-col bg-black text-white ${motionClass}`}>
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.08] px-4 pb-3">
        <button type="button" className="text-[#8e8e93]" onClick={() => dismiss('/app')}>
          ←
        </button>
        <div>
          <h1 className="text-[17px] font-semibold">Рядом</h1>
          <p className="text-[12px] text-[#8e8e93]">{city || 'Город не указан'}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-pad-nav">
        {loading && <FeedSkeleton />}
        {!loading && note && empty && (
          <HubEmptyState title="Рядом" subtitle={note} />
        )}
        {!loading && !note && empty && (
          <HubEmptyState
            title={city ? `Пока тихо в «${city}»` : 'Рядом'}
            subtitle="Посты, объявления и встречи с вашим городом появятся здесь."
          />
        )}
        {!loading && meetups.length > 0 && (
          <section className="px-4 pt-4">
            <p className="hub-section-title mb-2">Встречи</p>
            <div className="space-y-2">
              {meetups.map((m) => (
                <Link key={m.id} to={`/app/meetups/${m.id}`} className="hub-card block p-3">
                  <p className="font-semibold">{m.title}</p>
                  <p className="text-[13px] text-[#8e8e93]">{m.place}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
        {!loading && ads.length > 0 && (
          <section className="px-4 pt-4">
            <p className="hub-section-title mb-2">Объявления</p>
            <div className="space-y-2">
              {ads.map((a) => (
                <div key={a.id} className="hub-card p-3">
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-[13px] text-[#8e8e93]">{a.price?.toLocaleString?.('ru-RU')} ₽ · {a.city}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {!loading && posts.length > 0 && (
          <section className="px-4 py-4">
            <p className="hub-section-title mb-2">Посты</p>
            <div className="space-y-2">
              {posts.map((p) => (
                <Link key={p.id} to={`/app/p/${p.id}`} className="hub-card block p-3">
                  <p className="text-[13px] text-[#8e8e93]">@{p.author?.username}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[15px]">{p.body}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
