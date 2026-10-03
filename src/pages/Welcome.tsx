import { Link } from 'react-router-dom'

export function Welcome() {
  return (
    <div className="flex h-full flex-col px-6 safe-top">
      <div className="flex flex-1 flex-col items-center justify-center animate-fade-in">
        <h1 className="hub-wordmark" aria-label="Get Hub">
          Get Hub
        </h1>
        <p className="mt-4 max-w-[18rem] text-center text-[15px] leading-relaxed text-hub-muted">
          Регистрация только по приглашению. Если аккаунт уже есть — войдите.
        </p>
      </div>
      <div className="safe-bottom space-y-3 pb-8">
        <Link to="/login" className="btn-liquid-glass">
          Войти
        </Link>
        <Link to="/" className="btn-auth-pill">
          Код приглашения
        </Link>
      </div>
    </div>
  )
}
