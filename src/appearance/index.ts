/**
 * Appearance prefs and the chat-background hook.
 *
 * Wallpaper files and the «Фон чата» picker UI are not part of this module.
 * Register a picker and it mounts in Settings and in the chat ⋯ sheet:
 *
 *   registerChatBackgroundPicker(ChatBackgroundPicker)
 *
 * Props: { conversationId?: string; onClose?: () => void }.
 * Omit conversationId to edit the account-wide background.
 * setConversationBackground(id, null) inherits that background.
 *
 * Manifest: GET /wallpapers/manifest.json
 *   { "wallpapers": [ { "id": "bg1", "name": "Ночь", "file": "bg1.png" } ] }
 * Any number of entries. The server stores the id; it does not list files.
 */
export { AppearanceSettings } from './AppearanceSettings'
export { ChatBackgroundSheet } from './ChatBackgroundSheet'
export { ChatFrame } from './ChatFrame'
export { ChatPreview } from './ChatPreview'
export { ChatBackgroundSlot, registerChatBackgroundPicker, useChatBackgroundPickerReady } from './pickerSlot'
export {
  APPEARANCE_EVENT,
  APPEARANCE_ERROR_EVENT,
  backgroundForChat,
  bootAppearance,
  cssImage,
  loadWallpaperManifest,
  peekBackgroundImage,
  readAppearance,
  rememberCustomImage,
  resolveBackgroundImage,
  setConversationBackground,
  setGlobalBackground,
  updateAppearance,
  useChatBackground,
} from './chatBackground'
export { normalizeBackground } from './storage'
export type {
  AccentId,
  AppearanceMode,
  AppearancePatch,
  AppearancePrefs,
  BackgroundKind,
  ChatBackground,
  ChatBackgroundPickerProps,
  FontScale,
  WallpaperEntry,
} from './types'
export { ACCENTS, FONT_SCALES, accentById, fontById, noneBackground } from './types'
