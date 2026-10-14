/**
 * Voice command contract for Phase 4 registries.
 *
 * The Phase 1 framework (built separately) imports these modules. It does not
 * own the phrase lists below. There is no wake word and none can be added:
 * do not prepend «Хаб», «окей» or any other activation phrase. A command runs
 * only when the whole normalized utterance matches a phrase or synonym, or a
 * phrase plus a slot tail. Normalization is `normalizePhrase` in `phrase.ts`:
 * lower case, `ё` → `е`, punctuation removed, one space between words.
 *
 * Confirmation kinds match the catalog column in `docs/voice-control-spec.md`:
 * - `none` — run immediately;
 * - `yes` — the question accepts only «да» or «отправить»;
 * - `dangerous` — the question accepts only «да, подтверждаю».
 *   A bare «да» or silence does not confirm. Silence of 8 seconds
 *   cancels. This gate cannot be switched off in settings.
 *
 * File send is `yes` (reversible send) and still requires a spoken question
 * that includes the file name. The handler asks it (`confirmInHandler`).
 * Destructive actions use `dangerous`.
 *
 * «Уведомления» is not a separate screen. It is a synonym of G-07 and opens
 * «Действия» (`/app/activity`).
 *
 * Dispatch order the framework should keep (spec §11.1):
 * 1. An open confirmation accepts only yes/no phrases.
 * 2. An open dictation accepts only its exit words.
 * 3. If the file shelf is open, call `matchPhase4` — it tries shelf-priority
 *    commands («первое», «последнее», «номер N», «отправить», «отмена») first.
 * 4. Then global commands, then the current screen.
 * 5. The longest matching phrase wins. Two different commands at the same
 *    length are ambiguous: ask, do not pick one.
 *
 * Handlers return the line to speak. They do not speak it themselves, except
 * a shelf overflow notice via `registerVoiceSay`. Intermediate questions go
 * through `ctx.confirm` and `ctx.dictate`.
 *
 * Merge notes for the other voice agents:
 * - Do not register a second G-07, G-10 or G-19. These modules are the
 *   source for those ids. «Уведомления» must stay on G-07.
 * - On `/app/activity`, A-01 «что нового» wins over the feed command F-19.
 * - On `/app/clips`, V-03 «лайк» wins over the feed command F-03.
 * - While the shelf is open, FS-SEND wins over chat C-08 «отправить».
 * - G-05 «отмена» must call `cancelPhase4Pending()` so the shelf, a half-chosen
 *   clip and a pending continuation actually clear.
 * - Listen for `hub:voice-continuation` and run `takeVoiceContinuation()` with
 *   the live context after the user picks a clip file.
 */

export type VoiceConfirmation = 'none' | 'yes' | 'dangerous'

/** Where a command is legal. `*` is any screen under `/app`. */
export type VoiceScreen =
  | '*'
  | 'channels'
  | 'channel'
  | 'clips'
  | 'activity'
  | 'chat'

export type VoiceSlot = 'name' | 'number' | 'text'

export interface VoiceMatch {
  /** Normalized full utterance. */
  utterance: string
  /** Normalized phrase that matched (without the slot tail). */
  phrase: string
  /** Text after the phrase. Empty when the match is exact. */
  slot: string
  /** 1-based index parsed from an ordinal, a digit, or «номер N». */
  number?: number
}

export interface VoiceCommandResult {
  /** Line the framework speaks. Empty when the handler already finished via confirm/dictate. */
  say: string
  /** Router path. The framework performs the navigation. */
  navigateTo?: string
  /** True when the user refused or the confirmation timed out. */
  cancelled?: boolean
}

export interface LocalActivityCard {
  id: string
  type: string
  actorId: string
  actorName: string
  targetPostId?: string
  text?: string
  createdAt: string
  read: boolean
}

/**
 * Services the Phase 1 framework supplies. Command modules do not open the
 * microphone and do not read React state themselves.
 *
 * `dictate` resolves `null` on «отмена» and a string (possibly empty) when
 * the user says «готово». `confirm` resolves `false` on «нет», «отмена», or
 * eight seconds of silence, and speaks «Отменила» itself in the silence case.
 */
export interface VoiceCommandContext {
  pathname: string
  say(text: string): void
  navigate(to: string): void
  toast(text: string): void
  confirm(prompt: string, kind: Exclude<VoiceConfirmation, 'none'>): Promise<boolean>
  dictate(prompt: string): Promise<string | null>
  /**
   * Set only for the current call, and only after the framework has already
   * asked `confirmPrompt`. Leave `null` for commands with `confirmInHandler`,
   * so the handler can ask a prompt that includes the file name.
   * `dangerous` satisfies a `yes` question. `yes` does not satisfy `dangerous`.
   */
  confirmationGranted: VoiceConfirmation | null
  isApiMode(): boolean
  currentUserId(): string | null
  localActivities(): LocalActivityCard[]
  removeLocalActivity(id: string): void
}

export interface VoiceCommandDefinition {
  /** Catalog id, for example `CN-03` or `G-07`. */
  id: string
  /** Settings switch title. */
  title: string
  /** Settings group. */
  group: 'Общие' | 'Сообщества' | 'Видео' | 'Действия' | 'Чат'
  /**
   * Exact trigger phrases from the catalog. No wake word.
   * The matcher also accepts `synonyms`.
   */
  phrases: readonly string[]
  /** Extra exact triggers. «Уведомления» lives here on G-07. */
  synonyms: readonly string[]
  screens: readonly VoiceScreen[]
  /**
   * `shelf` commands are tried before every other command while the file
   * shelf is open (spec §11.1 step 3).
   */
  priority?: 'shelf'
  /** Ignored unless the shelf is open. */
  shelfOnly?: boolean
  confirmation: VoiceConfirmation
  /**
   * When true, the framework must not confirm before calling the handler.
   * The handler calls `ctx.confirm` with a prompt that depends on runtime
   * data (the picked file's name).
   */
  confirmInHandler?: boolean
  /** Question shown when `confirmation` is not `none` and `confirmInHandler` is not set. */
  confirmPrompt: string
  /** Catalog reply. Reading commands speak richer text from the handler. */
  reply: string
  /** Included in the starter set «Чтение и навигация». */
  starter: boolean
  /** Present when a tail after the phrase is a name, number, or free text. */
  slot?: VoiceSlot
  handler: (ctx: VoiceCommandContext, match: VoiceMatch) => Promise<VoiceCommandResult>
}

export interface VoiceMatchHit {
  status: 'ok'
  command: VoiceCommandDefinition
  match: VoiceMatch
}

export type VoiceMatchResult =
  | VoiceMatchHit
  | { status: 'ambiguous'; say: string }
  | { status: 'none' }

export const SAY_NOT_HERE = 'Эта команда здесь не действует'
export const SAY_API_ONLY = 'Это доступно при подключении к серверу'
export const SAY_EMPTY = 'Здесь пусто'
export const SAY_CANCELLED = 'Отменила'

export const RESULT_CANCELLED: VoiceCommandResult = { say: '', cancelled: true }

export function errorSay(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim()
    if (message === 'request failed' || message === 'Failed to fetch') return 'Нет сети. Действие не выполнено'
    return message
  }
  return 'Не удалось выполнить'
}
