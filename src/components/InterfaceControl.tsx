import { useEffect, useState, type ReactNode } from 'react'
import { GestureInstruction, GestureSettingsBlock } from '../gestures'
import { apiFetch, isApiMode } from '../lib/api'
import { loadVoicePrefs, saveVoicePrefs, type VoicePrefs, type VoicePresetName } from '../lib/voice/prefs'

type Status = { ready: boolean; hint: string; provider: string; storage: string }

const COMMANDS: { title: string; phrases: string; what: string; limit: string }[] = [
  {
    title: 'Лента',
    phrases: 'лента, домой, главная',
    what: 'Открывает вкладку «Лента» на главном экране.',
    limit: 'Не публикует пост и не обновляет ленту с сервера.',
  },
  {
    title: 'Бизнес',
    phrases: 'бизнес, маркет',
    what: 'Открывает вкладку «Бизнес» на том же экране: витрину товаров.',
    limit: 'Не создаёт товар и не запускает оплату. «Купить» открывает чат с продавцом.',
  },
  {
    title: 'Сообщения',
    phrases: 'сообщения, чаты',
    what: 'Открывает список диалогов.',
    limit: 'Конкретный чат открывает отдельная фраза с именем.',
  },
  {
    title: 'Уведомления',
    phrases: 'уведомления, действия',
    what: 'Открывает экран «Действия». Отдельной вкладки уведомлений нет.',
    limit: 'Не включает push.',
  },
  {
    title: 'Профиль',
    phrases: 'профиль, мой профиль',
    what: 'Открывает ваш профиль.',
    limit: 'Чужой профиль этой фразой не открывается.',
  },
  {
    title: 'Настройки',
    phrases: 'настройки',
    what: 'Открывает список настроек.',
    limit: 'Сама фраза не меняет переключатели.',
  },
  {
    title: 'Поиск и видео',
    phrases: 'поиск, видео',
    what: 'Открывает поиск людей или ленту роликов.',
    limit: 'Музыка отвечает, что воспроизведения ещё нет.',
  },
  {
    title: 'Назад и стоп',
    phrases: 'назад, стоп',
    what: '«Назад» возвращает на предыдущий экран. «Стоп» обрывает озвучку и ничего не отправляет.',
    limit: '«Стоп» не выключает голосовой режим.',
  },
  {
    title: 'Помощь и где я',
    phrases: 'помощь, где я',
    what: '«Помощь» называет короткие команды этого экрана. «Где я» называет экран.',
    limit: 'Длинный разговор командой не становится.',
  },
  {
    title: 'Дальше и лайк',
    phrases: 'дальше, предыдущий, лайк, прочитай пост',
    what: 'Листает ленту, ставит отметку «Нравится» на пост в фокусе и читает его вслух.',
    limit: 'Повторный «лайк» отметку не снимает. В бизнес-ленте листание поста не выполняется.',
  },
  {
    title: 'Чат',
    phrases: 'открой чат с …, прочитай последнее, прочитай новые',
    what: 'Открывает диалог по имени или логину и читает сообщение в открытом чате.',
    limit: 'Два похожих имени не выбираются наугад: приложение называет оба. Сообщение само не отправляется.',
  },
  {
    title: 'Выключить голос',
    phrases: 'выключи голос',
    what: 'Спрашивает подтверждение и после «да» выключает этот переключатель.',
    limit: 'Одного слова в чужой фразе недостаточно. Нужно сказать ровно «выключи голос», затем «да».',
  },
]

const PRESETS: { id: VoicePresetName; label: string }[] = [
  { id: 'reading', label: 'Чтение' },
  { id: 'chat', label: 'Переписка' },
  { id: 'publish', label: 'Публикации' },
]

export function InterfaceControl({ onBack }: { onBack: () => void }) {
  const [prefs, setPrefs] = useState<VoicePrefs>(() => loadVoicePrefs())
  const [page, setPage] = useState<'main' | 'help' | 'gesture-help'>('main')
  const [gestureAnchor, setGestureAnchor] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    if (!isApiMode()) return
    let cancelled = false
    void apiFetch<Status>('/v1/voice/status')
      .then((data) => {
        if (!cancelled) setStatus(data)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const patch = (part: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...part }
    setPrefs(next)
    saveVoicePrefs(next)
  }

  if (page === 'gesture-help') {
    return (
      <Screen title="Инструкция" onBack={() => setPage('main')}>
        <GestureInstruction anchor={gestureAnchor} />
      </Screen>
    )
  }

  if (page === 'help') {
    return (
      <Screen title="Инструкция" onBack={() => setPage('main')}>
        <p className="px-1 pb-4 text-[14px] leading-relaxed text-[#8e8e93]">
          Голос слушает только пока включено «Управление голосом» и вы внутри приложения. Кодового
          слова нет. Фраза выполняется, только если она целиком совпадает с короткой командой.
          Голос и жесты добавляются к обычным нажатиям: кнопки и навигация остаются нажимаемыми.
        </p>
        <Block
          title="Управление голосом"
          body="Главный переключатель. По умолчанию выключен. Когда он включён, над панелью появляется индикатор «Слушаю». Индикатор не перехватывает нажатия. На компьютере в Chrome речь разбирает браузер и запись команды никуда не кладётся. На iPhone браузер сам речь не разбирает: короткая запись уходит на сервер, хранится в объектном хранилище в России не дольше суток и в переписку не попадает. Если ключи сервера не заданы, индикатор прямо пишет, чего не хватает."
        />
        <Block
          title="Управление жестами"
          body="Отдельный переключатель. Камера включается только после «Разрешить камеру». Кадры считаются на этом устройстве и никуда не отправляются. Рамка жеста и индикатор не закрывают кнопки. По умолчанию выключено."
        />
        <GestureInstruction />
        <Block
          title="Скорость речи"
          body="Число от 0,7 до 1,4. По умолчанию 1,0. Влияет только на ответы приложения, не на вашу речь и не на чужие голосовые сообщения."
        />
        <Block
          title="Вид индикатора"
          body="«Обычный» показывает подпись. «Компактный» оставляет белую точку. Скрыть индикатор полностью нельзя. По умолчанию обычный."
        />
        <Block
          title="Случайные фразы"
          body="Это не переключатель. «Сообщения» откроет список диалогов. Фраза «давай потом в сообщения» ничего не откроет. «Уведомления» открывает экран «Действия»."
        />
        {COMMANDS.map((item) => (
          <Block
            key={item.title}
            title={item.title}
            body={`${item.what} Фразы: ${item.phrases}. ${item.limit}`}
          />
        ))}
      </Screen>
    )
  }

  return (
    <Screen title="Управление интерфейсом" onBack={onBack}>
      <p className="px-1 pb-3 text-[13px] leading-snug text-[#8e8e93]">
        Голос и жесты включаются отдельно и не отключают обычные нажатия. По умолчанию оба выключены.
      </p>
      <div className="settings-list-card mb-4 px-4">
        <Toggle
          label="Управление голосом"
          checked={prefs.voiceEnabled}
          onChange={(voiceEnabled) => patch({ voiceEnabled })}
        />
      </div>
      <GestureSettingsBlock
        onOpenHelp={(id) => {
          setGestureAnchor(id)
          setPage('gesture-help')
        }}
      />
      <div className="settings-list-card mb-4 px-4 py-3">
        <p className="text-[15px] text-white">Набор команд</p>
        <div className="mt-2 flex gap-2">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => patch({ preset: item.id })}
              className={`h-10 flex-1 rounded-xl text-[13px] font-semibold ${
                prefs.preset === item.id ? 'bg-white text-black' : 'bg-[#1c1c1e] text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-[15px] text-white" htmlFor="voice-silence">
          Пауза тишины: {prefs.silenceSeconds} с
        </label>
        <input
          id="voice-silence"
          type="range"
          min={1}
          max={8}
          step={1}
          value={prefs.silenceSeconds}
          onChange={(event) => patch({ silenceSeconds: Number(event.target.value) })}
          className="mt-3 w-full"
        />
        <label className="mt-4 block text-[15px] text-white" htmlFor="voice-rate">
          Скорость речи: {prefs.rate.toFixed(1).replace('.', ',')}
        </label>
        <input
          id="voice-rate"
          type="range"
          min={0.7}
          max={1.4}
          step={0.1}
          value={prefs.rate}
          onChange={(event) => {
            const rate = Number(event.target.value)
            patch({ rate, speechRate: rate })
          }}
          className="mt-3 w-full"
        />
        <div className="mt-2">
          <Toggle
            label="Голосовые ответы"
            checked={prefs.voiceReplies}
            onChange={(voiceReplies) => patch({ voiceReplies })}
          />
        </div>
        <p className="mt-4 text-[15px] text-white">Вид индикатора</p>
        <div className="mt-2 flex gap-2">
          {(['full', 'compact'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => patch({ indicator: kind })}
              className={`h-10 flex-1 rounded-xl text-[14px] font-semibold ${
                prefs.indicator === kind ? 'bg-white text-black' : 'bg-[#1c1c1e] text-white'
              }`}
            >
              {kind === 'full' ? 'Обычный' : 'Компактный'}
            </button>
          ))}
        </div>
      </div>
      {status && !status.ready ? (
        <p className="mb-4 px-1 text-[13px] leading-snug text-[#ff9f0a]">{status.hint}</p>
      ) : null}
      {!isApiMode() ? (
        <p className="mb-4 px-1 text-[13px] leading-snug text-[#8e8e93]">
          В этом браузере команды может разобрать сам Chrome. iPhone отправит запись на сервер,
          когда приложение подключено к API и заданы ключи SpeechKit и Selectel.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setPage('help')}
        className="settings-list-card flex w-full items-center justify-between px-4 py-[14px] text-left text-[16px] text-white"
      >
        Инструкция
        <span className="text-[#777]">›</span>
      </button>
    </Screen>
  )
}

function Screen({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-black">
      <header className="hub-screen-header relative flex shrink-0 items-center justify-center px-3 pb-2">
        <button type="button" onClick={onBack} className="hub-circle-btn absolute left-3" aria-label="Назад">
          <span className="text-[20px] text-white">‹</span>
        </button>
        <h1 className="text-[17px] font-bold text-hub-text">{title}</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-3 scroll-pad-safe pb-8">{children}</div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex w-full items-center justify-between gap-3 py-[14px]">
      <span className="text-[16px] text-white">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`hub-toggle ${checked ? 'is-on' : ''}`}
      >
        <span className="hub-toggle-knob" />
      </button>
    </div>
  )
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <section className="mb-4">
      <h2 className="text-[16px] font-semibold text-white">{title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-[#c7c7cc]">{body}</p>
    </section>
  )
}
