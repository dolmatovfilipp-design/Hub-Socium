import { Link, useNavigate } from 'react-router-dom'
import { IconChevron } from '../components/Icons'

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  return (
    <div className="flex h-full flex-col bg-black">
      <header className="safe-top relative flex shrink-0 items-center justify-center bg-black px-2 pb-3 pt-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute left-2 flex h-11 w-11 items-center justify-center text-white"
          aria-label="Назад"
        >
          <IconChevron size={22} className="-scale-x-100" />
        </button>
        <h1 className="text-[17px] font-bold text-white">{title}</h1>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-10">
        <p className="mb-4 rounded-xl bg-[#1c1c1e] px-3 py-2 text-[13px] leading-snug text-[#ff9f0a]">
          Черновик для юриста — не финальный юридический текст. Будет заменён до публичного
          запуска.
        </p>
        <div className="space-y-4 text-[15px] leading-relaxed text-[#8e8e93]">{children}</div>
      </div>
    </div>
  )
}

export function LegalPrivacy() {
  return (
    <LegalShell title="Политика конфиденциальности">
      <p>
        Оператор Hub обрабатывает персональные данные пользователей в объёме, необходимом для
        работы сервиса, в соответствии с Федеральным законом № 152-ФЗ «О персональных данных».
      </p>
      <p>
        Категории данных: идентификаторы аккаунта, профиль, публикации, технические логи и данные
        сессии. Цели: предоставление функций Hub, безопасность, поддержка пользователей.
      </p>
      <p>
        Срок хранения — пока аккаунт активен и в течение разумного периода после удаления, если
        иное не требуется законом. Права субъекта: доступ, уточнение, удаление, отзыв согласия —
        через настройки или обращение в поддержку.
      </p>
      <p>
        Контакт: <span className="text-white">privacy@hub.local</span>. Также см.{' '}
        <Link to="/legal/terms" className="text-white underline underline-offset-2">
          Пользовательское соглашение
        </Link>
        .
      </p>
    </LegalShell>
  )
}

export function LegalTerms() {
  return (
    <LegalShell title="Пользовательское соглашение">
      <p>
        Используя Hub, вы соглашаетесь соблюдать правила сообщества и не размещать незаконный,
        оскорбительный или вредоносный контент.
      </p>
      <p>
        На этапе закрытого бета-тестирования сервис предоставляется «как есть»; функции могут
        меняться без предварительного уведомления.
      </p>
      <p>
        Жалобы на контент и блокировки пользователей доступны в приложении. Злоупотребления могут
        привести к ограничению доступа.
      </p>
      <p>
        Также см.{' '}
        <Link to="/legal/privacy" className="text-white underline underline-offset-2">
          Политику конфиденциальности
        </Link>
        .
      </p>
    </LegalShell>
  )
}
