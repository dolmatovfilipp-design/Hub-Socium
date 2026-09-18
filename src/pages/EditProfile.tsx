import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar } from '../components/Avatar'
import { apiMe, apiUploadMedia, isApiMode } from '../lib/api'

const LOCAL_DATA_URL_MAX = 100 * 1024

export function EditProfile() {
  const navigate = useNavigate()
  const currentUserId = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  const user = currentUserId ? users.find((u) => u.id === currentUserId) : undefined
  const upsertCurrentUser = useStore((s) => s.upsertCurrentUser)
  const updateProfile = useStore((s) => s.updateProfile)
  const showToast = useStore((s) => s.showToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [avatar, setAvatar] = useState(user?.avatar)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (user || !isApiMode()) return
    void apiMe()
      .then((me) => {
        upsertCurrentUser(me)
        setName(me.display_name || me.username)
        setUsername(me.username)
        setBio(me.bio ?? '')
        setAvatar(me.avatar_url || undefined)
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Профиль недоступен'))
  }, [user, upsertCurrentUser, showToast])

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-sm text-[#777]">
        Загрузка профиля…
      </div>
    )
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Нужен файл изображения (jpeg/png/webp/gif)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Максимум 2 МБ')
      return
    }

    if (isApiMode()) {
      setUploading(true)
      void apiUploadMedia(file)
        .then((media) => {
          setAvatar(media.url)
          showToast('Фото загружено')
        })
        .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка загрузки'))
        .finally(() => setUploading(false))
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      if (dataUrl.length > LOCAL_DATA_URL_MAX) {
        showToast('Фото слишком большое для локального режима (~100 КБ)')
        return
      }
      setAvatar(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const res = await updateProfile({
      name: name.trim(),
      username: username.trim(),
      bio: bio.trim(),
      avatar,
    })
    setSaving(false)
    if (!res.ok) {
      showToast(res.error ?? 'Ошибка сохранения')
      return
    }
    showToast('Профиль сохранён')
    navigate('/app/profile')
  }

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top glass-strong flex shrink-0 items-center gap-2 border-b border-white/5 px-2 pb-3 pt-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-11 w-11 items-center justify-center rounded-full text-hub-muted"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold text-hub-text">Редактировать</h1>
      </header>
      <form
        onSubmit={save}
        className="no-scrollbar flex-1 overflow-y-auto px-4 py-6 scroll-pad-safe"
      >
        <div className="flex flex-col items-center gap-3">
          <Avatar name={name || user.name} id={user.id} src={avatar} size={88} />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-hub-silver disabled:opacity-60"
            >
              {uploading ? 'Загрузка…' : 'Изменить фото'}
            </button>
            {avatar && (
              <button
                type="button"
                onClick={() => setAvatar(undefined)}
                className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-2 text-sm text-hub-muted"
              >
                <Trash2 className="h-3.5 w-3.5" /> Удалить
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>

        <div className="mt-8 space-y-4">
          <Field label="Имя" value={name} onChange={setName} />
          <Field label="Имя пользователя" value={username} onChange={setUsername} />
          <div>
            <label className="mb-1.5 block text-sm text-hub-muted">О себе</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[16px] text-hub-text"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || uploading}
          className="mt-8 flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#4a4a54] to-[#2c2c32] text-base font-semibold text-hub-text border border-white/10 disabled:opacity-60"
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-hub-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-hub-text"
      />
    </div>
  )
}
