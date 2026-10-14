import { createContext, useContext } from 'react'

/** True when this screen is the visible cached tab. Hidden tabs must not poll. */
export const TabVisibleContext = createContext(true)

export function useTabVisible(): boolean {
  return useContext(TabVisibleContext)
}
