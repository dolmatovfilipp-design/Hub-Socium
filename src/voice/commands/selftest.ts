import { phase4VoiceCommands, runVoiceCommand, screenFromRoute, parseMarketAd } from './index.ts'
import type {
  ActionResult,
  ComposeVoiceSurface,
  FeedVoiceSurface,
  FocusedPost,
  MarketListing,
  MarketVoiceSurface,
  ProfileSnapshot,
  ProfileVoiceSurface,
  ShareVoiceSurface,
  VoiceCommandContext,
  VoiceScreen,
  VoiceSession,
} from './types.ts'

const ok = async (): Promise<ActionResult> => ({ ok: true })

interface World {
  calls: string[]
  ctx: VoiceCommandContext
  posts: FocusedPost[]
  session: VoiceSession
}

function postTemplate(id: string, text: string): FocusedPost {
  return {
    id,
    authorId: 'author-1',
    authorName: 'Анна',
    authorUsername: 'anna',
    text,
    createdAt: new Date().toISOString(),
    likedByMe: false,
    repostedByMe: false,
    saved: false,
    following: false,
    followRequested: false,
    isPrivate: false,
    isMine: false,
    imageCount: 2,
    hasPoll: true,
    poll: {
      id: 'poll-1',
      options: [
        { id: 'o1', label: 'Да' },
        { id: 'o2', label: 'Нет' },
      ],
    },
    carouselIndex: 1,
    carouselCount: 2,
  }
}

export function createVoiceTestWorld(screen: VoiceScreen = 'feed'): World {
  const calls: string[] = []
  const posts = [postTemplate('p1', 'Привет из ленты'), postTemplate('p2', 'Второй')]
  let focus = 0
  let carousel = 1
  const listings: MarketListing[] = [
    {
      id: 'ad1',
      title: 'Велосипед',
      price: 15000,
      category: 'Транспорт',
      city: 'Казань',
      description: '',
    },
    {
      id: 'ad2',
      title: 'Стол',
      price: 4000,
      category: 'Для дома',
      city: 'Москва',
      description: '',
    },
  ]
  let marketFocus = 0
  const profileUser: ProfileSnapshot = {
    id: 'user-2',
    name: 'Олег',
    username: 'oleg',
    bio: 'Делаю полки',
    about: 'Мастерская',
    services: 'Сборка',
    followers: 3,
    following: 1,
    isMe: false,
    isFollowing: false,
    followRequested: false,
    isCloseFriend: false,
    avatarOpen: false,
    tab: 'posts',
    isPrivate: false,
  }
  const feed: FeedVoiceSurface = {
    get focused() {
      return posts[focus] ?? null
    },
    moveFocus(delta) {
      const next = focus + delta
      if (next < 0 || next >= posts.length) return null
      focus = next
      calls.push(`focus:${focus}`)
      return posts[focus]
    },
    toggleLike: async (id) => {
      calls.push(`like:${id}`)
      const post = posts.find((item) => item.id === id)
      if (post) post.likedByMe = !post.likedByMe
      return ok()
    },
    toggleRepost: async (id) => {
      calls.push(`repost:${id}`)
      const post = posts.find((item) => item.id === id)
      if (post) post.repostedByMe = !post.repostedByMe
      return ok()
    },
    toggleSave: async (id) => {
      calls.push(`save:${id}`)
      const post = posts.find((item) => item.id === id)
      if (post) post.saved = !post.saved
      return ok()
    },
    refresh: async () => {
      calls.push('refresh')
      return ok()
    },
    openMore: (id) => calls.push(`more:${id}`),
    closeMore: () => calls.push('more:close'),
    moreOpen: false,
    markInterested: (id) => calls.push(`interest:${id}`),
    hidePost: (id) => calls.push(`hidePost:${id}`),
    hideAuthor: (id) => calls.push(`hideAuthor:${id}`),
    restrictAuthor: (id) => calls.push(`restrict:${id}`),
    blockAuthor: async (id) => {
      calls.push(`block:${id}`)
      return ok()
    },
    reportPost: async (id, reason) => {
      calls.push(`reportPost:${id}:${reason}`)
      return ok()
    },
    follow: async (id) => {
      calls.push(`follow:${id}`)
      return ok()
    },
    unfollow: async (id) => {
      calls.push(`unfollow:${id}`)
      return ok()
    },
    muteAuthor: async (id) => {
      calls.push(`mute:${id}`)
      return ok()
    },
    archivePost: async (id) => {
      calls.push(`archivePost:${id}`)
      return ok()
    },
    quoteRepost: async (id) => {
      calls.push(`quote:${id}`)
      return ok()
    },
    votePoll: async (pollId, optionId) => {
      calls.push(`vote:${pollId}:${optionId}`)
      return ok()
    },
    deletePost: async (id) => {
      calls.push(`delete:${id}`)
      return ok()
    },
    stepCarousel: (delta) => {
      if (posts[focus].carouselCount === 0) return { ok: false, reason: 'none' }
      const next = carousel + delta
      if (next < 1) return { ok: false, reason: 'start' }
      if (next > posts[focus].carouselCount) return { ok: false, reason: 'end' }
      carousel = next
      calls.push(`photo:${carousel}`)
      return { ok: true, index: carousel }
    },
    copyPostLink: async (id) => {
      calls.push(`copyPost:${id}`)
      return ok()
    },
    openShare: (id) => {
      calls.push(`openShare:${id}`)
      share.open = true
    },
  }
  const compose: ComposeVoiceSurface = {
    open: false,
    isReply: false,
    text: '',
    tags: '',
    imageCount: 0,
    assistHint: '',
    setText: (text) => {
      compose.text = text
      calls.push(`text:${text}`)
    },
    setTags: (tags) => {
      compose.tags = tags
      calls.push(`tags:${tags}`)
    },
    removeImage: (index) => {
      calls.push(`removeImage:${index}`)
      if (compose.imageCount === 0) return false
      compose.imageCount -= 1
      return true
    },
    requestPhotoPicker: () => calls.push('photoPicker'),
    requestAssist: async () => {
      calls.push('assist')
      compose.assistHint = 'Короче и яснее'
      return { ok: true, suggestion: 'Короче и яснее' }
    },
    applySuggestion: (suggestion) => {
      calls.push(`apply:${suggestion}`)
      compose.text = suggestion
    },
    submit: async () => {
      calls.push('submit')
      return ok()
    },
    cancel: () => calls.push('cancel'),
    beginVoiceReply: () => calls.push('voiceReply'),
    prepareReply: (id) => {
      compose.open = true
      compose.isReply = true
      calls.push(`prepareReply:${id}`)
    },
  }
  const market: MarketVoiceSurface = {
    get focused() {
      return listings[marketFocus] ?? null
    },
    get count() {
      return listings.length
    },
    reviewOpen: false,
    reviewRating: 0,
    setQuery: (query) => calls.push(`query:${query}`),
    setCategory: (category) => calls.push(`category:${category}`),
    setCity: (city) => calls.push(`city:${city}`),
    setPriceFrom: (value) => calls.push(`priceFrom:${value}`),
    setPriceTo: (value) => calls.push(`priceTo:${value}`),
    setSort: (sort) => calls.push(`sort:${sort}`),
    setSellerType: (seller) => calls.push(`seller:${seller}`),
    resetFilters: () => calls.push('resetFilters'),
    moveFocus: (delta) => {
      const next = marketFocus + delta
      if (next < 0 || next >= listings.length) return null
      marketFocus = next
      calls.push(`marketFocus:${marketFocus}`)
      return listings[marketFocus]
    },
    messageSeller: async (id) => {
      calls.push(`messageSeller:${id}`)
      return ok()
    },
    archiveListing: async (id) => {
      calls.push(`archiveListing:${id}`)
      return ok()
    },
    demoPay: async (id) => {
      calls.push(`demoPay:${id}`)
      return { ok: true, confirmationUrl: 'https://pay.example/demo' }
    },
    openPaymentUrl: (url) => calls.push(`payUrl:${url}`),
    createAd: async (input) => {
      calls.push(`createAd:${input.title}:${input.price}:${input.city}`)
      return ok()
    },
    setReviewRating: (rating) => {
      market.reviewRating = rating
      calls.push(`rating:${rating}`)
    },
    setReviewBody: (text) => calls.push(`reviewBody:${text}`),
    submitReview: async () => {
      calls.push('submitReview')
      return ok()
    },
    closeReview: () => {
      market.reviewOpen = false
      calls.push('closeReview')
    },
  }
  const profile: ProfileVoiceSurface = {
    user: profileUser,
    setTab: (tab) => {
      profileUser.tab = tab
      calls.push(`tab:${tab}`)
    },
    follow: async () => {
      calls.push('profileFollow')
      return ok()
    },
    unfollow: async () => {
      calls.push('profileUnfollow')
      return ok()
    },
    sendAttention: async () => {
      calls.push('attention')
      return ok()
    },
    addCloseFriend: async () => {
      calls.push('addClose')
      return ok()
    },
    removeCloseFriend: async () => {
      calls.push('removeClose')
      return ok()
    },
    archiveProfile: async () => {
      calls.push('archiveProfile')
      return ok()
    },
    reportProfile: async () => {
      calls.push('reportProfile')
      return ok()
    },
    openShare: () => {
      calls.push('profileShare')
      share.open = true
    },
    openAvatar: () => {
      profileUser.avatarOpen = true
      calls.push('avatarOpen')
    },
    closeAvatar: () => {
      profileUser.avatarOpen = false
      calls.push('avatarClose')
    },
  }
  const share: ShareVoiceSurface = {
    open: false,
    copyLink: async () => {
      calls.push('copyLink')
      return ok()
    },
    openTelegram: () => calls.push('telegram'),
    systemShare: async () => {
      calls.push('systemShare')
      return ok()
    },
    close: () => {
      share.open = false
      calls.push('shareClose')
    },
  }
  const ctx: VoiceCommandContext = {
    route: '/app',
    screen,
    insideApp: true,
    apiMode: true,
    slot: '',
    matchedPhrase: '',
    step: '',
    speak: () => undefined,
    navigate: (path) => calls.push(`nav:${path}`),
    toast: (text) => calls.push(`toast:${text}`),
    feed,
    compose,
    market,
    profile,
    share,
  }
  return { calls, ctx, posts, session: { pending: null, dictation: null, awaitingSlot: null } }
}

function hasCall(calls: string[], prefix: string): boolean {
  return calls.some((call) => call.startsWith(prefix))
}

async function say(world: World, utterance: string, isEnabled?: (id: string) => boolean) {
  const turn = await runVoiceCommand({
    commands: phase4VoiceCommands,
    utterance,
    ctx: world.ctx,
    session: world.session,
    isEnabled: isEnabled ? (command) => isEnabled(command.id) : undefined,
  })
  world.session = turn.session
  return turn
}

export async function runVoiceCommandSelfTest(): Promise<string[]> {
  const failures: string[] = []
  const check = (name: string, condition: boolean, detail?: string) => {
    if (!condition) failures.push(detail ? `${name}: ${detail}` : name)
  }

  check('catalog size', phase4VoiceCommands.length === 78, String(phase4VoiceCommands.length))
  const ids = new Set(phase4VoiceCommands.map((command) => command.id))
  check('unique ids', ids.size === phase4VoiceCommands.length)
  for (const command of phase4VoiceCommands) {
    check(`${command.id} phrases`, command.phrases.length > 0)
    check(`${command.id} handler`, typeof command.handler === 'function')
    if (command.confirmation === 'dangerous') {
      check(`${command.id} preset`, command.preset === 'none' && command.inReadingSet === false)
    }
  }

  check('route feed', screenFromRoute('/app') === 'feed')
  check('route market', screenFromRoute('/app', { marketTab: true }) === 'market')
  check('route compose', screenFromRoute('/app/compose?reply=1') === 'compose')
  check('route post', screenFromRoute('/app/p/abc') === 'post')
  check('route profile', screenFromRoute('/app/u/anna') === 'profile')
  check('route edit', screenFromRoute('/app/profile/edit') === 'other')

  const ad = parseMarketAd('Велосипед 12000 Казань')
  check(
    'parse ad',
    'title' in ad && ad.title === 'велосипед' && ad.price === 12000 && ad.city === 'Казань',
    JSON.stringify(ad),
  )

  return failures.concat(await runVoiceCommandScenarios())
}

async function expect(
  failures: string[],
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : 'error'}`)
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

export async function runVoiceCommandScenarios(): Promise<string[]> {
  const failures: string[] = []

  await expect(failures, 'no wake word', async () => {
    const world = createVoiceTestWorld()
    const turn = await say(world, 'хаб лайк')
    assert(turn.code === 'unrecognized', turn.spoken)
    assert(!hasCall(world.calls, 'like:'), world.calls.join(','))
  })

  await expect(failures, 'like and unlike', async () => {
    const world = createVoiceTestWorld()
    const liked = await say(world, 'лайк')
    assert(liked.spoken === 'Лайк поставлен', liked.spoken)
    assert(hasCall(world.calls, 'like:p1'), world.calls.join(','))
    const again = await say(world, 'нравится')
    assert(again.spoken === 'Лайк уже стоит', again.spoken)
    assert(world.calls.filter((call) => call.startsWith('like:')).length === 1, world.calls.join(','))
    const removed = await say(world, 'убери лайк')
    assert(removed.spoken === 'Лайк снят', removed.spoken)
    const missing = await say(world, 'сними лайк')
    assert(missing.spoken === 'Лайка нет', missing.spoken)
  })

  await expect(failures, 'scroll', async () => {
    const world = createVoiceTestWorld()
    const next = await say(world, 'следующий пост')
    assert(next.spoken === 'Следующий пост', next.spoken)
    assert(hasCall(world.calls, 'focus:1'), world.calls.join(','))
    const back = await say(world, 'выше')
    assert(back.spoken === 'Предыдущий пост', back.spoken)
    const edge = await say(world, 'предыдущий')
    assert(edge.spoken === 'Это первый пост', edge.spoken)
    await say(world, 'дальше')
    const end = await say(world, 'ниже')
    assert(end.spoken === 'Дальше постов нет', end.spoken)
  })

  await expect(failures, 'read post and open author', async () => {
    const world = createVoiceTestWorld()
    const read = await say(world, 'прочитай пост')
    assert(read.spoken.includes('Анна'), read.spoken)
    assert(read.spoken.includes('Привет из ленты'), read.spoken)
    assert(read.spoken.includes('В посте 2 фото'), read.spoken)
    assert(read.spoken.includes('В посте опрос'), read.spoken)
    const author = await say(world, 'открой автора')
    assert(author.spoken === 'Открываю профиль', author.spoken)
    assert(hasCall(world.calls, 'nav:/app/profile/author-1'), world.calls.join(','))
  })

  await expect(failures, 'comment dictation', async () => {
    const world = createVoiceTestWorld()
    const started = await say(world, 'комментарий')
    assert(started.spoken === 'Диктуйте комментарий', started.spoken)
    assert(hasCall(world.calls, 'prepareReply:p1'), world.calls.join(','))
    assert(!hasCall(world.calls, 'submit'), world.calls.join(','))
    await say(world, 'Красивый пост')
    assert(world.ctx.compose.text === 'Красивый пост', world.ctx.compose.text)
    const ready = await say(world, 'готово')
    assert(ready.spoken === 'Опубликовать комментарий?', ready.spoken)
    assert(!hasCall(world.calls, 'submit'), world.calls.join(','))
    const sent = await say(world, 'да')
    assert(sent.spoken === 'Комментарий опубликован', sent.spoken)
    assert(hasCall(world.calls, 'submit'), world.calls.join(','))
  })

  await expect(failures, 'repost and share need yes', async () => {
    const world = createVoiceTestWorld()
    const ask = await say(world, 'репост')
    assert(ask.spoken === 'Сделать репост?', ask.spoken)
    assert(!hasCall(world.calls, 'repost:'), world.calls.join(','))
    const done = await say(world, 'да')
    assert(done.spoken === 'Репост сделан', done.spoken)
    assert(hasCall(world.calls, 'repost:p1'), world.calls.join(','))
    const shareAsk = await say(world, 'поделиться')
    assert(shareAsk.code === 'needs-confirmation', shareAsk.spoken)
    assert(!hasCall(world.calls, 'openShare:'), world.calls.join(','))
    const opened = await say(world, 'отправить')
    assert(opened.spoken === 'Открыт лист шаринга', opened.spoken)
    assert(world.ctx.share.open, 'sheet')
    const copied = await say(world, 'копировать ссылку')
    assert(copied.spoken === 'Ссылка скопирована', copied.spoken)
  })

  await expect(failures, 'dangerous feed actions', async () => {
    const world = createVoiceTestWorld()
    const block = await say(world, 'заблокируй')
    assert(block.spoken.includes('да, подтверждаю'), block.spoken)
    assert(!hasCall(world.calls, 'block:'), world.calls.join(','))
    const bare = await say(world, 'да')
    assert(bare.spoken.includes('да, подтверждаю'), bare.spoken)
    assert(!hasCall(world.calls, 'block:'), world.calls.join(','))
    const confirmed = await say(world, 'да, подтверждаю')
    assert(confirmed.spoken === 'Автор заблокирован', confirmed.spoken)
    assert(hasCall(world.calls, 'block:author-1'), world.calls.join(','))

    const report = await say(world, 'пожалуйся спам')
    assert(report.spoken.includes('да, подтверждаю'), report.spoken)
    assert(!hasCall(world.calls, 'reportPost:'), world.calls.join(','))
    await say(world, 'да')
    assert(!hasCall(world.calls, 'reportPost:'), world.calls.join(','))
    const filed = await say(world, 'Да, подтверждаю')
    assert(filed.spoken === 'Жалоба отправлена', filed.spoken)
    assert(hasCall(world.calls, 'reportPost:p1:spam'), world.calls.join(','))
  })

  await expect(failures, 'delete only own post', async () => {
    const world = createVoiceTestWorld()
    const denied = await say(world, 'удали пост')
    assert(denied.spoken === 'Удалить можно только свой пост', denied.spoken)
    world.posts[0].isMine = true
    const ask = await say(world, 'удали пост')
    assert(ask.spoken.includes('да, подтверждаю'), ask.spoken)
    assert(!hasCall(world.calls, 'delete:'), world.calls.join(','))
    const gone = await say(world, 'да, подтверждаю')
    assert(gone.spoken === 'Публикация удалена', gone.spoken)
    assert(hasCall(world.calls, 'delete:p1'), world.calls.join(','))
  })

  await expect(failures, 'empty and wrong screen', async () => {
    const empty = createVoiceTestWorld()
    empty.posts.splice(0, empty.posts.length)
    const like = await say(empty, 'лайк')
    assert(like.spoken === 'Здесь пусто', like.spoken)
    const market = createVoiceTestWorld('market')
    const wrong = await say(market, 'лайк')
    assert(wrong.spoken.startsWith('Эта команда здесь не действует'), wrong.spoken)
    assert(!hasCall(market.calls, 'like:'), market.calls.join(','))
  })

  await expect(failures, 'disabled command', async () => {
    const world = createVoiceTestWorld()
    const turn = await say(world, 'лайк', (id) => id !== 'F-03')
    assert(turn.spoken === 'Команда выключена в управлении интерфейсом', turn.spoken)
    assert(!hasCall(world.calls, 'like:'), world.calls.join(','))
  })

  await expect(failures, 'outside app', async () => {
    const world = createVoiceTestWorld()
    world.ctx.insideApp = false
    const turn = await say(world, 'лайк')
    assert(turn.code === 'outside-app', turn.code ?? '')
    assert(!hasCall(world.calls, 'like:'), world.calls.join(','))
  })

  await expect(failures, 'market commands', async () => {
    const world = createVoiceTestWorld('market')
    const category = await say(world, 'категория электроника')
    assert(category.spoken === 'Категория Электроника', category.spoken)
    await say(world, 'город Казань')
    assert(hasCall(world.calls, 'city:Казань'), world.calls.join(','))
    await say(world, 'сначала дешёвые')
    assert(hasCall(world.calls, 'sort:cheap'), world.calls.join(','))
    const read = await say(world, 'прочитай объявление')
    assert(read.spoken.includes('Велосипед'), read.spoken)
    assert(read.spoken.includes('Транспорт'), read.spoken)
    assert(read.spoken.includes('Казань'), read.spoken)
    const next = await say(world, 'дальше объявление')
    assert(next.spoken === 'Следующее объявление', next.spoken)
    const pay = await say(world, 'оплати')
    assert(pay.spoken.includes('да, подтверждаю'), pay.spoken)
    assert(!hasCall(world.calls, 'demoPay:'), world.calls.join(','))
    await say(world, 'да')
    assert(!hasCall(world.calls, 'demoPay:'), world.calls.join(','))
    await say(world, 'да, подтверждаю')
    assert(hasCall(world.calls, 'demoPay:ad2'), world.calls.join(','))
    assert(hasCall(world.calls, 'payUrl:https://pay.example/demo'), world.calls.join(','))
  })

  await expect(failures, 'publish listing after dictation', async () => {
    const world = createVoiceTestWorld('market')
    const started = await say(world, 'опубликуй объявление')
    assert(started.spoken.includes('название'), started.spoken)
    assert(!hasCall(world.calls, 'createAd:'), world.calls.join(','))
    await say(world, 'готово')
    assert(!hasCall(world.calls, 'createAd:'), 'created too early')
    await say(world, 'Велосипед 12000 Казань')
    const asked = await say(world, 'готово')
    assert(asked.code === 'needs-confirmation', asked.spoken)
    const published = await say(world, 'да')
    assert(published.spoken === 'Объявление опубликовано', published.spoken)
    assert(hasCall(world.calls, 'createAd:велосипед:12000:Казань'), world.calls.join(','))
  })

  await expect(failures, 'profile commands', async () => {
    const world = createVoiceTestWorld('profile')
    const read = await say(world, 'прочитай профиль')
    assert(read.spoken.includes('Олег'), read.spoken)
    assert(read.spoken.includes('@oleg'), read.spoken)
    assert(read.spoken.includes('Делаю полки'), read.spoken)
    const tab = await say(world, 'ответы')
    assert(tab.spoken === 'Ответы', tab.spoken)
    assert(hasCall(world.calls, 'tab:replies'), world.calls.join(','))
    const follow = await say(world, 'подпишись')
    assert(follow.spoken === 'Подписка', follow.spoken)
    assert(hasCall(world.calls, 'profileFollow'), world.calls.join(','))
    const report = await say(world, 'пожалуйся на профиль')
    assert(report.spoken.includes('да, подтверждаю'), report.spoken)
    await say(world, 'да')
    assert(!hasCall(world.calls, 'reportProfile'), world.calls.join(','))
    await say(world, 'да, подтверждаю')
    assert(hasCall(world.calls, 'reportProfile'), world.calls.join(','))
  })

  await expect(failures, 'publish post', async () => {
    const world = createVoiceTestWorld('compose')
    world.ctx.compose.open = true
    world.ctx.compose.text = 'Черновик'
    const ask = await say(world, 'опубликовать')
    assert(ask.spoken === 'Опубликовать пост?', ask.spoken)
    assert(!hasCall(world.calls, 'submit'), world.calls.join(','))
    const sent = await say(world, 'да')
    assert(sent.spoken === 'Пост опубликован', sent.spoken)
    assert(hasCall(world.calls, 'submit'), world.calls.join(','))
  })

  await expect(failures, 'feed follow is not profile follow', async () => {
    const world = createVoiceTestWorld('feed')
    const follow = await say(world, 'подпишись')
    assert(follow.spoken === 'Подписка оформлена', follow.spoken)
    assert(hasCall(world.calls, 'follow:author-1'), world.calls.join(','))
    assert(!hasCall(world.calls, 'profileFollow'), world.calls.join(','))
  })

  return failures
}
