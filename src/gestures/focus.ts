const FOCUS_CLASS = 'hub-gesture-focus'

let focused: HTMLElement | null = null
/** True after a palm move. An automatic switcher highlight can still yield to posts. */
let focusPinned = false

export function isChatThread(pathname: string): boolean {
  const match = pathname.match(/^\/app\/messages\/([^/]+)$/)
  if (!match) return false
  return !['new', 'new-group', 'requests', 'hidden-words'].includes(match[1])
}

/** Same screens where AppShell hides the bottom nav and ignores shell swipes. */
export function shellSwipeDisabled(pathname: string): boolean {
  return (
    pathname.startsWith('/app/messages/') ||
    pathname === '/app/compose' ||
    pathname.startsWith('/app/compose/') ||
    pathname === '/app/profile/edit' ||
    /\/app\/profile\/[^/]+\/(followers|following)$/.test(pathname) ||
    pathname === '/app/settings' ||
    pathname.startsWith('/app/mod') ||
    pathname.startsWith('/app/p/') ||
    pathname.startsWith('/app/channels') ||
    pathname.startsWith('/app/meetups')
  )
}

function root(): ParentNode {
  return document.querySelector('.hub-app-root') ?? document.body
}

function visible(el: HTMLElement): boolean {
  const rect = el.getClientRects()[0]
  return Boolean(rect && rect.width > 8 && rect.height > 8)
}

function unique(elements: HTMLElement[]): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const list: HTMLElement[] = []
  for (const el of elements) {
    if (!el || seen.has(el) || !visible(el)) continue
    seen.add(el)
    list.push(el)
  }
  return list
}

function query(selector: string): HTMLElement[] {
  return unique([...(root().querySelectorAll(selector) as NodeListOf<HTMLElement>)])
}

/** Ordered focus targets for the current route. Markers win over heuristics. */
export function gestureItems(pathname: string): HTMLElement[] {
  const layer = document.querySelector('[data-gesture-layer]')
  if (layer) {
    return unique([...(layer.querySelectorAll('[data-gesture-row], .settings-list-row') as NodeListOf<HTMLElement>)])
  }
  const marked = query('[data-gesture-item]')
  if (pathname === '/app') {
    const market = document.querySelector('[aria-label="Бизнес"]')?.getAttribute('aria-selected') === 'true'
    const kind = market ? 'listing' : 'post'
    const posts = marked.filter((el) => el.getAttribute('data-gesture-item') === kind)
    const switcher = marked.filter((el) => el.getAttribute('data-gesture-item') === 'switcher')
    if (posts.length || switcher.length) return [...switcher, ...posts]
  }
  if (marked.length && pathname !== '/app') return marked.filter((el) => el.getAttribute('data-gesture-item') !== 'switcher')

  if (pathname === '/app/messages') return query('a.msg-row')
  if (isChatThread(pathname)) return query('.msg-bubble')
  if (pathname.startsWith('/app/clips')) return query('[data-clip-id]')
  if (pathname.startsWith('/app/explore')) {
    const people = query('a[href^="/app/u/"], a[href^="/app/profile/"]')
    if (people.length) return people
    return query('a[href^="/app/p/"]')
  }
  if (pathname.startsWith('/app/activity')) return query('[data-gesture-item="activity"], .hub-row-divider')
  if (pathname.startsWith('/app/profile')) {
    const head = root().querySelector('h2')?.parentElement
    return unique([...(head ? [head] : []), ...query('article')])
  }
  if (pathname.startsWith('/app/channels')) return query('a[href^="/app/channels/"]')
  if (pathname.startsWith('/app/meetups')) return query('a[href^="/app/meetups/"]')
  if (pathname.startsWith('/app/settings') || pathname.startsWith('/app/mod')) return query('.settings-list-row, [data-gesture-row]')
  return query('article, a.msg-row, .settings-list-row')
}

function mostlyVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  const viewTop = 0
  const viewBottom = window.innerHeight
  const visibleTop = Math.max(rect.top, viewTop)
  const visibleBottom = Math.min(rect.bottom, viewBottom)
  const shown = Math.max(0, visibleBottom - visibleTop)
  return shown >= rect.height * 0.5
}

export function defaultGestureIndex(pathname: string, items: HTMLElement[]): number {
  if (!items.length) return -1
  if (isChatThread(pathname)) return items.length - 1
  const content = items
    .map((el, index) => ({ el, index }))
    .filter(({ el }) => el.getAttribute('data-gesture-item') !== 'switcher')
  const pool = content.length ? content : items.map((el, index) => ({ el, index }))
  const visibleHit = pool.find(({ el }) => mostlyVisible(el))
  if (pathname.startsWith('/app/clips')) {
    const playing = pool.find(({ el }) => {
      const video = el.querySelector('video')
      return video instanceof HTMLVideoElement && !video.paused
    })
    if (playing) return playing.index
  }
  return (visibleHit ?? pool[0]).index
}

export function focusedGestureItem(): HTMLElement | null {
  if (focused && focused.isConnected) return focused
  focused = null
  return null
}

export function applyGestureFocus(el: HTMLElement | null, scroll: boolean): void {
  if (focused && focused !== el) focused.classList.remove(FOCUS_CLASS)
  focused = el
  if (!el) {
    focusPinned = false
    return
  }
  el.classList.add(FOCUS_CLASS)
  if (!scroll) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
}

export function clearGestureFocus(): void {
  applyGestureFocus(null, false)
}

export function ensureGestureFocus(pathname: string): HTMLElement | null {
  const items = gestureItems(pathname)
  const current = focusedGestureItem()
  const postsReady = items.some((el) => el.getAttribute('data-gesture-item') !== 'switcher')
  const waitingForPosts =
    !focusPinned && current?.getAttribute('data-gesture-item') === 'switcher' && postsReady
  if (current && items.includes(current) && !waitingForPosts) return current
  const index = defaultGestureIndex(pathname, items)
  if (index < 0) {
    clearGestureFocus()
    return null
  }
  applyGestureFocus(items[index], false)
  return items[index]
}

export function moveGestureFocus(pathname: string, direction: 1 | -1): 'ok' | 'empty' | 'edge' {
  const items = gestureItems(pathname)
  if (!items.length) return 'empty'
  const current = focusedGestureItem()
  let index = current ? items.indexOf(current) : -1
  if (index < 0) index = defaultGestureIndex(pathname, items)
  const next = index + direction
  if (next < 0 || next >= items.length) {
    focusPinned = true
    applyGestureFocus(items[Math.max(0, Math.min(items.length - 1, index))], true)
    return 'edge'
  }
  focusPinned = true
  applyGestureFocus(items[next], true)
  return 'ok'
}

function chatScroller(): HTMLElement | null {
  const bubble = root().querySelector('.msg-bubble')
  const fromBubble = bubble?.closest('.overflow-y-auto')
  if (fromBubble instanceof HTMLElement) return fromBubble
  const fallback = root().querySelector('.overflow-y-auto')
  return fallback instanceof HTMLElement ? fallback : null
}

/** Palm up scrolls toward newer messages, which sit lower in the thread. */
export function scrollChat(direction: 1 | -1): boolean {
  const scroller = chatScroller()
  if (!scroller) return false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollBy({ top: direction * scroller.clientHeight * 0.65, behavior: reduce ? 'auto' : 'smooth' })
  window.setTimeout(() => {
    const bubbles = [...scroller.querySelectorAll('.msg-bubble')] as HTMLElement[]
    if (!bubbles.length) return
    const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2
    let best = bubbles[direction > 0 ? bubbles.length - 1 : 0]
    let bestDist = Number.POSITIVE_INFINITY
    for (const bubble of bubbles) {
      const rect = bubble.getBoundingClientRect()
      const dist = Math.abs(rect.top + rect.height / 2 - mid)
      if (dist < bestDist) {
        best = bubble
        bestDist = dist
      }
    }
    applyGestureFocus(best, false)
  }, reduceMotionDelay())
  return true
}

function reduceMotionDelay(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280
}

export function scrollActiveList(direction: 1 | -1): boolean {
  const marked = document.querySelector('[data-gesture-scroll]')
  const scroller =
    marked instanceof HTMLElement
      ? marked
      : (root().querySelector('.overflow-y-auto') as HTMLElement | null)
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 8) return false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollBy({ top: direction * scroller.clientHeight * 0.6, behavior: reduce ? 'auto' : 'smooth' })
  return true
}
