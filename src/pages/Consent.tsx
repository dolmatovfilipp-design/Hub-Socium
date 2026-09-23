import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'

export function Consent() {
  const navigate = useNavigate()
  const acceptConsent152 = useStore((s) => s.acceptConsent152)
  const showToast = useStore((s) => s.showToast)
  const [privacyOk, setPrivacyOk] = useState(false)
  const [termsOk, setTermsOk] = useState(false)
  const [busy, setBusy] = useState(false)

  const canContinue = privacyOk && termsOk && !busy

  const onContinue = async () => {
    if (!canContinue) return
    setBusy(true)
    try {
      const res = await acceptConsent152()
      if (!res.ok) {
        showToast(res.error ?? 'Не удалось сохранить согласие')
        return
      }
      navigate('/app', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top relative flex shrink-0 items-center justify-center bg-black px-2 pb-3 pt-2">
        <h1 className="text-[17px] font-bold text-white">Ваши данные</h1>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8">
        <p className="pt-2 text-[15px] leading-relaxed text-[#8e8e93]">
          Hub обрабатывает персональные данные (профиль, публикации, технические данные сессии)
          для работы сервиса, безопасности и связи с вами — в соответствии с 152-ФЗ.
        </p>

        <div className="mt-6 space-y-1">
          <label className="flex cursor-pointer items-start gap-3 py-[14px] active:bg-white/[0.03]">
            <input
              type="checkbox"
              checked={privacyOk}
              onChange={(e) => setPrivacyOk(e.target.checked)}
              className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-[6px] border border-white/25 bg-[#1c1c1e] accent-white"
            />
            <span className="text-[16px] leading-snug text-white">
              Принимаю{' '}
              <Link
                to="/legal/privacy"
                className="underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                политику конфиденциальности
              </Link>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 py-[14px] active:bg-white/[0.03]">
            <input
              type="checkbox"
              checked={termsOk}
              onChange={(e) => setTermsOk(e.target.checked)}
              className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-[6px] border border-white/25 bg-[#1c1c1e] accent-white"
            />
            <span className="text-[16px] leading-snug text-white">
              Принимаю{' '}
              <Link
                to="/legal/terms"
                className="underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                пользовательское соглашение
              </Link>
            </span>
          </label>
        </div>

        <button
          type="button"
          disabled={!canContinue}
          onClick={() => void onContinue()}
          className="mt-8 flex h-12 w-full items-center justify-center rounded-xl bg-white text-[16px] font-semibold text-black disabled:opacity-35"
        >
          {busy ? 'Сохранение…' : 'Продолжить'}
        </button>
      </div>
    </div>
  )
}
