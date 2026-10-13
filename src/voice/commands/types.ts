/**
 * Voice command registry — interface for the Phase 1 framework.
 *
 * Phase 1 owns the microphone, the listening indicator, settings, and speech
 * synthesis. This module owns command definitions for the feed, publications,
 * market, profile, and the share sheet those screens open.
 *
 * There is no wake word. A phrase is accepted only when the whole utterance,
 * after normalization, equals a phrase or synonym, or equals that phrase plus
 * a slot for commands that declare `takesSlot`. A leading «Хаб» or any other
 * activation word is not stripped.
 *
 * Confirmation:
 * - `none` — run immediately.
 * - `yes` — reversible send or publish. Phase 1 accepts «да» or «отправить».
 * - `dangerous` — delete, block, report, pay, and the other destructive
 *   actions. Phase 1 accepts only «да, подтверждаю». A bare «да» must not run
 *   the handler's effect. Silence for {@link CONFIRMATION_TIMEOUT_MS} cancels.
 *
 * Register with {@link registerVoiceCommands} and dispatch each final
 * utterance through {@link runVoiceCommand}. Handlers talk to the app only
 * through {@link VoiceCommandContext} surfaces, which the screen binder maps
 * onto the existing store and API calls (toggleLike, toggleRepost, compose
 * submit, market filters, profile actions).
 */

export const DANGEROUS_CONFIRM_PHRASE = 'да, подтверждаю'

/** Silence while a confirmation question is open cancels the action. */
export const CONFIRMATION_TIMEOUT_MS = 8000

export const API_ONLY_PHRASE = 'Это доступно при подключении к серверу'

export type VoiceConfirmation = 'none' | 'yes' | 'dangerous'

/** Starter pack. Dangerous commands stay `none` and are toggled one by one. */
export type VoicePreset = 'reading' | 'publications' | 'none'

export type VoiceCommandGroup = 'feed' | 'publications' | 'market' | 'profile' | 'share'

export type VoiceScreen =
  | 'feed'
  | 'post'
  | 'compose'
  | 'market'
  | 'profile'
  | 'share'
  | 'messages'
  | 'chat'
  | 'activity'
  | 'explore'
  | 'settings'
  | 'other'

export interface FocusedPost {
  id: string
  authorId: string
  authorName: string
  authorUsername: string
  text: string
  createdAt: string
  likedByMe: boolean
  repostedByMe: boolean
  saved: boolean
  following: boolean
  followRequested: boolean
  isPrivate: boolean
  isMine: boolean
  imageCount: number
  hasPoll: boolean
  poll: { id: string; options: { id: string; label: string }[] } | null
  /** 1-based index of the visible carousel photo. */
  carouselIndex: number
  carouselCount: number
}

export interface MarketListing {
  id: string
  title: string
  price: number
  category: string
  city: string
  description: string
}

export type ProfileTab = 'posts' | 'replies' | 'media' | 'reposts'

export interface ProfileSnapshot {
  id: string
  name: string
  username: string
  bio: string
  about: string
  services: string
  followers: number
  following: number
  isMe: boolean
  isFollowing: boolean
  followRequested: boolean
  isCloseFriend: boolean
  avatarOpen: boolean
  tab: ProfileTab
  isPrivate: boolean
}

export interface ActionResult {
  ok: boolean
  error?: string
  requested?: boolean
  offlineQueued?: boolean
  suggestion?: string
  confirmationUrl?: string
  message?: string
  copiedFallback?: boolean
}

/**
 * Feed surface. The binder scrolls the focused root post into view inside
 * `moveFocus` and calls the same store actions as PostCard / PostMoreSheet:
 * toggleLike, toggleRepost, toggleSave, refreshFeed, markInterested, hidePost,
 * hideAuthor, restrictAuthor, blockAuthor, reportPost, followUser, unfollowUser,
 * apiMuteUser, apiAddArchive (photo when the post has an image, otherwise post),
 * apiQuoteRepost, apiVotePoll, deletePost.
 */
export interface FeedVoiceSurface {
  focused: FocusedPost | null
  /** Move among root posts. Return null at either end without wrapping. */
  moveFocus: (delta: number) => FocusedPost | null
  toggleLike: (postId: string) => Promise<ActionResult>
  toggleRepost: (postId: string) => Promise<ActionResult>
  toggleSave: (postId: string) => Promise<ActionResult>
  refresh: () => Promise<ActionResult>
  openMore: (postId: string) => void
  closeMore: () => void
  moreOpen: boolean
  markInterested: (authorId: string) => void
  hidePost: (postId: string) => void
  hideAuthor: (authorId: string) => void
  restrictAuthor: (authorId: string) => void
  blockAuthor: (authorId: string) => Promise<ActionResult>
  reportPost: (postId: string, reason: string) => Promise<ActionResult>
  follow: (userId: string) => Promise<ActionResult>
  unfollow: (userId: string) => Promise<ActionResult>
  muteAuthor: (authorId: string) => Promise<ActionResult>
  archivePost: (postId: string) => Promise<ActionResult>
  quoteRepost: (postId: string, quoteText: string) => Promise<ActionResult>
  votePoll: (pollId: string, optionId: string) => Promise<ActionResult>
  deletePost: (postId: string) => Promise<ActionResult>
  stepCarousel: (
    delta: number,
  ) => { ok: true; index: number } | { ok: false; reason: 'none' | 'start' | 'end' }
  copyPostLink: (postId: string) => Promise<ActionResult>
  openShare: (postId: string) => void
}

/**
 * Compose surface. Maps onto ComposeSheet: textarea, tags, image list,
 * apiComposeAssist, createPost / submit, and the voice-reply block.
 * `beginVoiceReply` opens the preview block and must not upload by itself.
 */
export interface ComposeVoiceSurface {
  open: boolean
  isReply: boolean
  text: string
  tags: string
  imageCount: number
  /** Last server suggestion, kept so the second «да» can apply it. */
  assistHint: string
  setText: (text: string) => void
  setTags: (tags: string) => void
  /** `index` is 1-based. `last` removes the last image. */
  removeImage: (index: number | 'last') => boolean
  requestPhotoPicker: () => void
  requestAssist: (text: string) => Promise<ActionResult>
  applySuggestion: (suggestion: string) => void
  submit: () => Promise<ActionResult>
  cancel: () => void
  beginVoiceReply: () => void
  prepareReply: (postId: string) => void
}

/**
 * Market surface. Maps onto Market.tsx: search field, category orbit,
 * MarketFilterState, focus in the filtered list, messageSeller,
 * apiAddArchive type listing, apiCreateDemoPayment, apiCreateMarketAd,
 * and the seller-review sheet.
 */
export interface MarketVoiceSurface {
  focused: MarketListing | null
  count: number
  reviewOpen: boolean
  reviewRating: number
  setQuery: (query: string) => void
  /** Orbit value, including «Все». */
  setCategory: (category: string) => void
  setCity: (city: string) => void
  setPriceFrom: (value: string) => void
  setPriceTo: (value: string) => void
  setSort: (sort: 'default' | 'new' | 'cheap' | 'expensive') => void
  setSellerType: (seller: 'all' | 'private' | 'company') => void
  resetFilters: () => void
  moveFocus: (delta: number) => MarketListing | null
  messageSeller: (id: string) => Promise<ActionResult>
  archiveListing: (id: string) => Promise<ActionResult>
  demoPay: (id: string) => Promise<ActionResult>
  openPaymentUrl: (url: string) => void
  createAd: (input: { title: string; price: number; city: string }) => Promise<ActionResult>
  setReviewRating: (rating: number) => void
  setReviewBody: (text: string) => void
  submitReview: () => Promise<ActionResult>
  closeReview: () => void
}

/**
 * Profile surface. Maps onto Profile.tsx: tabs, followUser / unfollowUser,
 * apiSendProfileAttention, apiAddCloseFriend, apiRemoveCloseFriend,
 * apiAddArchive type contact, apiReportUser reason profile, ShareSheet, avatar lightbox.
 */
export interface ProfileVoiceSurface {
  user: ProfileSnapshot | null
  setTab: (tab: ProfileTab) => void
  follow: () => Promise<ActionResult>
  unfollow: () => Promise<ActionResult>
  sendAttention: () => Promise<ActionResult>
  addCloseFriend: () => Promise<ActionResult>
  removeCloseFriend: () => Promise<ActionResult>
  archiveProfile: () => Promise<ActionResult>
  reportProfile: () => Promise<ActionResult>
  openShare: () => void
  openAvatar: () => void
  closeAvatar: () => void
}

/** Share sheet. Maps onto ShareSheet copy, Telegram, navigator.share, close. */
export interface ShareVoiceSurface {
  open: boolean
  copyLink: () => Promise<ActionResult>
  openTelegram: () => void
  systemShare: () => Promise<ActionResult>
  close: () => void
}

export interface VoiceCommandContext {
  /** Current path, for example `/app` or `/app/compose?reply=1`. */
  route: string
  /**
   * Screen resolved by Phase 1. Feed and market share `/app`; use
   * {@link screenFromRoute} with the feed/market tab.
   */
  screen: VoiceScreen
  /** True only inside `/app` after login and after consent. */
  insideApp: boolean
  /** Mirrors `isApiMode()`. Local-only buttons keep their toast text. */
  apiMode: boolean
  /** Text after the matched phrase. Empty when the phrase was exact. */
  slot: string
  /** Original phrase or synonym that matched, before normalization. */
  matchedPhrase: string
  /** Step passed back from the previous result's `resumeStep` or dictation. */
  step: string
  /**
   * Set by {@link runVoiceCommand} after a confirmation answer.
   * `dangerous` is only «да, подтверждаю». `yes` is «да» or «отправить».
   */
  confirmation?: 'yes' | 'dangerous' | 'no'
  dictationEvent?: 'append' | 'commit' | 'send'
  /** Full dictated text so far. Not normalized, so the post keeps its casing. */
  dictationText?: string
  speak: (text: string) => void
  navigate: (path: string) => void
  /** Visual toast. Handlers use it for the same string the button would show. */
  toast: (text: string) => void
  feed: FeedVoiceSurface
  compose: ComposeVoiceSurface
  market: MarketVoiceSurface
  profile: ProfileVoiceSurface
  share: ShareVoiceSurface
}

export interface VoiceCommandResult {
  ok: boolean
  /** Phrase Phase 1 should speak. Empty when dictation just grew. */
  spoken: string
  code?: string
  needsConfirmation?: 'yes' | 'dangerous'
  confirmPrompt?: string
  /** Pass back as `ctx.step` when the user answers or finishes dictation. */
  resumeStep?: string
  startDictation?: { step: string; prompt: string }
  needsSlot?: { step: string; prompt: string }
}

export interface VoiceCommandDefinition {
  /** Catalog id, for example `F-03`. */
  id: string
  /** Exact short phrases from the catalog. No wake word. */
  phrases: readonly string[]
  /** Further exact phrases. Matching treats them like `phrases`. */
  synonyms: readonly string[]
  group: VoiceCommandGroup
  screens: readonly VoiceScreen[]
  confirmation: VoiceConfirmation
  /** Included in the starter pack «Чтение и навигация». */
  inReadingSet: boolean
  preset: VoicePreset
  /** When true, text after the phrase is `ctx.slot` (`категория электроника`). */
  takesSlot: boolean
  /** Catalog reply: the question, or the line spoken when the action starts. */
  reply: string
  handler: (ctx: VoiceCommandContext) => Promise<VoiceCommandResult> | VoiceCommandResult
}

export interface PendingVoiceAction {
  commandId: string
  step: string
  slot: string
  dictationText?: string
  confirmation: 'yes' | 'dangerous'
  prompt: string
}

export interface VoiceSession {
  pending: PendingVoiceAction | null
  dictation: { commandId: string; step: string; text: string } | null
  awaitingSlot: { commandId: string; step: string; prompt: string } | null
}

export interface VoiceTurn {
  ok: boolean
  spoken: string
  code?: string
  session: VoiceSession
}
