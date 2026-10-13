import type { AppSettings } from '../types'

export const defaultSettings: AppSettings = {
  notificationsLikes: true,
  notificationsFollows: true,
  notificationsMessages: true,
  notificationsMentions: true,
  privacyPrivateAccount: false,
  privacyShowActivity: true,
  privacyAllowMessages: true,
  hideStories: false,
}

export const STORAGE_KEY = 'hub-app-v3-vitrina'
