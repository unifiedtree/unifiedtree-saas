# Marketing launcher (open Marketing from UnifiedTree)

Branch `feat/marketing-launcher` (direct sign-in fix: `fix/marketing-tile-direct-login`, which also lets the two SSO
endpoints take a workspace token). No migration. It uses the Java SSO API that PR #12 added (`MarketingSsoController`,
`MarketingAccessService`).

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
1. The two SSO calls go with this page's own **workspace** token, through `apiJson` (the SDK's bearer,
   `X-Tenant-Subdomain`, and one workspace refresh on a 401; no `X-Company-Id`: the handoff names its company). The API
   pins the business from the token's `tenant_id`: `companies` lists only this workspace, and `handoff` refuses
   another business with 403 `NOT_A_MEMBER`. So every sign-in on the business subdomain works (password, OTP, Google)
   with no account cookie, and no `/v1/accounts/auth/refresh` call is made.
   **Older API** (before the workspace-token change: the endpoints take only an **account** token,
   `hasRole('ACCOUNT_USER')`): a workspace call answered 403, 404 or 405 falls back to the account sign-in, the same
   way Marketing's own sign-in page gets one: `POST /v1/accounts/auth/refresh` with the `ut_acct_rt` cookie (HttpOnly,
   `Domain=.unifiedtree.com`, `credentials: 'include'`). That token is kept in memory only, used only if its email is
   the person signed in here, and forgotten on sign-out. Any other failure is not retried that way. So this app can go
   live before or after the API.
2. `GET /v1/sso/marketing/companies` → the tile shows if one of this business's companies has Marketing. Kept for
   5 minutes (per workspace and person; dropped on a company switch and on sign-out).
3. Click → `POST /v1/sso/marketing/handoff {tenantId, companyId}` → a single-use ticket valid 60 seconds. On the
   account path an expired account token (401) is refreshed once and the handoff retried. When the API refuses
   (`NOT_A_MEMBER`, `MARKETING_NOT_ENTITLED`…) and there is no account sign-in to fall back to, that refusal is shown.
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

## Direct sign-in on the business subdomain (was a known gap, fixed)
No sign-in on `<business>.unifiedtree.com` (password, OTP or Google) sets the account cookie `ut_acct_rt`; only the
website's account sign-in does. The launcher used to need that cookie, so after a direct sign-in the refresh answered
401, no company came back, and All apps showed the catalogue's Marketing tile ("Soon") instead of the launcher.
Fixed by sending the page's workspace token to the two SSO endpoints, which the API now accepts (pinned to that
workspace; see How it works). Until that API is deployed, a direct sign-in still gets no tile (the older API refuses
the workspace token and there is no cookie to fall back to); website sign-ins keep working either way.

Also, on the account path only: each refresh rotates `ut_acct_rt`. Two tabs refreshing at the same instant (this page
and the website, say) can make the slower one get 401, which signs that tab's account session out. Marketing's own
sign-in page has the same behaviour; the launcher refreshes at most once per page load to keep it rare.

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
1. Sign in **directly on the business subdomain** (password) as a member of the pilot company. All apps shows
   **Marketing**; Business settings shows the Marketing button. DevTools → Network: one
   `GET /v1/sso/marketing/companies` (200, workspace bearer, no `X-Company-Id`) and **no**
   `POST /v1/accounts/auth/refresh`. Repeat after signing in through the **website**: same result.
2. Click it: one `POST /v1/sso/marketing/handoff` (200), then the tab is on
   `https://marketing.unifiedtree.com/auth/unifiedtree/callback` (the fragment is removed at once). Press Continue →
   Marketing opens for that company.
3. Go back and click again: a new ticket each time; Marketing's logs never show a ticket in a request URL.
4. A member of a company **without** Marketing: no tile. Suspend the pilot's entitlement and click: "This company
   doesn't have Marketing…". Sign out and sign in as someone else in the same tab: only their companies show.
5. A build without the variable (today's): no tile and no refresh/SSO request at all.

## Tests
- Unit (vitest, `src/core/marketing/*.test.ts(x)`): URL rule, fragment-only URL, refresh/companies/handoff calls and
  the token each carries, visibility rules, single-flight session, every refusal's message, no ticket in any log; the
  workspace-token path through the real `apiJson` (direct sign-in with no account cookie, no account refresh, no
  `X-Company-Id`), the older-API fallback (403/404/405), and the session reset on sign-out.
- Live: `apps/platform/e2e/recovery/live-w81-mktlaunch.mjs` through `live-slot.sh`, with a local Marketing mock that
  records what it receives (see the file's header for the two variables to export first).
