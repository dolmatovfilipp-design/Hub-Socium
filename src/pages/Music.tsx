import { Link } from 'react-router-dom'
import { HubEmptyState } from '../components/HubEmptyState'
import { IconChevron } from '../components/Icons'

/** Music hub — container + soft empty state (feature coming soon). */
export function Music() {
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
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
        <div
          className="mb-6 flex h-20 w-20 items-center justify-center rounded-[28px]"
          style={{
            background:
              'linear-gradient(145deg, rgba(232,220,200,0.18), rgba(180,160,140,0.08))',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          aria-hidden
        >
          <span className="text-[36px]">♪</span>
        </div>
        <HubEmptyState
          title="Скоро здесь будет музыка"
          subtitle="Тихий хаб для треков и плейлистов. Пока можно настроить вкладку в Настройки → Панель навигации."
        />
      </div>
    </div>
  )
}
