import type { GestureCommand } from './types'

type Claim = { source: 'voice' | 'gesture'; at: number; stop: boolean }

let lastClaim: Claim | null = null

function withinSameSecond(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1000
}

/**
 * Voice and gesture share one second. The earlier start wins.
 * Stop (voice or open palm) always interrupts the other.
 * Phase 1 calls `claimVoiceCommand` before running a phrase.
 */
export function claimVoiceCommand(at: number, stop: boolean): boolean {
  if (stop) {
    lastClaim = { source: 'voice', at, stop: true }
    return true
  }
  if (lastClaim && withinSameSecond(lastClaim.at, at)) {
    if (lastClaim.stop) return false
    if (lastClaim.at < at) return false
    if (lastClaim.at === at && lastClaim.source === 'gesture') return false
  }
  lastClaim = { source: 'voice', at, stop: false }
  return true
}

export function claimGestureCommand(at: number, stop: boolean): boolean {
  if (stop) {
    lastClaim = { source: 'gesture', at, stop: true }
    return true
  }
  if (lastClaim && withinSameSecond(lastClaim.at, at)) {
    if (lastClaim.stop) return false
    if (lastClaim.at < at) return false
    if (lastClaim.at === at && lastClaim.source === 'voice') return false
  }
  lastClaim = { source: 'gesture', at, stop: false }
  return true
}

export function resetGestureArbiter(): void {
  lastClaim = null
}

type Handler = (command: GestureCommand) => boolean | void

const handlers: Handler[] = []
let builtin: ((command: GestureCommand) => void) | null = null

/**
 * Phase 1 registers the shared command functions here and returns true
 * when it handled the command. Returning false, or registering nothing,
 * falls through to the gesture module's own navigation.
 */
export function registerGestureCommands(handler: Handler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.indexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

export function bindBuiltinGestureCommands(exec: (command: GestureCommand) => void): () => void {
  builtin = exec
  return () => {
    if (builtin === exec) builtin = null
  }
}

export function dispatchGestureCommand(command: GestureCommand): void {
  window.dispatchEvent(new CustomEvent('hub:gesture-command', { detail: { command } }))
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](command) === true) return
  }
  builtin?.(command)
}
