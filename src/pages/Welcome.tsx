import { Link } from 'react-router-dom'

export function Welcome() {
  return (
    <div className="flex h-full flex-col px-6 safe-top">
      <div className="flex flex-1 flex-col items-center justify-center animate-fade-in">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-b from-[#3a3a44] to-[#16161a] border border-white/10 shadow-2xl">
          <span className="text-3xl font-bold tracking-tight text-hub-silver">H</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-hub-text">Hub</h1>
      </div>
      <div className="safe-bottom space-y-3 pb-8">
        <Link
          to="/login"
          className="flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#4a4a54] to-[#2c2c32] text-base font-semibold text-hub-text border border-white/10 shadow-lg active:scale-[0.98] transition"
        >
          Войти
        </Link>
        <Link
          to="/register"
          className="flex h-14 w-full items-center justify-center rounded-2xl glass text-base font-semibold text-hub-silver active:scale-[0.98] transition"
        >
          Регистрация
        </Link>
      </div>
    </div>
  )
}
