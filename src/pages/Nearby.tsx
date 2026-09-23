import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiNearby, apiSaveGeo, isApiMode } from '../lib/api'
import { FeedSkeleton } from '../components/Skeleton'
import { HubEmptyState } from '../components/HubEmptyState'
import { useNavMotion } from '../components/NavMotion'

type Marker = { id: string; kind: string; title?: string; lat: number; lng: number; approx?: boolean }

const GEO_KEY = 'hub_geo_v1'

function readCachedGeo(): { lat: number; lng: number } | undefined {
  try {
    const raw = sessionStorage.getItem(GEO_KEY)
    if (!raw) return undefined
    const j = JSON.parse(raw) as { lat?: number; lng?: number }
    if (typeof j.lat === 'number' && typeof j.lng === 'number') return { lat: j.lat, lng: j.lng }
  } catch {
    /* ignore */
  }
  return undefined
}

function writeCachedGeo(lat: number, lng: number) {
  try {
    sessionStorage.setItem(GEO_KEY, JSON.stringify({ lat, lng, t: Date.now() }))
  } catch {
    /* ignore */
  }
}

export function Nearby() {
  const { motionClass, dismiss } = useNavMotion('push')
  const [city, setCity] = useState('')
  const [note, setNote] = useState<string | undefined>()
  const [posts, setPosts] = useState<any[]>([])
  const [ads, setAds] = useState<any[]>([])
  const [meetups, setMeetups] = useState<any[]>([])
  const [markers, setMarkers] = useState<Marker[]>([])
  const [mode, setMode] = useState('city')
  const [loading, setLoading] = useState(true)
  const [geoMsg, setGeoMsg] = useState('')
  const [geoBusy, setGeoBusy] = useState(false)
  const [showConsent, setShowConsent] = useState(false)

  const load = useCallback(async (coords?: { lat: number; lng: number }) => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const d = await apiNearby(coords)
      setCity(d.city || '')
      setNote(d.note)
      setPosts(d.posts || [])
      setAds(d.ads || [])
      setMeetups(d.meetups || [])
      setMarkers(d.markers || [])
      setMode(d.mode || 'city')
    } catch {
      setNote('Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const cached = readCachedGeo()
    void load(cached)
  }, [load])

  const askGeo = () => {
    if (!navigator.geolocation) {
      setGeoMsg('Геолокация недоступна. Показан город из профиля.')
      setShowConsent(false)
      return
    }
    setGeoBusy(true)
    setGeoMsg('Запрос доступа…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        writeCachedGeo(lat, lng)
        void apiSaveGeo(lat, lng)
          .then(() => {
            setGeoMsg('Гео разрешено · примерные метки')
            setShowConsent(false)
            return load({ lat, lng })
          })
          .catch(() => {
            setGeoMsg('Гео на устройстве есть, сервер не сохранил')
            return load({ lat, lng })
          })
          .finally(() => setGeoBusy(false))
      },
      (err) => {
        setGeoBusy(false)
        setShowConsent(false)
        setGeoMsg(
          err.code === err.PERMISSION_DENIED
            ? 'Доступ запрещён — город профиля.'
            : 'Не удалось определить место. Город профиля.',
        )
        void load()
      },
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  const bounds = useMemo(() => {
    if (!markers.length) return null
    const lats = markers.map((m) => m.lat)
    const lngs = markers.map((m) => m.lng)
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    }
  }, [markers])

  const project = (lat: number, lng: number) => {
    if (!bounds) return { x: 50, y: 50 }
    const pad = 0.0008
    const w = Math.max(bounds.maxLng - bounds.minLng, pad)
    const h = Math.max(bounds.maxLat - bounds.minLat, pad)
    const x = ((lng - bounds.minLng) / w) * 100
    const y = (1 - (lat - bounds.minLat) / h) * 100
    return { x: Math.min(96, Math.max(4, x)), y: Math.min(96, Math.max(4, y)) }
  }

  const empty = !loading && !posts.length && !ads.length && !meetups.length
  const approxCount = markers.filter((m) => m.approx && m.kind !== 'me').length

  return (
    <div className={`flex h-full flex-col bg-black text-white ${motionClass}`}>
      <header className="safe-top flex items-center gap-3 border-b border-white/[0.06] px-4 pb-3">
        <button type="button" className="pressable text-[#8e8e93]" onClick={() => dismiss('/app')}>
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold">Рядом</h1>
          <p className="text-[12px] text-[#8e8e93]">
            {mode === 'map' ? 'Карта' : 'Список'} · {city || 'город не указан'}
          </p>
        </div>
        <button
          type="button"
          disabled={geoBusy}
          className="pressable shrink-0 rounded-full border border-white/[0.12] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          onClick={() => setShowConsent(true)}
        >
          Гео
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-pad-nav">
        {geoMsg ? <p className="px-4 pt-3 text-[12px] text-[#8e8e93]">{geoMsg}</p> : null}

        {markers.length > 0 ? (
          <div className="glass mx-4 mt-3 overflow-hidden rounded-2xl border border-white/[0.08]">
            <div className="relative h-52 w-full bg-[radial-gradient(ellipse_at_center,_#1a1a1a_0%,_#050505_70%)]">
              {markers.map((m) => {
                const { x, y } = project(m.lat, m.lng)
                const color =
                  m.kind === 'me' ? 'bg-white' : m.kind === 'meetup' ? 'bg-[#c7c7cc]' : 'bg-[#636366]'
                return (
                  <div
                    key={m.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${x}%`, top: `${y}%` }}
                    title={m.title || m.kind}
                  >
                    <span
                      className={`block h-2.5 w-2.5 rounded-full ${color} shadow-[0_0_0_3px_rgba(255,255,255,0.12)]`}
                    />
                    {m.kind === 'me' ? (
                      <span className="mt-1 block text-center text-[10px] text-white">Вы</span>
                    ) : (
                      <span className="mt-1 block max-w-[80px] truncate text-center text-[10px] text-[#8e8e93]">
                        {m.approx ? '~ ' : ''}
                        {m.title || m.kind}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="border-t border-white/[0.06] px-3 py-2 text-[11px] text-[#777]">
              {approxCount
                ? `~ примерные метки (${approxCount}) — без точных координат, около города.`
                : 'Встречи и объявления с координатами.'}
            </p>
          </div>
        ) : null}

        {loading && <FeedSkeleton />}
        {!loading && note && empty && <HubEmptyState title="Рядом" subtitle={note} />}
        {!loading && !note && empty && (
          <HubEmptyState
            title={city ? `Пока тихо в «${city}»` : 'Рядом'}
            subtitle="Нажмите «Гео» или укажите город в профиле."
          />
        )}

        {!loading && meetups.length > 0 && (
          <section className="px-4 pt-4">
            <p className="hub-section-title mb-2">Встречи</p>
            <div className="space-y-2">
              {meetups.map((m) => (
                <Link key={m.id} to={`/app/meetups/${m.id}`} className="hub-card block p-3">
                  <p className="font-semibold">{m.title}</p>
                  <p className="text-[13px] text-[#8e8e93]">{m.place || m.city}</p>
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
                  <p className="text-[13px] text-[#8e8e93]">
                    {a.price?.toLocaleString?.('ru-RU')} ₽ · {a.city}
                  </p>
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

      {showConsent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setShowConsent(false)}>
          <div
            className="glass-strong w-full max-w-md rounded-t-3xl border border-white/[0.08] px-5 pb-10 pt-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[17px] font-semibold text-white">Геолокация</p>
            <p className="mt-2 text-[14px] leading-snug text-[#8e8e93]">
              Покажем встречи и объявления рядом. Координаты примерные, хранятся у вас в Hub для «Рядом». Можно
              отказаться — останется город из профиля.
            </p>
            <button
              type="button"
              disabled={geoBusy}
              className="pressable mt-5 w-full rounded-full bg-white py-3 text-[15px] font-semibold text-black disabled:opacity-50"
              onClick={askGeo}
            >
              Разрешить гео
            </button>
            <button
              type="button"
              className="pressable mt-3 w-full py-2 text-[14px] text-[#8e8e93]"
              onClick={() => setShowConsent(false)}
            >
              Не сейчас
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
