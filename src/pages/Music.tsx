import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { HubEmptyState } from '../components/HubEmptyState'
import { IconChevron } from '../components/Icons'
import { apiCreateMusic, apiDeleteMusic, apiListMusic, isApiMode } from '../lib/api'
import { useStore } from '../store/useStore'

type Track = { id: string; title: string; artist: string; url: string }

export function Music() {
  const showToast = useStore((s) => s.showToast)
  const [items, setItems] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!isApiMode()) {
      setLoading(false)
      return
    }
    setLoading(true)
    void apiListMusic()
      .then((r) => setItems(r.items ?? []))
      .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось загрузить'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!isApiMode()) {
      showToast('Треки сохраняются при подключении к серверу')
      return
    }
    const link = url.trim()
    if (!title.trim() || !/^https?:\/\//i.test(link)) {
      showToast('Нужны название и ссылка http(s)')
      return
    }
    setBusy(true)
    void apiCreateMusic({ title: title.trim(), artist: artist.trim(), url: link })
      .then((row) => {
        setItems((prev) => [row, ...prev])
        setTitle('')
        setArtist('')
        setUrl('')
        showToast('Сохранено')
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'Не удалось сохранить'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top relative flex shrink-0 items-center justify-center border-b border-white/[0.06] px-2 pb-3 pt-2">
        <Link
          to="/app"
          className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
          aria-label="Назад"
        >
          <IconChevron size={22} className="-scale-x-100" />
        </Link>
        <h1 className="text-[17px] font-bold text-white">Музыка</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
        <form onSubmit={add} className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название"
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white outline-none"
          />
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Исполнитель"
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white outline-none"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white outline-none"
          />
          <button type="submit" disabled={busy} className="hub-btn hub-btn-primary w-full disabled:opacity-50">
            Добавить ссылку
          </button>
        </form>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8e8e93]">Загрузка…</p> : null}
        {!loading && !items.length ? (
          <div className="pt-10">
            <HubEmptyState
              title="Пока нет треков"
              subtitle="Сохраните ссылку на трек. Она останется в вашем аккаунте."
            />
          </div>
        ) : null}
        <ul className="mt-4 space-y-2">
          {items.map((track) => (
            <li key={track.id} className="flex items-center gap-3 rounded-2xl bg-[#1c1c1e] px-3 py-3">
              <a href={track.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-white">{track.title}</p>
                <p className="truncate text-[13px] text-[#8e8e93]">{track.artist || track.url}</p>
              </a>
              <button
                type="button"
                className="shrink-0 text-[13px] text-[#8e8e93]"
                onClick={() => {
                  void apiDeleteMusic(track.id)
                    .then(() => setItems((prev) => prev.filter((row) => row.id !== track.id)))
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Не удалось удалить'))
                }}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
