# Functionality audit — `combined-restore-ui` (live on gethub.online)

Read-only audit of the branch that is deployed. No application code was changed.

Severity:

- **broken** — a control the live user can reach does the wrong thing, or a save that looks successful has no effect.
- **stub** — the control or endpoint exists and is intentionally unfinished (toast, empty copy, redirect, or a response that is not the feature).
- **demo** — hardcoded sample people, posts, listings, or copy shown to a real signed-in user.
- **cosmetic** — leftover copy or a dead field that does not change what the live user can do.

Excluded on purpose: «Мои боты» and group calls.

## How `/v1` was compared

Frontend calls in `src/lib/api.ts` (and the two raw fetches in `src/lib/voice/ear.ts`) were matched to chi routes in `backend/internal/http/router.go`. Every path the UI calls has a matching method and route. There is no screen that calls a missing `/v1` endpoint.

The gaps are the other way around: a few routes answer with stub data, and a few built screens never mount, so their routes are never reached from the app.

Notification toggles, a private account, 18+ content, chat theme, and `hideStories` do persist and do change behavior. They are not listed below.

---

## Broken

### 1. Message requests never load

- **Section:** chats and messages
- **File:** `src/pages/MessageRequests.tsx` lines 87–140 (search and filter), 122–140 (static empty state), 133–137 (settings button)
- **What's wrong:** The screen is linked from Messages (`src/pages/Messages.tsx` line 277) and always renders «Пока нет запросов на переписку». `query` is stored and never applied. The unread filter only swaps the empty heading. «Настройки» opens the general settings list. The copy says the request setting can be turned off; nothing in settings does that. There is no message-request route under `/v1`.
- **Severity:** broken
- **Proposed fix:** Add a requests API (inbox messages from people you do not follow, plus unread). Bind search and the filter to that list. Point «Настройки» at a real «who can message me» control (see issue 11).

### 2. Hidden words are saved and never read

- **Section:** chats and messages
- **File:** `src/pages/MessageRequests.tsx` lines 184–229 (`HiddenWordsPrefs`); the only readers are lines 188 and 223
- **What's wrong:** «Сохранить» writes `localStorage` key `hub_hidden_words` and leaves. No chat, request, or moderation code reads the key. The «Скрыто» tab (lines 48–64) is a static empty state. There is no hidden-word route under `/v1`.
- **Severity:** broken
- **Proposed fix:** Persist the list on the account and filter incoming requests (and the «Скрыто» tab) with it. Until that exists, do not offer a save button.

### 3. Activity delete does not stick, and a card does not open the post

- **Section:** activity and notifications
- **File:** `src/pages/Activity.tsx` lines 167–175 (delete), 376–423 (API card)
- **What's wrong:** On the live API path, delete only filters React state and toasts «Удалено». Reload calls `GET /v1/activity` and the row is back. The router has `POST /v1/activity/read` and no delete. The API card links the actor profile and ignores `post_id` (`src/lib/api.ts` lines 734–744), so a like, reply, or mention cannot be opened.
- **Severity:** broken
- **Proposed fix:** Add `DELETE /v1/activity/{id}` (or hide-for-me) and call it from `confirmDelete`. Make the card a link to `/app` post or the comment when `post_id` is set.

### 4. Contact «verification» accepts the fixed code `000000`

- **Section:** auth
- **File:** `src/pages/Register.tsx` lines 15, 107–137, 167–169; `src/pages/EditProfile.tsx` lines 16, 240–260, 268–269
- **What's wrong:** «Отправить код» never calls the server. It toasts «Демо-код 000000 — без SMS/email в beta». Registration refuses to submit until `verified` is true, and profile save refuses a non-empty contact until `contactVerified` is true. Typing `000000` sets that flag. Live registration and profile edit therefore require a fake check.
- **Severity:** broken
- **Proposed fix:** Send a real SMS or email code (the email-verify endpoints in issue 5 are the server side for email). Remove the client-side `DEMO_CODE` gate.

### 5. Password reset and email verify return the code in JSON

- **Section:** auth, settings
- **File:** `backend/internal/auth/password_reset.go` lines 107–110; `src/pages/PasswordReset.tsx` lines 86–88 and 105–108; `backend/internal/users/email_verify.go` lines 91–98; `src/pages/Settings.tsx` lines 992–994; `src/store/useStore.ts` line 651
- **What's wrong:** When `SMTP_HOST` is unset and `HUB_HIDE_RESET_CODE` is not `1`, the API body includes `dev_code`. The reset screen prints «DEV-код», and settings toasts `Код: ${res.dev_code}`. Mail is not sent. Anyone who can call the reset endpoint can read the code. This is live behavior whenever SMTP is off.
- **Severity:** broken
- **Proposed fix:** Configure SMTP and stop putting the code in the JSON response in any deployed environment. Hide the DEV-код block unless a local-only flag is set.

### 6. Market filter count ignores real ads

- **Section:** market (reachable from the app; listed because the numbers are user-visible)
- **File:** `src/pages/Market.tsx` lines 96–99; `src/components/MarketFilterSheet.tsx` line 285
- **What's wrong:** The sheet button is «Показать {count}». `previewCount` filters only the zustand `market` array (the seed listings in issue 14), not `apiAds`. The count does not match the grid, which is `[...apiAds, ...market]`.
- **Severity:** broken
- **Proposed fix:** Count the same merged list the grid renders, after the seed listings are removed.

---

## Stub

### 7. Voice rooms and Nearby are built and then redirected away

- **Section:** calls (voice rooms), search / nearby
- **File:** `src/App.tsx` lines 305–306 and 309; `src/pages/VoiceRooms.tsx` lines 18–66 (list and create call `GET/POST /v1/voice-rooms`, then `navigate('/app/voice/${id}')`); `src/pages/Nearby.tsx` (calls `GET /v1/nearby` and `POST /v1/me/geo`)
- **What's wrong:** `/app/voice` and `/app/voice/:id` redirect to Messages. `/app/nearby` redirects to the feed. The pages are not imported by the router. Creating a room, if the page were opened, would land on the inbox. The Go routes themselves are real.
- **Severity:** stub
- **Proposed fix:** Mount `VoiceRooms` and `Nearby` on those paths, or remove the pages and the voice/nearby commands until the product wants them. Group calls stay excluded.

### 8. Drafts screen is unreachable

- **Section:** posts
- **File:** `src/App.tsx` line 281; `src/pages/Drafts.tsx` lines 15–29 (`apiListDrafts` / `apiPublishDraft` → `GET /v1/me/drafts`, `POST /v1/posts/{id}/publish`)
- **What's wrong:** `/app/drafts` redirects to Settings. Nothing in the app links to `Drafts`. Scheduled and draft posts have a backend and no screen.
- **Severity:** stub
- **Proposed fix:** Route `/app/drafts` to `Drafts` and add an entry from the composer or profile. Or drop the redirect once a real entry exists.

### 9. Music is an empty «soon» page, and the nav toggle cannot enable it

- **Section:** settings (nav), voice
- **File:** `src/pages/Music.tsx` lines 5–33; `src/lib/navPrefs.ts` line 118; `src/lib/voice/match.ts` line 28
- **What's wrong:** The page title is «Музыка» and the body is «Скоро здесь будет музыка». `sanitize` forces `enableMusic: false`, so «Панель навигации» cannot show the tab the empty state tells the user to enable. The voice phrase «музыка» still navigates to `/app/music` and says «Музыка пока недоступна».
- **Severity:** stub
- **Proposed fix:** Keep the route out of voice targets until there is a catalog. Either honor the nav toggle or remove the music row and the empty-state sentence about it.

### 10. Help has no support destination

- **Section:** settings
- **File:** `src/pages/Settings.tsx` lines 762–772
- **What's wrong:** «Справка» has one real link (the privacy legal page) and the line «Справка и поддержка пока недоступны.»
- **Severity:** stub
- **Proposed fix:** Link a real help or support destination, or remove the section until it exists.

### 11. Privacy «Сообщения» opens the inbox

- **Section:** settings
- **File:** `src/pages/Settings.tsx` lines 747–751; unused model fields `src/types/index.ts` lines 114–120 and `src/data/seed.ts` lines 539–547 (`privacyAllowMessages`, `privacyShowActivity`, `notificationsLikes`, `notificationsFollows`, `notificationsMessages`, `notificationsMentions`)
- **What's wrong:** The row does not change who can message the account. `privacyAllowMessages` is never read. The live notification screen uses `PUT /v1/me/notification-prefs` instead, and those prefs are applied by `backend/internal/push/service.go`. The leftover `AppSettings` flags have no UI and no effect.
- **Severity:** stub
- **Proposed fix:** Replace the row with the real message-request control from issue 1. Delete the unused `AppSettings` fields.

### 12. «Интересует», «Не интересует», hide, and restrict stay on this device

- **Section:** posts, feed
- **File:** `src/components/PostMoreSheet.tsx` lines 271–316; `src/store/useStore.ts` lines 886–919 and 1438–1443; feed filter `src/pages/Feed.tsx` lines 70–91
- **What's wrong:** These four actions only update zustand (persisted in localStorage). They do not call `/v1`. «Интересует» toasts «Будем показывать больше похожего» and only sorts that author first in the local list. «Не интересует» hides that post id on this browser. «Скрыть пользователя» and «Установить ограничения» do the same thing: both ids are added to one muted set. Mute, block, report, and archive on the same sheet do call the API.
- **Severity:** stub
- **Proposed fix:** Send interest, hide, and restrict to the account (the mute route already exists for «Скрыть из ленты»). Give restrict a real effect (comments or DMs). Change the interest toast so it does not claim a server ranking change.

### 13. «Демо-оплата» and the YooKassa demo route

- **Section:** market, voice
- **File:** `src/pages/Market.tsx` lines 340–364; `backend/internal/payments/yookassa.go` lines 25–56; `backend/internal/http/router.go` line 243; voice command `src/voice/commands/market.ts` around line 240
- **What's wrong:** Every listing has «Демо-оплата». Without YooKassa keys the handler returns `ok: true` and a message that nothing was charged. With keys, checkout metadata is still `hub_demo: true` and the description is prefixed `[DEMO]`. The button is on the live market.
- **Severity:** stub
- **Proposed fix:** Hide the button until a non-demo checkout exists. Do not return `ok: true` for a payment that did not start.

### 14. Compose assist returns `{disabled: true}` when no LLM key is set

- **Section:** posts
- **File:** `backend/internal/assist/service.go` lines 47–54; button `src/components/ComposeSheet.tsx` lines 438–461; client `src/lib/api.ts` lines 1874–1878
- **What's wrong:** «Помочь с текстом» calls `POST /v1/assist/compose`. With neither OpenAI nor YandexGPT configured, the handler responds 200 with `disabled: true` and the UI toasts the key hint. The route exists; the feature does not run.
- **Severity:** stub
- **Proposed fix:** Hide the button when `GET` features (or the compose response) says the model is off, and configure a key on the live server if the button should stay.

### 15. Transcription and translation are off unless server keys are set

- **Section:** transcription and translation, chats
- **File:** `backend/internal/chat/transcript.go` lines 66–86; `backend/internal/chat/translate.go` lines 68–70; voice ear `src/lib/voice/ear.ts` lines 48–72 and 163–181
- **What's wrong:** The routes are real (`GET /v1/features`, transcript, translate, `GET /v1/voice/status`, `POST /v1/voice/transcribe`). Features reports `transcribe` / `translate` false when `STTURL` or the translator is empty, and the chat hides the buttons in that case. A direct call returns 503 «Сервис расшифровки не настроен» or «Перевод не настроен». Server ear stops with «Задайте ключи SpeechKit» when status is not ready. On a host without those keys the features are absent, not fake buttons.
- **Severity:** stub
- **Proposed fix:** Set SpeechKit / translator env on the live host, or leave the buttons hidden. No route change is required.

### 16. `POST /v1/media/presign` returns stub S3 URLs

- **Section:** posts / media
- **File:** `backend/internal/http/router.go` lines 450–467
- **What's wrong:** The handler always returns `https://s3.stub.local/...` and `https://cdn.stub.local/...` with `X-Amz-Signature=stub`. The app uploads through `POST /v1/media/upload` (`src/lib/api.ts` line 447) and does not call presign. A client that did would upload nowhere.
- **Severity:** stub
- **Proposed fix:** Implement presign against the real bucket, or remove the route until then.

### 17. Vision status is a stub message

- **Section:** moderation (no screen calls it)
- **File:** `backend/internal/mod/service.go` lines 208–218; route `backend/internal/http/router.go` line 237
- **What's wrong:** `GET /v1/mod/vision/status` returns `enabled: false` and «сейчас только ручная очередь жалоб» until `YANDEX_VISION_API_KEY` is set. Even with a key, the message says the hook is «готов к подключению», not running. No frontend caller was found.
- **Severity:** stub
- **Proposed fix:** Wire vision into upload or report, or drop the route from the public API.

### 18. Parental control is a local PIN and a paragraph

- **Section:** settings
- **File:** `src/pages/Settings.tsx` lines 1306–1388; `src/lib/parental.ts` lines 1–8; `syncParental` at `src/pages/Settings.tsx` lines 307–314
- **What's wrong:** The screen says «Полный семейный контроль появится позже». The PIN is `window.prompt` plus `localStorage` (`hub_parental_v1`), so it does not follow the account to another device. `ageGateNote` only renders the paragraph at lines 1385–1388. Enabling the toggle does call `PUT /v1/me/content-prefs` (`parental_enabled`), and that flag is what blocks 18+ in settings. The PIN itself is not the server control.
- **Severity:** stub
- **Proposed fix:** Store the PIN hash on the account if the lock should survive a new browser. Keep the «позже» copy until family controls exist, and do not present `ageGateNote` as a feed gate.

### 19. Backend routes with no UI caller

- **Section:** API
- **File:** `backend/internal/http/router.go` — `POST /v1/me/consent` (line 144, duplicate of `/users/me/consent`), `GET /v1/polls/{id}` (line 172), `POST /v1/conversations/{id}/delivered` (line 217), `DELETE /v1/users/{id}/follow-request` (line 255)
- **What's wrong:** These routes are implemented and unused by `src/lib/api.ts`. They are not stub payloads (except presign and vision, issues 16 and 17). Listed so the route diff is complete.
- **Severity:** stub
- **Proposed fix:** Call them where the product needs delivery receipts, poll refresh, and cancel-follow-request, or leave them as API-only.

---

## Demo

### 20. Live market mixes seed listings into real ads

- **Section:** market
- **File:** `src/data/seed.ts` lines 268–413 (`seedMarket`: BMW X5, studio, UI/UX job, cleaning, scarf, and further lots; sellers `anna_k` / `oleg_msk`, ids `u2` / `u5`; several descriptions say «Демо»); `src/store/useStore.ts` line 361 and `partialize` line 1434 (`market` is kept in API mode); `src/pages/Market.tsx` lines 91–94 and 110–128
- **What's wrong:** The grid is API ads concatenated with `seedMarket`. Badges «Хит» and «Рядом» are hardcoded on those rows. «Написать продавцу» calls `apiCreateConversation({ username })`. `anna_k` and `oleg_msk` are not live users, so the button fails for every seed row. Seed posts and messages in the same store are cleared for API mode before the shell renders; market is the list that is not cleared.
- **Severity:** demo
- **Proposed fix:** In API mode, render `apiAds` only and stop persisting `market`. Drop the seed sellers from the grid.

### 21. Database seed writes demo people, posts, DMs, a clip, and a channel

- **Section:** feed, chats, activity, clips, groups and channels
- **File:** `backend/cmd/api/main.go` lines 111–112 (runs when embedded, `SEED_DEMO=1`, or `-seed-only`) and lines 354–478
- **What's wrong:** The seed inserts demo user `филипп` / `demo`, a welcome post «Демо-пост», peer posts, DMs («Привет! Как тебе Get Hub?», «Завтра кофе?»), activity rows («Супер пост!», «@филипп смотри»), a clip captioned «Демо-клип Get Hub» pointing at `/demo-clip.mp4` (`public/demo-clip.mp4`), and channel slug `hub-demo` titled «Get Hub Демо» with a sample community post. If the live database was seeded this way, those rows are real records other users can see. This audit did not query production, so treat this as code that will show demo data whenever that seed has run.
- **Severity:** demo
- **Proposed fix:** Do not run `seedDemo` against the live database. Remove already-seeded demo posts, DMs, activities, the clip, and `hub-demo` if they are present.

### 22. Activity subtitles are canned

- **Section:** activity
- **File:** `src/pages/Activity.tsx` lines 37–43 and 410
- **What's wrong:** Every like is «На основе ваших подписок», every repost is «Рекомендуемая публикация», every reply is «Пропущенная переписка». The line is not derived from the event.
- **Severity:** demo
- **Proposed fix:** Use the event type label only, or a subtitle taken from `meta` / the post.

### 23. Legal operator and contact are placeholders

- **Section:** settings / legal (linked from Help)
- **File:** `src/pages/Legal.tsx` lines 66–77 and 273
- **What's wrong:** The privacy policy is marked as a draft. The operator block is a TODO for the legal name, OGRN, and INN. The contact shown to users is `privacy@hub.local`.
- **Severity:** demo
- **Proposed fix:** Replace the operator block and the mailbox before the draft banner comes off.

---

## Cosmetic

### 24. Local-only toasts («при подключении к серверу»)

- **Section:** stories, groups, chats
- **File:** `src/components/StoriesBar.tsx` lines 142–147 (inside `if (!isApiMode())`); `src/pages/GroupSettings.tsx` lines 249 and 276 and 301 (inside `if (!isApiMode())`); `src/pages/Chat.tsx` lines 1557 (`if (api)` returns the live chat) and 2591–2646 (local menus); `src/pages/Messages.tsx` lines 429–432 (local «Избранное» toast; the API branch uses `GET /v1/conversations/saved`)
- **What's wrong:** Add story, invite, leave group, chat search, 1:1 calls, read receipts, reply, react, forward, pin, archive, delete, media, disappearing messages, and voice notes toast instead of running. On gethub.online `isApiMode()` is true, so these branches do not render. The API chat implements the same actions against `/v1`. Group-call toasts are excluded.
- **Severity:** cosmetic
- **Proposed fix:** Leave them for the offline demo, or delete the local menus so a mis-set `VITE_USE_API` cannot ship a toast-only chat.

### 25. Login demo hint is dev-only

- **Section:** auth
- **File:** `src/pages/Login.tsx` lines 56–60
- **What's wrong:** «Демо: любые правдоподобные данные… филипп / demo» renders only when `import.meta.env.DEV` is true. A production Vite build does not show it. The demo account still exists if issue 21's seed ran.
- **Severity:** cosmetic
- **Proposed fix:** No live change. Remove the hint if dev builds are ever deployed.

### 26. Registration and profile edit show the demo code on screen

- **Section:** auth, profile
- **File:** `src/pages/Register.tsx` lines 358–363; `src/pages/EditProfile.tsx` lines 535–566
- **What's wrong:** After «Код», a live amber banner says SMS and email are not sent and prints `000000`. A successful check then says «Контакт отмечен (демо)». The functional break is issue 4; this is the copy the user sees.
- **Severity:** cosmetic
- **Proposed fix:** Remove the banner and the «(демо)» line when a real code is sent.

### 27. Password reset always mentions a DEV code

- **Section:** auth
- **File:** `src/pages/PasswordReset.tsx` lines 86–88
- **What's wrong:** The first step always says «Без SMTP код придёт в ответе API (DEV)», including on the live site, before the user asks for a code. The leak itself is issue 5.
- **Severity:** cosmetic
- **Proposed fix:** Drop that sentence on any deployed build.

### 28. Legal pages render lawyer TODOs and «маркет (демо)»

- **Section:** settings / legal
- **File:** `src/pages/Legal.tsx` lines 24, 43–48, 211, 290–295
- **What's wrong:** Privacy and terms open with «Черновик для юриста». Orange boxes say «TODO (Филипп / юрист)» with the missing company fields. Terms say the age rule is «TODO для юриста». The offer says the product includes «маркет (демо)». The mailbox is issue 23.
- **Severity:** cosmetic
- **Proposed fix:** Keep the draft banner until the text is final, and do not render TODO boxes or «демо» in the offer body.

### 29. Success toasts are thrown away

- **Section:** app-wide
- **File:** `src/store/useStore.ts` lines 1310–1317
- **What's wrong:** `showToast` only displays text that matches an error pattern («ошибк», «не удалось», «неверн», and similar). «Сохранено», «Контакт подтверждён», and other success lines never appear. The comment says success toasts were removed on purpose.
- **Severity:** cosmetic
- **Proposed fix:** If a screen should confirm a save, show that confirmation. Leave the filter only for noisy debug strings.

### 30. «Отправить в СМС» has no recipient

- **Section:** settings (contacts)
- **File:** `src/pages/Settings.tsx` lines 1246–1248; `src/lib/contactsInvite.ts` lines 43–48
- **What's wrong:** The row sets `window.location` to `sms:?body=…` with an empty number. Phones may open an empty composer. Desktop browsers often do nothing. Invite copy and «Копировать ссылку» do work.
- **Severity:** cosmetic
- **Proposed fix:** Use the share sheet on desktop, and pass a chosen number into `smsInviteHref` on a phone.

### 31. «Скрыть все истории» does not follow the account

- **Section:** settings (stories), feed
- **File:** `src/pages/Settings.tsx` lines 706–709; `src/pages/Feed.tsx` lines 64 and 254
- **What's wrong:** The toggle works on this browser (zustand settings, persisted locally) and the feed hides the row. It is not sent to `/v1`, so another device still shows stories.
- **Severity:** cosmetic
- **Proposed fix:** Store the flag on the account next to the other content prefs.

### 32. Cart toast is dead and says payment is demo

- **Section:** market
- **File:** `src/store/useStore.ts` lines 1306–1308
- **What's wrong:** `addToCartToast` would say «оплата демо, без эквайринга». Nothing in the app calls it. There is no cart screen.
- **Severity:** cosmetic
- **Proposed fix:** Delete the action until a cart exists.

### 33. Chat theme list is a local fallback

- **Section:** settings (appearance)
- **File:** `src/pages/Settings.tsx` lines 796–812
- **What's wrong:** If `GET /v1/me/chat-prefs` has not returned themes yet, the dropdown shows 16 hardcoded gradients (Классика, Океан, Закат, and the rest). After the API responds, those names are replaced by the server list. The fallback is not a second theme catalog.
- **Severity:** cosmetic
- **Proposed fix:** Render the dropdown only after the prefs request returns.

### 34. Local seed profile calls itself a demo account

- **Section:** profile (local mode only)
- **File:** `src/data/seed.ts` line 14
- **What's wrong:** The bundled user bio is «Основатель Get Hub · демо-аккаунт». API mode clears persisted users before the shell renders, so this line is not the live profile. It is what a local demo session shows.
- **Severity:** cosmetic
- **Proposed fix:** Leave it for local demo, or drop the «демо-аккаунт» bio so a mis-set API flag cannot show it.

---

## Checked and not an issue

- Feed, stories, posts, 1:1 calls, channels, profile, search, meetups, bookmarks, blocks, reports, and the settings subsections for notifications, privacy (private account), appearance, security, archive, and 18+ call routes that exist and are not stub handlers.
- `hideStories` does hide the feed row on this browser. It is not synced to the account (issue 31).
- Seed posts in the zustand initial state are cleared by `apiSessionReset` before the authenticated shell renders, and `partialize` stores `posts: []` in API mode. They are not a live feed flash.
