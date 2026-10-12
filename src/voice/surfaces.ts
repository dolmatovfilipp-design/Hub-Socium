/**
 * Binds voice command surfaces to the store, the DOM, and the open screen.
 * Nothing here covers the page or takes pointer events.
 */
import { useEffect, useRef } from 'react'
import {
  apiAddArchive,
  apiAddCloseFriend,
  apiComposeAssist,
  apiCreateMarketAd,
  apiMuteUser,
  apiQuoteRepost,
  apiRemoveCloseFriend,
  apiReportUser,
  apiSendProfileAttention,
  apiVotePoll,
  isApiMode,
} from '../lib/api'
import { useStore } from '../store/useStore'
import type { MarketItem, Post, User } from '../types'
import type {
  ActionResult,
  ComposeVoiceSurface,
  FeedVoiceSurface,
  FocusedPost,
  MarketListing,
  MarketVoiceSurface,
  ProfileSnapshot,
  ProfileTab,
  ProfileVoiceSurface,
  ShareVoiceSurface,
} from './commands/types.ts'

const API_ONLY = 'Это доступно при подключении к серверу'

let voicePath = '/app'
const carousel = new Map<string, number>()
let feedCursor = 0
let moreOpen = false
let shareOpen = false
let assistHint = ''
let composeTags = ''
let profileTab: ProfileTab = 'posts'
let avatarOpen = false
const closeFriends = new Set<string>()

export function bindVoicePath(path: string): void {
  voicePath = path.split('?')[0] || '/app'
}

function ok(extra: Partial<ActionResult> = {}): ActionResult {
  return { ok: true, ...extra }
}

function bad(error: string): ActionResult {
  return { ok: false, error }
}

async function attempt(fn: () => Promise<void> | void): Promise<ActionResult> {
  try {
    await fn()
    return ok()
  } catch (error) {
    return bad(error instanceof Error ? error.message : 'Ошибка')
  }
}

function feedPosts(): Post[] {
  const state = useStore.getState()
  const muted = new Set([
    ...state.hiddenAuthorIds,
    ...state.restrictedAuthorIds,
    ...state.blockedAuthorIds,
  ])
  const hidden = new Set(state.hiddenPostIds)
  const interested = new Set(state.interestedAuthorIds)
  return state.posts
    .filter((post) => !post.replyToId && !hidden.has(post.id) && !muted.has(post.authorId))
    .sort((a, b) => Number(interested.has(b.authorId)) - Number(interested.has(a.authorId)))
}

function postFromPath(): Post | null {
  const match = voicePath.match(/^\/app\/p\/([^/]+)/)
  if (!match) return null
  const id = decodeURIComponent(match[1])
  return useStore.getState().posts.find((post) => post.id === id) ?? null
}

function currentFeedPost(): Post | null {
  const direct = postFromPath()
  if (direct) return direct
  const posts = feedPosts()
  if (!posts.length) return null
  if (feedCursor >= posts.length) feedCursor = posts.length - 1
  if (feedCursor < 0) feedCursor = 0
  return posts[feedCursor] ?? null
}

export function focusedVoicePostId(path: string): string | null {
  bindVoicePath(path)
  return currentFeedPost()?.id ?? null
}

function scrollPost(id: string): void {
  document.querySelector(`[data-voice-post="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
}

function toFocused(post: Post | null): FocusedPost | null {
  if (!post) return null
  const state = useStore.getState()
  const author = state.users.find((user) => user.id === post.authorId)
  const me = state.currentUserId
  const images = post.images?.length ? post.images : post.image ? [post.image] : []
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: author?.name || 'Автор',
    authorUsername: author?.username || '',
    text: post.text,
    createdAt: post.createdAt,
    likedByMe: Boolean(me && post.likes.includes(me)),
    repostedByMe: Boolean(me && post.reposts.includes(me)),
    saved: state.savedPostIds.includes(post.id),
    following: state.followingIds.includes(post.authorId),
    followRequested: author?.followRequested === true,
    isPrivate: author?.isPrivate === true,
    isMine: post.authorId === me,
    imageCount: images.length,
    hasPoll: Boolean(post.poll),
    poll: post.poll
      ? { id: post.poll.id, options: post.poll.options.map((option) => ({ id: option.id, label: option.label })) }
      : null,
    carouselIndex: carousel.get(post.id) ?? 1,
    carouselCount: Math.max(images.length, 1),
  }
}

function clickInPost(postId: string, selector: string): void {
  const root = document.querySelector(`[data-voice-post="${CSS.escape(postId)}"]`)
  root?.querySelector<HTMLElement>(selector)?.click()
}

const feed: FeedVoiceSurface = {
  get focused() {
    return toFocused(currentFeedPost())
  },
  moveFocus(delta) {
    if (postFromPath()) return null
    const posts = feedPosts()
    if (!posts.length) return null
    const next = feedCursor + delta
    if (next < 0 || next >= posts.length) return null
    feedCursor = next
    const post = posts[feedCursor]
    if (!post) return null
    scrollPost(post.id)
    return toFocused(post)
  },
  toggleLike: (postId) => attempt(() => useStore.getState().toggleLike(postId)),
  toggleRepost: (postId) => attempt(() => useStore.getState().toggleRepost(postId)),
  toggleSave: (postId) => attempt(() => useStore.getState().toggleSave(postId)),
  refresh: () => attempt(() => useStore.getState().refreshFeed()),
  openMore(postId) {
    moreOpen = true
    clickInPost(postId, '[aria-label="Ещё"]')
  },
  closeMore() {
    moreOpen = false
  },
  get moreOpen() {
    return moreOpen
  },
  markInterested(authorId) {
    useStore.getState().markInterested(authorId)
  },
  hidePost(postId) {
    useStore.getState().hidePost(postId)
  },
  hideAuthor(authorId) {
    useStore.getState().hideAuthor(authorId)
  },
  restrictAuthor(authorId) {
    useStore.getState().restrictAuthor(authorId)
  },
  async blockAuthor(authorId) {
    const result = await useStore.getState().blockAuthor(authorId)
    return result.ok ? ok() : bad(result.error || 'Не удалось заблокировать')
  },
  async reportPost(postId, reason) {
    const result = await useStore.getState().reportPost(postId, reason)
    return result.ok ? ok() : bad(result.error || 'Не удалось отправить жалобу')
  },
  async follow(userId) {
    const result = await useStore.getState().followUser(userId)
    return result.ok ? ok({ requested: result.error?.includes('запрос') }) : bad(result.error || 'Не удалось подписаться')
  },
  async unfollow(userId) {
    const result = await useStore.getState().unfollowUser(userId)
    return result.ok ? ok() : bad(result.error || 'Не удалось отписаться')
  },
  async muteAuthor(authorId) {
    if (!isApiMode()) return bad(API_ONLY)
    await apiMuteUser(authorId)
    return ok()
  },
  async archivePost(postId) {
    if (!isApiMode()) return bad(API_ONLY)
    const post = useStore.getState().posts.find((item) => item.id === postId)
    const type = post?.image || post?.images?.length ? 'photo' : 'post'
    await apiAddArchive({ type, ref_id: postId, title: post?.text?.slice(0, 80) })
    return ok()
  },
  async quoteRepost(postId, quoteText) {
    if (!isApiMode()) return bad(API_ONLY)
    await apiQuoteRepost(postId, quoteText)
    return ok()
  },
  async votePoll(pollId, optionId) {
    if (!isApiMode()) return bad(API_ONLY)
    await apiVotePoll(pollId, optionId)
    return ok()
  },
  deletePost: (postId) => attempt(() => useStore.getState().deletePost(postId)),
  stepCarousel(delta) {
    const post = currentFeedPost()
    if (!post) return { ok: false, reason: 'none' }
    const images = post.images?.length ? post.images : post.image ? [post.image] : []
    if (images.length <= 1) return { ok: false, reason: 'none' }
    const current = carousel.get(post.id) ?? 1
    const next = current + delta
    if (next < 1) return { ok: false, reason: 'start' }
    if (next > images.length) return { ok: false, reason: 'end' }
    carousel.set(post.id, next)
    return { ok: true, index: next }
  },
  async copyPostLink(postId) {
    const url = `${window.location.origin}/app/p/${encodeURIComponent(postId)}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      return ok({ copiedFallback: true })
    }
    return ok()
  },
  openShare(postId) {
    shareOpen = true
    clickInPost(postId, '[aria-label="Поделиться"]')
  },
}

type MarketBridge = {
  setQuery: (query: string) => void
  setCategory: (category: string) => void
  setCity: (city: string) => void
  setPriceFrom: (value: string) => void
  setPriceTo: (value: string) => void
  setSort: (sort: 'default' | 'new' | 'cheap' | 'expensive') => void
  setSellerType: (seller: 'all' | 'private' | 'company') => void
  resetFilters: () => void
  listings: () => MarketListing[]
  messageSeller: (id: string) => Promise<ActionResult>
  archiveListing: (id: string) => Promise<ActionResult>
  demoPay: (id: string) => Promise<ActionResult>
  createAd: (input: { title: string; price: number; city: string }) => Promise<ActionResult>
  reviewOpen: () => boolean
  setReviewRating: (rating: number) => void
  setReviewBody: (text: string) => void
  submitReview: () => Promise<ActionResult>
  closeReview: () => void
  focusListing: (id: string) => void
}

type ProfileBridge = {
  setTab: (tab: ProfileTab) => void
  openAvatar: () => void
  closeAvatar: () => void
  openShare: () => void
  closeShare: () => void
  follow: () => Promise<ActionResult>
  unfollow: () => Promise<ActionResult>
  sendAttention: () => Promise<ActionResult>
  addCloseFriend: () => Promise<ActionResult>
  removeCloseFriend: () => Promise<ActionResult>
  archiveProfile: () => Promise<ActionResult>
  reportProfile: () => Promise<ActionResult>
}

type ComposeBridge = {
  text: () => string
  tags: () => string
  imageCount: () => number
  assistHint: () => string
  setText: (text: string) => void
  setTags: (tags: string) => void
  removeImage: (index: number | 'last') => boolean
  requestPhotoPicker: () => void
  requestAssist: (text: string) => Promise<ActionResult>
  applySuggestion: (suggestion: string) => void
  submit: () => Promise<ActionResult>
  cancel: () => void
  beginVoiceReply: () => void
  isReply: () => boolean
}

let marketBridge: { current: MarketBridge } | null = null
let profileBridge: { current: ProfileBridge } | null = null
let composeBridge: { current: ComposeBridge } | null = null
let marketCursor = 0

export function useVoiceMarketBridge(api: MarketBridge) {
  const ref = useRef(api)
  ref.current = api
  useEffect(() => {
    marketBridge = ref
    return () => {
      if (marketBridge === ref) marketBridge = null
    }
  }, [])
}

export function useVoiceProfileBridge(api: ProfileBridge) {
  const ref = useRef(api)
  ref.current = api
  useEffect(() => {
    profileBridge = ref
    return () => {
      if (profileBridge === ref) profileBridge = null
    }
  }, [])
}

export function useVoiceComposeBridge(api: ComposeBridge) {
  const ref = useRef(api)
  ref.current = api
  useEffect(() => {
    composeBridge = ref
    return () => {
      if (composeBridge === ref) composeBridge = null
    }
  }, [])
}

function listingFromDom(): MarketListing[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-voice-listing]')).map((node) => ({
    id: node.getAttribute('data-voice-listing') || '',
    title: node.getAttribute('data-voice-title') || '',
    price: Number(node.getAttribute('data-voice-price') || 0),
    category: node.getAttribute('data-voice-category') || '',
    city: node.getAttribute('data-voice-city') || '',
    description: node.getAttribute('data-voice-description') || '',
  }))
}

function marketList(): MarketListing[] {
  return marketBridge?.current.listings() ?? listingFromDom()
}

const market: MarketVoiceSurface = {
  get focused() {
    const list = marketList()
    if (!list.length) return null
    if (marketCursor >= list.length) marketCursor = list.length - 1
    return list[marketCursor] ?? null
  },
  get count() {
    return marketList().length
  },
  get reviewOpen() {
    return marketBridge?.current.reviewOpen() ?? false
  },
  get reviewRating() {
    return 5
  },
  setQuery(query) {
    marketBridge?.current.setQuery(query)
  },
  setCategory(category) {
    marketBridge?.current.setCategory(category)
    marketCursor = 0
  },
  setCity(city) {
    marketBridge?.current.setCity(city)
  },
  setPriceFrom(value) {
    marketBridge?.current.setPriceFrom(value)
  },
  setPriceTo(value) {
    marketBridge?.current.setPriceTo(value)
  },
  setSort(sort) {
    marketBridge?.current.setSort(sort)
  },
  setSellerType(seller) {
    marketBridge?.current.setSellerType(seller)
  },
  resetFilters() {
    marketCursor = 0
    marketBridge?.current.resetFilters()
  },
  moveFocus(delta) {
    const list = marketList()
    const next = marketCursor + delta
    if (!list.length || next < 0 || next >= list.length) return null
    marketCursor = next
    const item = list[marketCursor]
    if (!item) return null
    marketBridge?.current.focusListing(item.id)
    document.querySelector(`[data-voice-listing="${CSS.escape(item.id)}"]`)?.scrollIntoView({ block: 'center' })
    return item
  },
  messageSeller: (id) => marketBridge?.current.messageSeller(id) ?? Promise.resolve(bad('Здесь пусто')),
  archiveListing: (id) => marketBridge?.current.archiveListing(id) ?? Promise.resolve(bad(API_ONLY)),
  demoPay: (id) => marketBridge?.current.demoPay(id) ?? Promise.resolve(bad(API_ONLY)),
  openPaymentUrl(url) {
    window.open(url, '_blank', 'noopener')
  },
  createAd: (input) => marketBridge?.current.createAd(input) ?? createLocalAd(input),
  setReviewRating(rating) {
    marketBridge?.current.setReviewRating(rating)
  },
  setReviewBody(text) {
    marketBridge?.current.setReviewBody(text)
  },
  submitReview: () => marketBridge?.current.submitReview() ?? Promise.resolve(bad('Лист отзыва закрыт')),
  closeReview() {
    marketBridge?.current.closeReview()
  },
}

async function createLocalAd(input: { title: string; price: number; city: string }): Promise<ActionResult> {
  if (isApiMode()) {
    await apiCreateMarketAd({ title: input.title, price: input.price, city: input.city })
    return ok()
  }
  const item: MarketItem = {
    id: `voice-ad-${Date.now()}`,
    title: input.title,
    price: input.price,
    description: '',
    image: '',
    category: 'Разное',
    city: input.city,
  }
  useStore.setState((state) => ({ market: [item, ...state.market] }))
  return ok()
}

function profileUser(): { user: User; isMe: boolean } | null {
  const state = useStore.getState()
  const me = state.currentUserId
  if (!me) return null
  const profileMatch = voicePath.match(/^\/app\/profile\/([^/]+)/)
  const usernameMatch = voicePath.match(/^\/app\/u\/([^/]+)/)
  const key = profileMatch?.[1] || usernameMatch?.[1]
  if (!key || voicePath === '/app/profile' || voicePath === '/app/profile/') {
    const self = state.users.find((user) => user.id === me)
    return self ? { user: self, isMe: true } : null
  }
  const decoded = decodeURIComponent(key)
  const user =
    state.users.find((item) => item.id === decoded) ||
    state.users.find((item) => item.username === decoded)
  if (!user) return null
  return { user, isMe: user.id === me }
}

function profileSnapshot(): ProfileSnapshot | null {
  const found = profileUser()
  if (!found) return null
  const state = useStore.getState()
  const { user, isMe } = found
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    bio: user.bio || '',
    about: user.about || '',
    services: user.services || '',
    followers: user.followers,
    following: user.following,
    isMe,
    isFollowing: state.followingIds.includes(user.id),
    followRequested: user.followRequested === true,
    isCloseFriend: closeFriends.has(user.id),
    avatarOpen,
    tab: profileTab,
    isPrivate: user.isPrivate === true,
  }
}

const profile: ProfileVoiceSurface = {
  get user() {
    return profileSnapshot()
  },
  setTab(tab) {
    profileTab = tab
    profileBridge?.current.setTab(tab)
  },
  follow: () => profileBridge?.current.follow() ?? Promise.resolve(bad('Здесь пусто')),
  unfollow: () => profileBridge?.current.unfollow() ?? Promise.resolve(bad('Здесь пусто')),
  sendAttention: () => profileBridge?.current.sendAttention() ?? Promise.resolve(bad(API_ONLY)),
  addCloseFriend: () => profileBridge?.current.addCloseFriend() ?? Promise.resolve(bad(API_ONLY)),
  removeCloseFriend: () => profileBridge?.current.removeCloseFriend() ?? Promise.resolve(bad(API_ONLY)),
  archiveProfile: () => profileBridge?.current.archiveProfile() ?? Promise.resolve(bad(API_ONLY)),
  reportProfile: () => profileBridge?.current.reportProfile() ?? Promise.resolve(bad(API_ONLY)),
  openShare() {
    shareOpen = true
    profileBridge?.current.openShare()
  },
  openAvatar() {
    avatarOpen = true
    profileBridge?.current.openAvatar()
  },
  closeAvatar() {
    avatarOpen = false
    profileBridge?.current.closeAvatar()
  },
}

const compose: ComposeVoiceSurface = {
  get open() {
    return voicePath.startsWith('/app/compose') || Boolean(composeBridge)
  },
  get isReply() {
    return voicePath.includes('reply=') || (composeBridge?.current.isReply() ?? false)
  },
  get text() {
    return composeBridge?.current.text() ?? ''
  },
  get tags() {
    return composeBridge?.current.tags() ?? composeTags
  },
  get imageCount() {
    return composeBridge?.current.imageCount() ?? 0
  },
  get assistHint() {
    return composeBridge?.current.assistHint() ?? assistHint
  },
  setText(text) {
    composeBridge?.current.setText(text)
  },
  setTags(tags) {
    composeTags = tags
    composeBridge?.current.setTags(tags)
  },
  removeImage(index) {
    return composeBridge?.current.removeImage(index) ?? false
  },
  requestPhotoPicker() {
    composeBridge?.current.requestPhotoPicker()
  },
  async requestAssist(text) {
    if (!isApiMode()) return bad(API_ONLY)
    const result = await apiComposeAssist(text)
    assistHint = result.suggestion || ''
    return ok({ suggestion: result.suggestion, message: result.message })
  },
  applySuggestion(suggestion) {
    assistHint = suggestion
    composeBridge?.current.applySuggestion(suggestion)
  },
  submit: () => composeBridge?.current.submit() ?? Promise.resolve(bad('Здесь пусто')),
  cancel() {
    composeBridge?.current.cancel()
  },
  beginVoiceReply() {
    composeBridge?.current.beginVoiceReply()
  },
  prepareReply() {
    /* navigation already carries ?reply= */
  },
}

const share: ShareVoiceSurface = {
  get open() {
    return shareOpen || Boolean(document.querySelector('[data-share-sheet]'))
  },
  async copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      return ok()
    } catch {
      return ok({ copiedFallback: true })
    }
  },
  openTelegram() {
    const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}`
    window.open(url, '_blank', 'noopener')
  },
  async systemShare() {
    if (!navigator.share) return this.copyLink()
    try {
      await navigator.share({ url: window.location.href })
      return ok()
    } catch {
      return bad('Не удалось поделиться')
    }
  },
  close() {
    shareOpen = false
    profileBridge?.current.closeShare()
    document.querySelector<HTMLElement>('[data-share-sheet] [aria-label="Закрыть"]')?.click()
  },
}

export function voiceSurfaces(): {
  feed: FeedVoiceSurface
  compose: ComposeVoiceSurface
  market: MarketVoiceSurface
  profile: ProfileVoiceSurface
  share: ShareVoiceSurface
} {
  return { feed, compose, market, profile, share }
}

export const profileVoiceActions = {
  rememberCloseFriend(id: string, on: boolean) {
    if (on) closeFriends.add(id)
    else closeFriends.delete(id)
  },
  apiAddCloseFriend,
  apiRemoveCloseFriend,
  apiSendProfileAttention,
  apiReportUser,
  apiAddArchive,
}
