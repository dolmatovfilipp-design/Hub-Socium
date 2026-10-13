import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

void import('./lib/sentry').then((mod) => {
  mod.initSentry()
})
void import('./lib/analytics').then((mod) => {
  mod.initAnalytics()
})

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err: unknown) {
    void import('./lib/sentry').then((mod) => mod.reportError(err))
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full items-center justify-center bg-black px-6 text-center text-sm text-[#8e8e93]">
          Что-то пошло не так. Обновите страницу.
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
