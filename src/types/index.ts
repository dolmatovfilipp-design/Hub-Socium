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
