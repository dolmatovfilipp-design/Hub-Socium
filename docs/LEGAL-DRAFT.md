# Legal / consent drafts (PB-03) — status for private beta

**Updated:** 2026-10-01 MSK  
**UI version string:** `beta-draft-2026-10-01` (`LEGAL_DOC_VERSION` in `src/pages/Legal.tsx`)

Связано: [`PHASE1-PRIVATE-BETA.md`](./PHASE1-PRIVATE-BETA.md) (PB-03) · [`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md) §152-ФЗ

---

## What exists in product (repo)

| Piece | Status |
|-------|--------|
| Consent gate `/consent` (`Consent.tsx`) | ✅ two checkboxes → privacy + terms; Continue → API/local consent |
| Legal pages `/legal/privacy`, `/legal/terms` | ✅ richer RU draft + orange «Черновик для юриста» banner |
| API `POST /v1/users/me/consent` → `users.consent_152_at` | ✅ |
| localStorage `hub-consent-v1` | ✅ (+ legacy key migrate) |
| Landing / Settings links to legal | ✅ |
| Lawyer-final text / real operator PD email | ❌ draft only |
| Register-page checkbox (PB-03 AC) | ⚠️ gate is post-login `/consent`, not on Register form itself |

---

## Draft vs missing (embarrassing placeholders)

| Item | Current | Needed before removing draft banner |
|------|---------|-------------------------------------|
| Banner «Черновик для юриста» | Kept on purpose | Lawyer sign-off + version bump |
| Operator legal entity | TODO blocks in UI | Юрлицо / ИП, ОГРН(ИП), ИНН, адрес |
| PD contact email | `privacy@hub.local` | Real mailbox Филипп controls |
| Claims / legal notice address | TODO | Same operator details |
| RF hosting named in policy | TODO pointing to prod checklist | Confirmed VPS / managed PG in RF |
| Cross-border processors list | Deferred | After Sentry/CDN/host choice |
| Age threshold wording | TODO for lawyer | Counsel |

**Do not invent fake OGRN/INN.** Leave TODOs until Филипп fills them.

---

## What Филипп must provide (before draft banner removal)

1. **Оператор ПДн:** полное наименование, ОГРН/ОГРНИП, ИНН, юр. и почтовый адрес.  
2. **Email контакта по ПДн** (замена `privacy@hub.local`) + канал для претензий.  
3. **Lawyer review / sign-off** of Политика + Соглашение (или явный waiver только для очень узкого invite cohort — Release decision).  
4. **RF hosting confirmation** (ties to PB-01) so §«место обработки» is not empty TODO.  
5. After fill-in: bump `LEGAL_DOC_VERSION`, remove or soften banner only with counsel OK.

---

## Files

- `src/pages/Legal.tsx` — copy + banner  
- `src/pages/Consent.tsx` — gate + draft note  
- `src/lib/consent.ts` — local flag  
