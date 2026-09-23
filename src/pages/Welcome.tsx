import { Link } from 'react-router-dom'

export function Welcome() {
  return (
    <div className="flex h-full flex-col px-6 safe-top">
      <div className="flex flex-1 flex-col items-center justify-center animate-fade-in">
        <h1 className="hub-wordmark">Hub</h1>
      </div>
      <div className="safe-bottom space-y-3 pb-8">
        <Link to="/login" className="btn-liquid-glass">
          Войти
        </Link>
        <Link to="/register" className="btn-liquid-glass">
          Регистрация
        </Link>
      </div>
    </div>
  )
}
