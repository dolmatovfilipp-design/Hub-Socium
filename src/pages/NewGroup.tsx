import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { useStore } from '../store/useStore'
import {
  apiCreateGroup,
  apiSearchUsers,
  isApiMode,
  type ApiSearchUser,
} from '../lib/api'
import { useNavMotion } from '../components/NavMotion'

export function NewGroup() {
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('push')
  const showToast = useStore((s) => s.showToast)
  const uid = useStore((s) => s.currentUserId)
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState<ApiSearchUser[]>([])
  const [selected, setSelected] = useState<ApiSearchUser[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 280)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!isApiMode() || !debounced) {
      setHits([])
      return
    }
    let cancelled = false
    void apiSearchUsers({ q: debounced, limit: 30 })
      .then((r) => {
        if (!cancelled) setHits((r.items ?? []).filter((u) => u.id !== uid))
      })
      .catch(() => {
        if (!cancelled) setHits([])
      })
    return () => {
      cancelled = true
    }
  }, [debounced, uid])

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected])

  const toggle = (u: ApiSearchUser) => {
    setSelected((prev) =>
      prev.some((x) => x.id === u.id) ? prev.filter((x) => x.id !== u.id) : [...prev, u],
    )
  }

  const create = async () => {
    const t = title.trim()
    if (!t || busy) return
    if (!isApiMode()) {
      showToast('Группы доступны в API-режиме')
      return
    }
    setBusy(true)
    try {
      const conv = await apiCreateGroup({
        title: t,
        member_ids: selected.map((s) => s.id),
      })
      showToast(selected.length ? 'Группа создана · приглашения отправлены' : 'Группа создана')
      navigate(`/app/messages/${conv.id}`, { replace: true })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось создать')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-2 pb-2 pt-1">
        <button type="button" className="pressable px-2 py-2 text-[15px] text-white" onClick={() => dismiss(-1)}>
          Отмена
        </button>
        <h1 className="flex-1 text-center text-[16px] font-semibold text-white">Новая группа</h1>
        <button
          type="button"
          disabled={!title.trim() || busy}
          className="pressable px-2 py-2 text-[15px] font-semibold text-white disabled:opacity-40"
          onClick={() => void create()}
        >
          Создать
        </button>
      </header>

      <div className="px-4 pt-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название группы"
          maxLength={80}
          className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white placeholder:text-[#8e8e93]/50 outline-none"
        />
      </div>

      {selected.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-3">
          {selected.map((u) => (
            <button key={u.id} type="button" onClick={() => toggle(u)} className="shrink-0 text-center">
              <Avatar name={u.display_name || u.username} id={u.id} src={u.avatar_url} size={44} />
              <p className="mt-1 max-w-[56px] truncate text-[11px] text-[#aaa]">@{u.username}</p>
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Добавить людей"
          className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[15px] text-white placeholder:text-[#8e8e93]/50 outline-none"
        />
      </div>

      <div className="no-scrollbar mt-2 flex-1 overflow-y-auto">
        {hits.map((u) => {
          const on = selectedIds.has(u.id)
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/[0.03]"
            >
              <Avatar name={u.display_name || u.username} id={u.id} src={u.avatar_url} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-white">{u.display_name || u.username}</p>
                <p className="text-[13px] text-[#8e8e93]">@{u.username}</p>
              </div>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                  on ? 'border-white bg-white text-black' : 'border-white/30 text-transparent'
                } text-[12px] font-bold`}
              >
                ✓
              </span>
            </button>
          )
        })}
        {!hits.length && debounced && (
          <p className="px-4 py-8 text-center text-[14px] text-[#777]">Никого не найдено</p>
        )}
      </div>
    </div>
  )
}
