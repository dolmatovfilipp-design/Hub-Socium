/**
 * Phase 4 voice commands for the feed, publications, market, and profile.
 *
 * Another agent builds the Phase 1 framework (microphone, indicator, settings,
 * Web Speech / server transcription). That framework should register this
 * catalog and send each finished utterance here. This module does not open
 * the microphone and does not look for a wake word.
 *
 * ```ts
 * import {
 *   phase4VoiceCommands,
 *   runVoiceCommand,
 *   screenFromRoute,
 *   confirmationTimedOut,
 *   CONFIRMATION_TIMEOUT_MS,
 * } from './voice/commands/index.ts'
 *
 * const turn = await runVoiceCommand({
 *   commands: phase4VoiceCommands,
 *   utterance,
 *   ctx: {
 *     route,
 *     screen: screenFromRoute(route, { marketTab }),
 *     insideApp: true,
 *     apiMode,
 *     slot: '',
 *     matchedPhrase: '',
 *     step: '',
 *     speak,
 *     navigate,
 *     toast,
 *     feed,
 *     compose,
 *     market,
 *     profile,
 *     share,
 *   },
 *   session,
 *   isEnabled: (command) => prefs.enabled[command.id] ?? command.inReadingSet,
 * })
 * ```
 *
 * Merge notes for Phase 1:
 * - «ещё» is F-20 on the feed and G-22 in the global catalog. Equal-length
 *   matches on one screen come back as «Уточните».
 * - «что нового» is F-19 here and A-01 on the activity screen. Screen keeps
 *   them apart. On the feed it opens compose and does not publish.
 * - «подпишись» and «отпишись» exist on both the feed and the profile. The
 *   current screen picks one.
 * - Dangerous actions (block, report, delete, mute, restrict, hide user,
 *   demo payment) run only after the utterance normalizes to «да подтверждаю».
 *   «да» repeats the question. Eight seconds of silence should call
 *   {@link confirmationTimedOut}.
 * - Bind surfaces to the existing store and API: toggleLike, toggleRepost,
 *   toggleSave, refreshFeed, PostMoreSheet actions, ComposeSheet submit,
 *   Market filters / messageSeller / apiCreateMarketAd / apiCreateDemoPayment,
 *   Profile follow and attention. Do not auto-send a voice reply on stop.
 */

import { feedCommands } from './feed.ts'
import { marketCommands } from './market.ts'
import { profileCommands } from './profile.ts'
import { publicationCommands } from './publications.ts'
import { registerVoiceCommands } from './runtime.ts'
import { shareCommands } from './share.ts'

export { feedCommands } from './feed.ts'
export { describePost } from './feed.ts'
export { marketCommands, parseMarketAd, resolveMarketCategory, resolveMarketCity } from './market.ts'
export { profileCommands, describeProfile } from './profile.ts'
export { publicationCommands } from './publications.ts'
export { shareCommands } from './share.ts'

export {
  CONFIRMATION_TIMEOUT_MS,
  DANGEROUS_CONFIRM_PHRASE,
  API_ONLY_PHRASE,
} from './types.ts'

export type {
  ActionResult,
  ComposeVoiceSurface,
  FeedVoiceSurface,
  FocusedPost,
  MarketListing,
  MarketVoiceSurface,
  PendingVoiceAction,
  ProfileSnapshot,
  ProfileTab,
  ProfileVoiceSurface,
  ShareVoiceSurface,
  VoiceCommandContext,
  VoiceCommandDefinition,
  VoiceCommandGroup,
  VoiceCommandResult,
  VoiceConfirmation,
  VoicePreset,
  VoiceScreen,
  VoiceSession,
  VoiceTurn,
} from './types.ts'

export {
  classifyAnswer,
  confirmationTimedOut,
  emptySession,
  interpretDictation,
  matchVoiceCommand,
  normalizeUtterance,
  registerVoiceCommands,
  runVoiceCommand,
  screenFromRoute,
} from './runtime.ts'

export const phase4VoiceCommands = registerVoiceCommands(
  feedCommands,
  publicationCommands,
  marketCommands,
  profileCommands,
  shareCommands,
)
