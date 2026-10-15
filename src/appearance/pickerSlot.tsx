import { useSyncExternalStore, type ComponentType } from 'react'
import type { ChatBackgroundPickerProps } from './types'

let current: ComponentType<ChatBackgroundPickerProps> | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Wallpaper UI registers here. Settings and the chat ⋯ sheet render whatever is registered. */
export function registerChatBackgroundPicker(component: ComponentType<ChatBackgroundPickerProps>) {
  current = component
  listeners.forEach((listener) => listener())
}

export function ChatBackgroundSlot(props: ChatBackgroundPickerProps) {
  const Picker = useSyncExternalStore(subscribe, () => current, () => null)
  if (!Picker) return null
  return <Picker {...props} />
}

export function useChatBackgroundPickerReady() {
  return useSyncExternalStore(subscribe, () => current != null, () => false)
}
