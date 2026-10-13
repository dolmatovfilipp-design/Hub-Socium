import { isApiMode } from '../../../lib/api.ts'
import { useStore } from '../../../store/useStore.ts'
import type { VoiceCommandContext, VoiceConfirmation } from './types.ts'

/**
 * Build the context Phase 4 handlers expect. Create one per utterance.
 * `confirmationGranted` stays null for commands with `confirmInHandler`
 * (file send names the file inside the handler).
 */
export function createAppVoiceContext(hooks: {
  getPathname: () => string
  navigate: (to: string) => void
  say: (text: string) => void
  toast?: (text: string) => void
  confirm: (prompt: string, kind: Exclude<VoiceConfirmation, 'none'>) => Promise<boolean>
  dictate: (prompt: string) => Promise<string | null>
  confirmationGranted?: VoiceConfirmation | null
}): VoiceCommandContext {
  return {
    pathname: hooks.getPathname(),
    say: hooks.say,
    navigate: hooks.navigate,
    toast: hooks.toast ?? ((text) => useStore.getState().showToast(text)),
    confirm: hooks.confirm,
    dictate: hooks.dictate,
    confirmationGranted: hooks.confirmationGranted ?? null,
    isApiMode,
    currentUserId: () => useStore.getState().currentUserId,
    localActivities: () => {
      const state = useStore.getState()
      return state.activities.map((activity) => {
        const actor = state.users.find((user) => user.id === activity.actorId)
        return {
          id: activity.id,
          type: activity.type,
          actorId: activity.actorId,
          actorName: actor?.name || 'Кто-то',
          targetPostId: activity.targetPostId,
          text: activity.text,
          createdAt: activity.createdAt,
          read: activity.read,
        }
      })
    },
    removeLocalActivity: (id) => useStore.getState().removeActivity(id),
  }
}
