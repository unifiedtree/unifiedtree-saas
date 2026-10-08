# Marketing launcher (open Marketing from UnifiedTree)

Branch `feat/marketing-launcher`. Frontend only (`apps/platform`); no backend change, no migration. It uses the Java
SSO API that PR #12 added (`MarketingSsoController`, `MarketingAccessService`).

## What people see
- **All apps** (`/modules`): a pink **Marketing** tile.
- **Business frame** (`/business/*`, Business settings): a **Marketing** button next to **All apps** (icon only on a phone).
- One company with Marketing: a click opens Marketing for it in the same tab, already signed in.
  Several: a small chooser, the current company (the company selector's) first.
- When something is refused, a plain message: the company doesn't have Marketing, you're no longer a member, your
  login is switched off / locked, you don't have access to this company, Marketing can't be opened right now (with
  **Try again**), your UnifiedTree sign-in has ended.
- While the tile shows, the catalog's own "Marketing" plan tile (the `marketing` plan, which includes module
  `whatsapp`) is left out, so there is only one Marketing tile.

**Both are shown only when** (a) the build sets `VITE_MARKETING_APP_URL`, and (b) `GET /v1/sso/marketing/companies`
lists at least one company **of this business** with `marketingEntitled: true` for this person. With the variable
unset (production today) nothing runs: no tile, no button, **zero** calls (checked live with a second build).

## How it works
1. The SSO endpoints accept only an **account** token (`hasRole('ACCOUNT_USER')`; only `JwtService.issueAccountToken`
   puts that role in a token). This app holds a **workspace** token, which they refuse (403). So the launcher gets an
   account token the same way Marketing's own sign-in page does: `POST /v1/accounts/auth/refresh` with the
   `ut_acct_rt` cookie (HttpOnly, `Domain=.unifiedtree.com`, `credentials: 'include'`). The token is kept in memory only.
   It is used only if its email is the person signed in here (another person's account sign-in on the same browser
   is ignored), and only this business's companies are offered.
2. `GET /v1/sso/marketing/companies` (account bearer, no cookies) → the tile shows if one of this business's
   companies has Marketing. Kept for 5 minutes; one refresh per page load at most (each refresh rotates the cookie).
3. Click → `POST /v1/sso/marketing/handoff {tenantId, companyId}` → a single-use ticket valid 60 seconds. An expired
   account token (401) is refreshed once and the handoff retried.
4. The tab goes to `${VITE_MARKETING_APP_URL}/auth/unifiedtree/callback#ticket=<ticket>` — Marketing's real callback
   (`profitera/frontend/src/app/auth/unifiedtree/callback`). The ticket is only ever in the **fragment**: never in a
   query string, a server log, a Referer, storage or a log line. Marketing reads it, removes it from the address bar,
   and redeems it server-to-server (`POST /v1/internal/marketing/sso/redeem`); Java re-checks membership, company
   access and entitlement, and a ticket works once.

Code: `apps/platform/src/core/marketing/` (`marketingLauncher.ts` logic, `useMarketingLauncher.ts` state,
`MarketingLaunch.tsx` tile, button and chooser); used in `pages/Modules.tsx` and `layouts/BusinessShell.tsx`.

### URL rule
`VITE_MARKETING_APP_URL` must be a bare **https origin** (e.g. `https://marketing.unifiedtree.com`; a trailing `/` is
fine). A path, query, fragment, credentials or plain `http` switches the launcher off instead of sending a ticket
there. `http://localhost` / `127.0.0.1` / `*.localhost` are accepted only in a non-production build (local testing).
The ticket is checked against Marketing's own pattern before the browser leaves. If Marketing is ever served under a
base path (`NEXT_PUBLIC_BASE_PATH`), this rule has to be widened first.

## Who will NOT see it (known gap)
Someone who signed in on `<business>.unifiedtree.com` with the **workspace password** has no account sign-in
(`ut_acct_rt`) in the browser, so the refresh answers 401 and the tile stays hidden. People who signed in through the
website or with Google (both leave the cookie) see it. Closing the gap needs a backend change (not done here), e.g.
let the two SSO endpoints also accept a workspace token by mapping its user to the account through
`platform.account_workspaces` (the person is then restricted to that workspace), or have the workspace password
sign-in also start the account session.

Also: each refresh rotates `ut_acct_rt`. Two tabs refreshing at the same instant (this page and the website, say)
can make the slower one get 401, which signs that tab's account session out. Marketing's own sign-in page has the
same behaviour; the launcher refreshes at most once per page load to keep it rare.

## Turning it on in production (in this order)
1. **Java**: PR #12 deployed with its migrations (V144_101–106), and stage 6 of WhatsSRC
   `docs/unifiedtree-admin/MANUAL_PRODUCTION_STEPS.md` done: `UNIFIEDTREE_MARKETING_SERVICE_TOKEN` attached to Cloud
   Run (without it Marketing cannot redeem any ticket: every redeem is 401).
2. **Marketing Node**: `UNIFIEDTREE_API_URL=https://api.unifiedtree.com/api` and the same
   `UNIFIEDTREE_MARKETING_SERVICE_TOKEN` (stage 6); WhatsSRC merged and deployed (stage 7).
3. **Marketing frontend**: deployed at its public origin (DNS for `marketing.unifiedtree.com` is an owner action),
   built with `NEXT_PUBLIC_UNIFIEDTREE_API_URL=https://api.unifiedtree.com/api` (stage 8). The callback itself redeems
   through Marketing Node, but without this variable Marketing's "choose another company" / sign-in page says the
   option isn't available.
4. **Entitlement** for the pilot company: admin console → Companies → company → Entitlements → `whatsapp` → Active,
   with a reason (a MANUAL row in `platform.company_modules`). Fill in the `marketing` plan's limits first (stage 8.1).
5. **CORS**: nothing new if business pages already work — the launcher calls the same API host with the same
   credentialed mode as the existing workspace refresh. `UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS` must cover
   `https://*.unifiedtree.com`.
6. **This app**: rebuild `apps/platform` with `VITE_MARKETING_APP_URL=https://marketing.unifiedtree.com` (build-time;
   Vercel → Environment Variables, Production, or `.env.production`). Rolling back = rebuild without it.

## Smoke (production, pilot company)
1. Sign in on the **website** (or with Google) as a member of the pilot company, enter the business. All apps shows
   **Marketing**; Business settings shows the Marketing button. DevTools → Network: one
   `POST /v1/accounts/auth/refresh` (200) and one `GET /v1/sso/marketing/companies` (200) per page load.
2. Click it: one `POST /v1/sso/marketing/handoff` (200), then the tab is on
   `https://marketing.unifiedtree.com/auth/unifiedtree/callback` (the fragment is removed at once). Press Continue →
   Marketing opens for that company.
3. Go back and click again: a new ticket each time; Marketing's logs never show a ticket in a request URL.
4. A member of a company **without** Marketing: no tile. Signed in with the workspace password only: no tile (the gap
   above). Suspend the pilot's entitlement and click: "This company doesn't have Marketing…".
5. A build without the variable (today's): no tile and no refresh/SSO request at all.

## Tests
- Unit (vitest, `src/core/marketing/*.test.ts(x)`): URL rule, fragment-only URL, refresh/companies/handoff calls and
  the token each carries, visibility rules, single-flight session, every refusal's message, no ticket in any log.
- Live: `apps/platform/e2e/recovery/live-w81-mktlaunch.mjs` through `live-slot.sh`, with a local Marketing mock that
  records what it receives (see the file's header for the two variables to export first).
