/**
 * Node stand-in for the overlap check. The app never imports this file.
 */
const store = new Map<string, string>()
const listeners = new Map<string, Set<(event: Event) => void>>()

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    },
  })
}

if (typeof globalThis.window === 'undefined') {
  const storage = globalThis.localStorage
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      dispatchEvent(event: Event) {
        listeners.get(event.type)?.forEach((fn) => fn(event))
        return true
      },
      addEventListener(type: string, fn: (event: Event) => void) {
        const set = listeners.get(type) ?? new Set<(event: Event) => void>()
        set.add(fn)
        listeners.set(type, set)
      },
      removeEventListener() {},
    },
  })
}

if (typeof globalThis.CustomEvent === 'undefined') {
  class HubCustomEvent<T> extends Event {
    detail: T
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type)
      this.detail = init?.detail as T
    }
  }
  ;(globalThis as unknown as { CustomEvent: typeof HubCustomEvent }).CustomEvent = HubCustomEvent
}
