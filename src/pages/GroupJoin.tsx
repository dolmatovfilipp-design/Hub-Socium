import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { useNavMotion } from '../components/NavMotion'
import { apiJoinGroupInviteLink, apiPreviewGroupInviteLink, isApiMode } from '../lib/api'
import { useStore } from '../store/useStore'
import { ruParticipants } from '../utils/ru'

export function GroupJoin() {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { motionClass, dismiss } = useNavMotion('push')
  const showToast = useStore((s) => s.showToast)
  const [title, setTitle] = useState('Группа')
  const [avatar, setAvatar] = useState('')
  const [convId, setConvId] = useState('')
  const [members, setMembers] = useState(0)
  const [already, setAlready] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isApiMode() || !token) {
      setLoading(false)
      setError('Ссылка доступна в API-режиме')
      return
    }
    let cancelled = false
    void apiPreviewGroupInviteLink(token)
      .then((r) => {
        if (cancelled) return
        setTitle(r.title || 'Группа')
        setAvatar(r.avatar_url || '')
        setConvId(r.conversation_id)
        setMembers(r.member_count || 0)
        setAlready(!!r.already_member)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ссылка недействительна')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const join = async () => {
    if (!token || busy) return
    if (already && convId) {
      navigate(`/app/messages/${convId}`, { replace: true })
      return
    }
    setBusy(true)
    try {
      const r = await apiJoinGroupInviteLink(token)
      showToast(r.already ? 'Вы уже в группе' : 'Вы в группе')
      navigate(`/app/messages/${r.conversation_id}`, { replace: true })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось вступить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex h-full flex-col bg-black ${motionClass}`}>
      <header className="safe-top flex shrink-0 items-center gap-2 px-3 pb-2 pt-1">
        <button type="button" className="hub-circle-btn" aria-label="Назад" onClick={() => dismiss('/app/messages')}>
          ←
        </button>
        <h1 className="flex-1 text-center text-[16px] font-semibold text-white">Приглашение</h1>
        <span className="h-10 w-10" />
      </header>
      <div className="flex flex-1 flex-col items-center px-6 pt-16 text-center">
        {loading ? <p className="text-[#8e8e93]">Загрузка…</p> : null}
        {!loading && error ? <p className="text-[#8e8e93]">{error}</p> : null}
        {!loading && !error ? (
          <>
            <Avatar name={title} id={convId || token} src={avatar || undefined} size={96} />
            <p className="mt-4 text-[22px] font-semibold text-white">{title}</p>
            <p className="mt-1 text-[14px] text-[#8e8e93]">
              {ruParticipants(members)} · максимум 256
            </p>
            <button
              type="button"
              disabled={busy}
              className="pressable mt-8 h-12 w-full max-w-xs rounded-2xl bg-white text-[16px] font-semibold text-black disabled:opacity-50"
              onClick={() => void join()}
            >
              {already ? 'Открыть чат' : 'Вступить'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
