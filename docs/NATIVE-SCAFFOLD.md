# Native app scaffold — store readiness (NO submit)

Phase 1 / PB-07 secondary path. **Readiness notes only — do not submit** to App Store or Google Play in Phase 1.

Primary push path for private beta: **Web Push** — see [`PUSH.md`](./PUSH.md).

Aligns with ARCHITECTURE: React Native + Expo, push via Expo Notifications → FCM / APNs.

---

## Gate

Scaffold / account prep may proceed in parallel with docs. **Production push + store submit** wait for PB-01 invite gate (or waive) and stable web MVP.

**Explicit: do not submit** builds to App Store Connect or Google Play Console during Phase 1 private beta.

---

## Expo app shell checklist

| Item | Status / notes |
|------|----------------|
| Expo project / app config (`app.json` / `app.config`) | ☐ scaffold when Code starts native track |
| iOS bundle id | Placeholder e.g. `ru.hub.app` — **confirm with Филипп** before any store record |
| Android applicationId | Same family placeholder — confirm with Филипп |
| Display name / slug | Hub (or product name) |
| Icons (1024 / adaptive) | ☐ |
| Splash screen | ☐ |
| Privacy policy URL | `https://<HUB_DOMAIN>/legal/privacy` — **blocked until DNS**; path already exists in web FE |
| Terms URL | `https://<HUB_DOMAIN>/legal/terms` |
| Permissions copy (notifications, photos if any) | Draft in store listings later — not Phase 1 submit |
| EAS project id | ☐ when Expo account ready |

---

## FCM + APNs ownership (**BLOCKED: Филипп**)

| Asset | Owner | Notes |
|-------|--------|--------|
| Apple Developer account | **Филипп** | APNs key / certs; bundle id registration |
| Google Play / Firebase (FCM) | **Филипп** | Firebase project; `google-services.json` / FCM server key or HTTP v1 SA — **not in git** |
| Expo / EAS account | Филипп or Code under his org | Credentials stay in EAS secrets |
| Push certificates rotation | Филипп + Code runbook | After first prod-like staging |

Release / Code cannot close cert provisioning without Филипп’s Apple/Google accounts.

---

## App Store / Google Play — readiness only

**Do not submit in Phase 1.**

Track for later (post–private beta / widen):

- [ ] Store listing drafts (RU): short/long description, screenshots, age rating
- [ ] Privacy nutrition labels / Data safety form aligned with `/legal/privacy`
- [ ] TestFlight / internal testing track — optional pre-submit; still not public
- [ ] RuStore (if targeted) — separate later checklist
- [ ] Review notes: invite-only / no Music / no market checkout

---

## Deep links

When DNS exists:

| | |
|--|--|
| Universal / App Links host | `https://<HUB_DOMAIN>/…` |
| Custom scheme (dev) | e.g. `hub://` — staging only |
| Path examples | `/app`, `/app/posts/:id`, `/legal/privacy` |

Blocked on **real domain + DNS** (same PB-01 blocker as TLS).

---

## Link from push spec

Implementation order: Web Push MVP ([`PUSH.md`](./PUSH.md)) → native `device_tokens` + Expo push worker → store submit **only after** Phase 1 go for native (out of current Phase 1 DoD).

## PWA assets (minimal, no store submit)

- `public/manifest.webmanifest` + `public/icons/icon-192.png` / `icon-512.png`
- Linked from `index.html` (`rel=manifest`, apple-touch-icon)
- Capacitor/Expo init intentionally deferred — see decision above (Web Push primary)
