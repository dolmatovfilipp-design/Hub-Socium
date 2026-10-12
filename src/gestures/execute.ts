import { getVisibleNavItemIds, loadNavPrefs, NAV_CATALOG, type NavItemId } from '../lib/navPrefs'
import {
  ensureGestureFocus,
  isChatThread,
  moveGestureFocus,
  scrollActiveList,
  scrollChat,
  shellSwipeDisabled,
} from './focus'
import { silenceGestureSpeech, speakGesture } from './speech'
import type { GestureCommand } from './types'

type Navigate = (to: string | number) => void

let pathname = '/app'
let navigate: Navigate = () => {}

export function bindGestureRouter(nextPath: string, nextNavigate: Navigate): void {
  pathname = nextPath
  navigate = nextNavigate
}

const DANGER =
  /опубликовать|отправить|удалить|выйти|демо-оплата/i

function isDanger(el: Element): boolean {
  if (el.closest('[data-gesture-danger]')) return true
  const label = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.trim()
  return DANGER.test(label)
}

function navIndex(pathname: string, ids: NavItemId[]): number {
  return ids.findIndex((id) => {
    if (id === 'home') return pathname === '/app'
    if (id === 'messages') return pathname === '/app/messages' || pathname.startsWith('/app/messages/')
    if (id === 'activity') return pathname.startsWith('/app/activity')
    if (id === 'profile') return pathname === '/app/profile' || pathname.startsWith('/app/profile/') || pathname.startsWith('/app/u/')
    if (id === 'search') return pathname.startsWith('/app/explore')
    if (id === 'video') return pathname.startsWith('/app/clips')
    if (id === 'music') return pathname.startsWith('/app/music')
    return false
  })
}

function switchTab(direction: 1 | -1): void {
  const prefs = loadNavPrefs()
  if (prefs.collapsed) {
    speakGesture('Панель свёрнута')
    return
  }
  if (shellSwipeDisabled(pathname)) return
  const ids = getVisibleNavItemIds(prefs)
  const index = navIndex(pathname, ids)
  if (index < 0) return
  const next = ids[index + direction]
  if (next) navigate(NAV_CATALOG[next].to)
}

function pauseMedia(): void {
  for (const media of document.querySelectorAll('video, audio')) {
    if (!(media instanceof HTMLMediaElement)) continue
    if (media.hasAttribute('data-gesture-camera')) continue
    if (!media.paused) media.pause()
  }
}

function like(direction: 'like' | 'unlike'): void {
  const item = ensureGestureFocus(pathname)
  const button = item?.querySelector('[data-gesture-like]')
  if (!(button instanceof HTMLElement)) return
  const liked = button.getAttribute('data-liked') === 'true'
  if (direction === 'like' && liked) return
  if (direction === 'unlike' && !liked) return
  button.click()
}

function openFocused(): void {
  const item = ensureGestureFocus(pathname)
  if (!item) {
    speakGesture('Здесь пусто')
    return
  }
  if (item.getAttribute('data-gesture-item') === 'switcher') {
    const tabs = [...item.querySelectorAll('[role="tab"]')] as HTMLElement[]
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
    const next = tabs[current === 0 ? 1 : 0] ?? tabs[0]
    if (next && !isDanger(next)) next.click()
    return
  }
  const explicit = item.querySelector('[data-gesture-open]')
  if (explicit instanceof HTMLElement && !isDanger(explicit)) {
    explicit.click()
    return
  }
  const postId = item.getAttribute('data-post-id')
  if (postId) {
    navigate(`/app/p/${postId}`)
    return
  }
  if ((item instanceof HTMLAnchorElement || item instanceof HTMLButtonElement) && !isDanger(item)) {
    item.click()
    return
  }
  const link = [...item.querySelectorAll('a[href^="/app/"]')].find((candidate) => !isDanger(candidate))
  if (link instanceof HTMLElement) {
    link.click()
    return
  }
  if (item instanceof HTMLElement && item.matches('.settings-list-row, [data-gesture-row]') && !isDanger(item)) {
    item.click()
  }
}

function goBack(): void {
  const overlay = document.querySelector('[data-gesture-layer] button[aria-label="Назад"]')
  if (overlay instanceof HTMLElement) {
    overlay.click()
    return
  }
  const buttons = [
    ...(document.querySelectorAll('.hub-app-root button[aria-label="Назад"], .hub-app-root button[aria-label="Отмена"]') as NodeListOf<HTMLElement>),
  ].filter((button) => button.getClientRects().length > 0 && !isDanger(button))
  const header = buttons.find((button) => button.closest('header, .hub-screen-header'))
  const target = header ?? buttons[0]
  if (target) {
    target.click()
    return
  }
  navigate(-1)
}

function move(direction: 1 | -1): void {
  if (isChatThread(pathname)) {
    if (!scrollChat(direction)) speakGesture('Здесь пусто')
    return
  }
  const moved = moveGestureFocus(pathname, direction)
  if (moved === 'empty' && !scrollActiveList(direction)) speakGesture('Здесь пусто')
}

/** Built-in actions used until Phase 1 registers the shared command handlers. */
export function runBuiltinGestureCommand(command: GestureCommand): void {
  if (command === 'stop') {
    silenceGestureSpeech()
    pauseMedia()
    return
  }
  if (command === 'like') {
    like('like')
    return
  }
  if (command === 'unlike') {
    like('unlike')
    return
  }
  if (command === 'next') {
    move(1)
    return
  }
  if (command === 'previous') {
    move(-1)
    return
  }
  if (command === 'next-tab') {
    switchTab(1)
    return
  }
  if (command === 'prev-tab') {
    switchTab(-1)
    return
  }
  if (command === 'open') {
    openFocused()
    return
  }
  if (command === 'back') goBack()
}

export function syncGestureFocus(enabled: boolean): void {
  if (!enabled) return
  ensureGestureFocus(pathname)
}
