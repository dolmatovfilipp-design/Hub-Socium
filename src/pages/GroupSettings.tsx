import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { useNavMotion } from '../components/NavMotion'
import { useStore } from '../store/useStore'
import {
  apiInviteGroupMembers,
  apiKickGroupMember,
  apiListGroupMembers,
  apiPatchGroup,
  apiSearchUsers,
  apiUploadMedia,
  isApiMode,
  type ApiPeerUser,
  type ApiSearchUser,
} from '../lib/api'

type Member = ApiPeerUser & { role?: string }

export function GroupSettings() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('push')
  const showToast = useStore((s) => s.showToast)
  const uid = useStore((s) => s.currentUserId)
  const fileRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [amAdmin, setAmAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState<ApiSearchUser[]>([])

  const load = useCallback(async () => {
    if (!isApiMode() || !id) return
    setLoading(true)
    try {
      const res = await apiListGroupMembers(id)
      setTitle(res.title || '')
      setAvatarUrl(res.avatar_url || '')
      setMembers(res.items ?? [])
      setAmAdmin(!!res.am_admin)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [id, showToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 280)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!inviteOpen || !debounced || !isApiMode()) {
      setHits([])
      return
    }
    let cancelled = false
    const memberIds = new Set(members.map((m) => m.id))
    void apiSearchUsers({ q: debounced, limit: 30 })
      .then((r) => {
        if (!cancelled) {
          setHits((r.items ?? []).filter((u) => u.id !== uid && !memberIds.has(u.id)))
        }
      })
      .catch(() => {
        if (!cancelled) setHits([])
      })
    return () => {
      cancelled = true
    }
  }, [debounced, inviteOpen, members, uid])

  const memberCountLabel = useMemo(() => {
    const n = members.length
    if (n === 1) return '1 участник'
    if (n >= 2 && n <= 4) return `${n} участника`
    return `${n} участников`
  }, [members.length])

  const saveTitle = async () => {
    if (!id || !amAdmin || saving) return
    const t = title.trim()
    if (!t) {
      showToast('Название обязательно')
      return
    }
    setSaving(true)
    try {
      const r = await apiPatchGroup(id, { title: t })
      setTitle(r.title ?? t)
      showToast('Название сохранено')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const changeAvatar = async (file: File) => {
    if (!id || !amAdmin) return
    setSaving(true)
    try {
      const media = await apiUploadMedia(file)
      const r = await apiPatchGroup(id, { avatar_url: media.url })
      setAvatarUrl(r.avatar_url || media.url)
      showToast('Аватар обновлён')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setSaving(false)
    }
  }

  const invite = async (userId: string) => {
    if (!id) return
    try {
      const r = await apiInviteGroupMembers(id, [userId])
      showToast(r.invited ? 'Приглашение отправлено' : 'Уже приглашён')
      setHits((prev) => prev.filter((u) => u.id !== userId))
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось пригласить')
    }
  }

  const kickOrLeave = async (userId: string) => {
    if (!id) return
    const leaving = userId === uid
    if (!leaving && !amAdmin) return
    const ok = window.confirm(leaving ? 'Выйти из группы?' : 'Удалить участника?')
    if (!ok) return
    try {
      await apiKickGroupMember(id, userId)
      if (leaving) {
        showToast('Вы вышли')
        navigate('/app/messages', { replace: true })
        return
      }
      showToast('Удалено')
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  if (!isApiMode()) {
    return (
      <div className={`flex h-full items-center justify-center bg-black text-[#8e8e93] ${motionClass}`}>
        Группы только в API-режиме
      </div>
    )
  }

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top flex shrink-0 items-center gap-2 bg-black px-3 pb-2 pt-1">
        <button
          type="button"
          className="hub-circle-btn"
          aria-label="Назад"
          onClick={() => dismiss(id ? `/app/messages/${id}` : -1)}
        >
          ←
        </button>
        <h1 className="flex-1 text-center text-[16px] font-semibold text-white">Группа</h1>
        <span className="h-10 w-10" aria-hidden />
      </header>

      {loading ? (
        <p className="px-4 py-12 text-center text-[#8e8e93]">Загрузка…</p>
      ) : (
        <div className="no-scrollbar flex-1 overflow-y-auto">
          <div className="flex flex-col items-center px-4 pt-6">
            <button
              type="button"
              disabled={!amAdmin || saving}
              className="relative disabled:opacity-80"
              onClick={() => amAdmin && fileRef.current?.click()}
            >
              <Avatar name={title || 'Группа'} id={id || 'g'} src={avatarUrl || undefined} size={88} />
              {amAdmin ? (
                <span className="absolute bottom-0 right-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-black">
                  Изм.
                </span>
              ) : null}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void changeAvatar(f)
              }}
            />
            <p className="mt-3 text-[13px] text-[#8e8e93]">{memberCountLabel}</p>
          </div>

          <div className="mt-5 px-4">
            <label className="mb-1.5 block text-[13px] text-[#8e8e93]">Название</label>
            <div className="flex gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!amAdmin || saving}
                maxLength={80}
                className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[15px] text-white outline-none disabled:opacity-60"
              />
              {amAdmin ? (
                <button
                  type="button"
                  disabled={saving || !title.trim()}
                  className="pressable shrink-0 rounded-2xl bg-white px-4 text-[14px] font-semibold text-black disabled:opacity-40"
                  onClick={() => void saveTitle()}
                >
                  OK
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between px-4">
            <h2 className="text-[15px] font-semibold text-white">Участники</h2>
            {amAdmin ? (
              <button
                type="button"
                className="pressable text-[14px] font-medium text-white"
                onClick={() => setInviteOpen((v) => !v)}
              >
                {inviteOpen ? 'Готово' : 'Пригласить'}
              </button>
            ) : null}
          </div>

          {inviteOpen ? (
            <div className="mt-2 px-4">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск людей"
                className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[15px] text-white placeholder:text-[#8e8e93]/50 outline-none"
              />
              <div className="mt-1">
                {hits.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="flex w-full items-center gap-3 py-3 text-left active:bg-white/[0.03]"
                    onClick={() => void invite(u.id)}
                  >
                    <Avatar name={u.display_name || u.username} id={u.id} src={u.avatar_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-white">
                        {u.display_name || u.username}
                      </p>
                      <p className="text-[13px] text-[#8e8e93]">@{u.username}</p>
                    </div>
                    <span className="text-[13px] font-semibold text-white">+</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <ul className="mt-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar
                  name={m.display_name || m.username}
                  id={m.id}
                  src={m.avatar_url || undefined}
                  size={44}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-white">
                    {m.display_name || m.username}
                    {m.id === uid ? ' · вы' : ''}
                  </p>
                  <p className="text-[13px] text-[#8e8e93]">
                    {m.role === 'admin' ? 'Админ' : `@${m.username}`}
                  </p>
                </div>
                {(m.id === uid || (amAdmin && m.role !== 'admin')) && (
                  <button
                    type="button"
                    className="pressable text-[13px] font-medium text-[#ff453a]"
                    onClick={() => void kickOrLeave(m.id)}
                  >
                    {m.id === uid ? 'Выйти' : 'Удалить'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
