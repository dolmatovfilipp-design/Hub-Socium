export const ONBOARDING_STORAGE_KEY = 'hub_onboarding_seen_v1'

export type OnboardingSlide = {
  id: string
  title: string
  body: string
  /** CSS gradient for animated card background */
  vibe: string
  emoji: string
  hint?: string
}

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    id: 'highlights',
    title: 'Это Hub',
    body: 'Лента, сообщения, поиск и профиль — в одном спокойном месте. Без шума, с контролем над тем, что вы видите.',
    vibe: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 45%, #0f3460 100%)',
    emoji: '✦',
  },
  {
    id: 'howto',
    title: 'Как пользоваться',
    body: 'Пишите посты прямо из ленты. Отвечайте текстом или голосом. Свайпайте между вкладками панели — как между экранами телефона.',
    vibe: 'linear-gradient(160deg, #2d1b4e 0%, #1a1a2e 50%, #0d7377 100%)',
    emoji: '◎',
    hint: 'Голосовой ответ — в обсуждении поста',
  },
  {
    id: 'nav-tabs',
    title: 'Свои вкладки',
    body: 'В Настройки → Панель навигации можно добавить Поиск, Видео и Музыку — или убрать лишнее. Панель собирается под вас.',
    vibe: 'linear-gradient(150deg, #3d2c1e 0%, #1f1a14 40%, #2c1810 100%)',
    emoji: '☰',
    hint: 'Настройки → Панель навигации',
  },
  {
    id: 'collapse',
    title: 'Двойной тап',
    body: 'Дважды нажмите на Главную (Лента) — панель свернётся влево до одной иконки. Ещё раз — развернётся обратно.',
    vibe: 'linear-gradient(155deg, #1e3a2f 0%, #0f1f1a 55%, #152238 100%)',
    emoji: '⇢',
    hint: 'Двойной тап по иконке Ленты',
  },
  {
    id: 'frame',
    title: 'Только иконки',
    body: 'В той же панели есть переключатель «Рамка и индикатор». Выключите — останутся только иконки без оболочки и ползунка.',
    vibe: 'linear-gradient(145deg, #2a2a2a 0%, #141414 50%, #1c1c1c 100%)',
    emoji: '◻',
  },
  {
    id: 'market',
    title: 'Маркет рядом',
    body: 'На ленте свайпните по слову «Лента» вправо — откроется Маркет. Свайп влево вернёт ленту. Объявления без оплаты внутри Hub.',
    vibe: 'linear-gradient(160deg, #3d1f2a 0%, #1a1218 45%, #2a1f3d 100%)',
    emoji: '◇',
    hint: 'Свайп по названию Лента ↔ Маркет',
  },
]

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function clearOnboardingSeen(): void {
  try {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
