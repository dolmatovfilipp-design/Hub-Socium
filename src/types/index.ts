export interface User {
  id: string
  name: string
  username: string
  email: string
  phone?: string
  password: string
  avatar?: string
  bio?: string
  followers: number
  following: number
  isAdmin?: boolean
  birthDate?: string
  gender?: 'male' | 'female' | ''
  city?: string
  age?: number
  isPrivate?: boolean
  followRequested?: boolean
  canView?: boolean
  postsLocked?: boolean
  about?: string
  services?: string
  links?: string[]
  showCity?: boolean
  showBirthDate?: boolean
  sellerRating?: number
  sellerReviews?: number
}

export interface Post {
  id: string
  authorId: string
  text: string
  image?: string
  createdAt: string
  likes: string[]
  reposts: string[]
  replyToId?: string
  replies: string[]
  tags?: string[]
  quoteText?: string
  isQuote?: boolean
  original?: { text: string; authorId?: string; id?: string }
  repostOf?: string
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  text: string
  createdAt: string
  read: boolean
}

export interface Conversation {
  id: string
  participantIds: string[]
  lastMessageAt: string
}

export interface MarketItem {
  id: string
  title: string
  price: number
  description: string
  image: string
  category: string
  city?: string
  sellerType?: 'private' | 'company'
  /** Seed username (anna_k / oleg_msk) — resolved to UUID via conversations API in API mode. */
  sellerUsername?: string
  /** Local-mode seed user id (u2…). */
  sellerUserId?: string
  badge?: 'near' | 'hit' | null
  createdAt?: string
}

export type ActivityType = 'like' | 'follow' | 'mention' | 'reply' | 'repost'

export interface Activity {
  id: string
  type: ActivityType
  actorId: string
  targetPostId?: string
  text?: string
  createdAt: string
  read: boolean
}

export interface AppSettings {
  notificationsLikes: boolean
  notificationsFollows: boolean
  notificationsMessages: boolean
  notificationsMentions: boolean
  privacyPrivateAccount: boolean
  privacyShowActivity: boolean
  privacyAllowMessages: boolean
}

export interface AuthSession {
  userId: string
}
