import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initSentry, Sentry } from './lib/sentry'
import { initAnalytics } from './lib/analytics'

initSentry()
initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div className="flex h-full items-center justify-center bg-black px-6 text-center text-sm text-[#8e8e93]">
          Что-то пошло не так. Обновите страницу.
        </div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
