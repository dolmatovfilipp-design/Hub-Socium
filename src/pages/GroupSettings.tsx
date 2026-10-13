import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { IconChevron } from '../components/Icons'
import { useNavMotion } from '../components/NavMotion'
import { useStore } from '../store/useStore'
import {
  apiCreateGroupInviteLink,
  apiInviteGroupMembers,
  apiKickGroupMember,
  apiListGroupInviteLinks,
  apiListGroupMembers,
  apiPatchGroup,
  apiRevokeGroupInviteLink,
  apiSearchUsers,
  apiSetGroupMemberRole,
  apiUploadMedia,
  isApiMode,
  type ApiPeerUser,
  type ApiSearchUser,
  type GroupInviteLink,
  type GroupPermissions,
} from '../lib/api'
import { ruParticipants } from '../utils/ru'

type Member = ApiPeerUser & { role?: string; online?: boolean }

const PERM_ROWS: { key: keyof GroupPermissions; label: string }[] = [
  { key: 'send', label: 'Писать' },
  { key: 'add', label: 'Приглашать' },
  { key: 'info', label: 'Описание' },
  { key: 'pin', label: 'Закреплять' },
]

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
  const [maxMembers, setMaxMembers] = useState(256)
  const [myRole, setMyRole] = useState('member')
  const [canInvite, setCanInvite] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [perms, setPerms] = useState<GroupPermissions>({ send: 'all', add: 'all', info: 'admins', pin: 'all' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState<ApiSearchUser[]>([])
  const [links, setLinks] = useState<GroupInviteLink[]>([])

  const load = useCallback(async () => {
    if (!isApiMode() || !id) return
    setLoading(true)
    try {
      const res = await apiListGroupMembers(id)
      setTitle(res.title || '')
      setAvatarUrl(res.avatar_url || '')
      setMembers(res.items ?? [])
      setMaxMembers(res.max_members || 256)
      setMyRole(res.my_role || (res.am_admin ? 'admin' : 'member'))
      setCanInvite(res.can_invite ?? !!res.am_admin)
      setCanEdit(res.can_edit_info ?? !!res.am_admin)
      if (res.permissions) setPerms(res.permissions)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [id, showToast])

  const loadLinks = useCallback(async () => {
    if (!isApiMode() || !id) return
    try {
      const r = await apiListGroupInviteLinks(id)
      setLinks(r.items ?? [])
    } catch {
      setLinks([])
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (inviteOpen) void loadLinks()
  }, [inviteOpen, loadLinks])

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
        if (!cancelled) setHits((r.items ?? []).filter((u) => u.id !== uid && !memberIds.has(u.id)))
      })
      .catch(() => {
        if (!cancelled) setHits([])
      })
    return () => {
      cancelled = true
    }
  }, [debounced, inviteOpen, members, uid])

  const saveTitle = async () => {
    if (!id || !canEdit || saving) return
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
      setEditing(false)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const changeAvatar = async (file: File) => {
    if (!id || !canEdit) return
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

  const leave = async () => {
    if (!id || !uid) return
    const ok = window.confirm('Выйти из группы?')
    if (!ok) return
    try {
      await apiKickGroupMember(id, uid)
      showToast('Вы вышли из группы')
      navigate('/app/messages', { replace: true })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось выйти')
    }
  }

  const kick = async (userId: string) => {
    if (!id) return
    if (!window.confirm('Удалить участника?')) return
    try {
      await apiKickGroupMember(id, userId)
      showToast('Участник удалён')
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  const setRole = async (userId: string, role: 'admin' | 'member') => {
    if (!id) return
    try {
      await apiSetGroupMemberRole(id, userId, role)
      showToast(role === 'admin' ? 'Назначен админ' : 'Роль снята')
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  const makeLink = async () => {
    if (!id) return
    try {
      const link = await apiCreateGroupInviteLink(id, {})
      setLinks((prev) => [link, ...prev])
      const url = `${window.location.origin}${link.path}`
      try {
        await navigator.clipboard.writeText(url)
        showToast('Ссылка скопирована')
      } catch {
        showToast('Ссылка создана')
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось создать ссылку')
    }
  }

  const revoke = async (token: string) => {
    if (!id) return
    try {
      await apiRevokeGroupInviteLink(id, token)
      setLinks((prev) => prev.filter((l) => l.token !== token))
      showToast('Ссылка отозвана')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось отозвать')
    }
  }

  const setPerm = async (key: keyof GroupPermissions, value: 'all' | 'admins') => {
    if (!id || myRole !== 'owner') return
    const next = { ...perms, [key]: value }
    setPerms(next)
    try {
      await apiPatchGroup(id, {
        perm_send: next.send,
        perm_add: next.add,
        perm_info: next.info,
        perm_pin: next.pin,
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось сохранить права')
      void load()
    }
  }

  if (!isApiMode()) {
    const conv = useStore.getState().conversations.find((c) => c.id === id && c.isGroup)
    const people = useStore.getState().users.filter((u) => conv?.participantIds.includes(u.id))
    if (!conv) {
      return (
        <div className={`flex h-full items-center justify-center bg-black text-[#8e8e93] ${motionClass}`}>
          Группа не найдена
        </div>
      )
    }
    return (
      <div className={`flex h-full flex-col bg-black ${motionClass}`}>
        <header className="safe-top flex shrink-0 items-center gap-2 bg-black px-3 pb-2 pt-1">
          <button type="button" className="hub-circle-btn" aria-label="Назад" onClick={() => dismiss(id ? `/app/messages/${id}` : -1)}>
            <IconChevron size={20} className="-scale-x-100" />
          </button>
          <h1 className="flex-1 text-center text-[16px] font-semibold text-white">О группе</h1>
          <span className="h-10 w-10" aria-hidden />
        </header>
        <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col items-center px-4 pt-8">
            <Avatar name={conv.title || 'Группа'} id={conv.id} size={96} />
            <p className="mt-4 text-[22px] font-semibold text-white">{conv.title || 'Группа'}</p>
            <p className="mt-1 text-[14px] text-[#8e8e93]">{ruParticipants(people.length)} · максимум 256</p>
          </div>
          <div className="mt-8 flex items-center justify-between px-4">
            <h2 className="text-[15px] font-semibold text-white">Участники · {people.length}</h2>
            <button type="button" className="pressable text-[15px] font-medium text-[#0a84ff]" onClick={() => showToast('Приглашение — при подключении к серверу')}>
              Пригласить
            </button>
          </div>
          <ul className="mt-2">
            {[...people].sort((a, b) => (a.id === uid ? 1 : 0) - (b.id === uid ? 1 : 0)).map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={m.name} id={m.id} src={m.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-white">
                    {m.name}
                    {m.id === uid ? ' · Вы' : ''}
                  </p>
                  <p className={`text-[13px] ${m.id === uid ? 'text-[#30d158]' : 'text-[#8e8e93]'}`}>
                    {m.id === uid ? 'в сети' : `@${m.username}`}
                  </p>
                </div>
                {m.id !== uid ? <span className="shrink-0 text-[14px] font-medium text-[#ffd60a]">Владелец</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-auto px-4 pb-8 pt-8">
            <button
              type="button"
              className="pressable h-12 w-full rounded-2xl bg-[#3a1216] text-[16px] font-semibold text-[#ff453a]"
              onClick={() => showToast('Выход из группы — при подключении к серверу')}
            >
              Выйти из группы
            </button>
          </div>
        </div>
      </div>
    )
  }

  const count = members.length

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top flex shrink-0 items-center gap-2 bg-black px-3 pb-2 pt-1">
        <button
          type="button"
          className="hub-circle-btn"
          aria-label="Назад"
          onClick={() => dismiss(id ? `/app/messages/${id}` : -1)}
        >
          <IconChevron size={20} className="-scale-x-100" />
        </button>
        <h1 className="flex-1 text-center text-[16px] font-semibold text-white">О группе</h1>
        <span className="h-10 w-10" aria-hidden />
      </header>

      {loading ? (
        <p className="px-4 py-12 text-center text-[#8e8e93]">Загрузка…</p>
      ) : (
        <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col items-center px-4 pt-8">
            <button
              type="button"
              disabled={!canEdit || saving}
              className="relative disabled:opacity-100"
              onClick={() => canEdit && fileRef.current?.click()}
            >
              <Avatar name={title || 'Группа'} id={id || 'g'} src={avatarUrl || undefined} size={96} />
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
            {editing ? (
              <div className="mt-4 flex w-full max-w-xs gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[15px] text-white outline-none"
                />
                <button
                  type="button"
                  disabled={saving || !title.trim()}
                  className="pressable shrink-0 rounded-2xl bg-white px-4 text-[14px] font-semibold text-black disabled:opacity-40"
                  onClick={() => void saveTitle()}
                >
                  OK
                </button>
              </div>
            ) : (
              <p className="mt-4 text-[22px] font-semibold text-white">{title || 'Группа'}</p>
            )}
            <p className="mt-1 text-[14px] text-[#8e8e93]">
              {ruParticipants(count)} · максимум {maxMembers}
            </p>
            {canEdit && !editing ? (
              <button type="button" className="mt-2 text-[13px] text-[#8e8e93]" onClick={() => setEditing(true)}>
                Изменить
              </button>
            ) : null}
          </div>

          <div className="mt-8 flex items-center justify-between px-4">
            <h2 className="text-[15px] font-semibold text-white">Участники · {count}</h2>
            {canInvite ? (
              <button
                type="button"
                className="pressable text-[15px] font-medium text-[#0a84ff]"
                onClick={() => setInviteOpen((v) => !v)}
              >
                {inviteOpen ? 'Готово' : 'Пригласить'}
              </button>
            ) : null}
          </div>

          {inviteOpen ? (
            <div className="mt-3 px-4">
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
                      <p className="truncate text-[15px] font-semibold text-white">{u.display_name || u.username}</p>
                      <p className="text-[13px] text-[#8e8e93]">@{u.username}</p>
                    </div>
                    <span className="text-[13px] font-semibold text-[#0a84ff]">Пригласить</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="pressable mt-2 w-full rounded-2xl bg-white/[0.06] px-4 py-3 text-left text-[15px] text-white"
                onClick={() => void makeLink()}
              >
                Создать ссылку-приглашение
              </button>
              {links.map((l) => (
                <div key={l.token} className="mt-2 flex items-center gap-2 rounded-2xl bg-white/[0.04] px-3 py-2">
                  <p className="min-w-0 flex-1 truncate text-[12px] text-[#8e8e93]">{l.path}</p>
                  <button
                    type="button"
                    className="shrink-0 text-[13px] text-[#ff453a]"
                    onClick={() => void revoke(l.token)}
                  >
                    Отозвать
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <ul className="mt-2">
            {members.map((m) => {
              const name = m.display_name || m.username
              const sub = m.online ? 'в сети' : m.id === uid ? 'не в сети' : `@${m.username}`
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={name} id={m.id} src={m.avatar_url || undefined} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold text-white">
                      {name}
                      {m.id === uid ? ' · Вы' : ''}
                    </p>
                    <p className={`text-[13px] ${m.online ? 'text-[#30d158]' : 'text-[#8e8e93]'}`}>{sub}</p>
                    {myRole === 'owner' && m.id !== uid && m.role !== 'owner' ? (
                      <button
                        type="button"
                        className="mt-0.5 text-[12px] text-[#8e8e93]"
                        onClick={() => void setRole(m.id, m.role === 'admin' ? 'member' : 'admin')}
                      >
                        {m.role === 'admin' ? 'Снять админа' : 'Сделать админом'}
                      </button>
                    ) : null}
                  </div>
                  {m.role === 'owner' ? (
                    <span className="shrink-0 text-[14px] font-medium text-[#ffd60a]">Владелец</span>
                  ) : m.role === 'admin' ? (
                    <span className="shrink-0 text-[14px] font-medium text-[#8e8e93]">Админ</span>
                  ) : null}
                  {myRole === 'owner' && m.role !== 'owner' && m.id !== uid ? (
                    <button type="button" className="shrink-0 text-[12px] text-[#ff453a]" onClick={() => void kick(m.id)}>
                      Удалить
                    </button>
                  ) : staffRoleCanKick(myRole, m.role) && m.id !== uid ? (
                    <button type="button" className="shrink-0 text-[12px] text-[#ff453a]" onClick={() => void kick(m.id)}>
                      Удалить
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {myRole === 'owner' ? (
            <div className="mt-6 px-4">
              <h2 className="mb-2 text-[15px] font-semibold text-white">Права</h2>
              {PERM_ROWS.map((row) => (
                <div key={row.key} className="flex items-center justify-between py-2">
                  <span className="text-[15px] text-white">{row.label}</span>
                  <div className="flex overflow-hidden rounded-full bg-white/[0.06] text-[12px]">
                    {(['all', 'admins'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`px-3 py-1.5 ${perms[row.key] === v ? 'bg-white text-black' : 'text-[#8e8e93]'}`}
                        onClick={() => void setPerm(row.key, v)}
                      >
                        {v === 'all' ? 'Все' : 'Админы'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-auto px-4 pb-8 pt-8">
            <button
              type="button"
              className="pressable h-12 w-full rounded-2xl bg-[#3a1216] text-[16px] font-semibold text-[#ff453a]"
              onClick={() => void leave()}
            >
              Выйти из группы
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function staffRoleCanKick(myRole: string, targetRole?: string): boolean {
  return myRole === 'admin' && targetRole !== 'owner' && targetRole !== 'admin'
}
