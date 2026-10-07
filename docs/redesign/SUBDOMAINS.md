# Subdomains: who serves which address

Last checked 8 Oct 2026 (read-only: `curl`, `nslookup`; the Vercel CLI is not installed on this machine, so the
project/domain list below is what the responses show plus `DEPLOY.md`, not a dashboard export). Nothing in this
file has been applied. It is the plan for the domain work that still has to be done by hand.

## Today

| Address | Served by | What it shows today |
|---|---|---|
| `unifiedtree.com` | Vercel, **website** project | 307 to `www.unifiedtree.com` |
| `www.unifiedtree.com` | Vercel, **website** project (explicit domain) | the website |
| `api.unifiedtree.com` | Google Cloud Run (`server: Google Frontend`) | the backend |
| `*.unifiedtree.com` | Vercel, **platform** project (wildcard domain) | the business app |
| `app.`, `admin.`, `marketing.`, `business.` | fall through to the wildcard → **platform** | the business app (same bundle as `tata.`) |

DNS: the zone is on Vercel (`ns1/ns2.vercel-dns.com`), so domains and records are managed in the Vercel team.

Before this change the business app, on any address, showed the business sign-in whatever the backend said:
the public lookup already answered 404 "Workspace not found" for `tata`, `admin`, `marketing`, `app` and
`business`, but the web app treated that like any failed request and showed the plain sign-in. Now
(branch `fix/unknown-and-reserved-subdomains`):

- an unknown address (`tata.`) shows **This workspace doesn't exist**, no sign-in;
- a reserved address (`admin.`, `marketing.`, `business.`, `app.`, ... — the backend's
  `com.hrms.core.tenant.ReservedSubdomains`) shows **There's no business here**, no sign-in, no redirect;
- a suspended / terminated / rejected business shows **This workspace isn't available**, no sign-in;
- a real business is unchanged; a slow or failing lookup also leaves the app as it was (sign-in shown).

The reserved page needs the new backend (it sends `WORKSPACE_RESERVED`). With today's production backend the
web app already shows **This workspace doesn't exist** on `admin.` / `marketing.`, which is also safe.

## Rules

1. `ReservedSubdomains` (backend) is the only list. Sign-up (availability check, free, paid, add-a-business)
   refuses those names; the public lookup answers `WORKSPACE_RESERVED` for them. To reserve a new name, add it
   there; nothing in the web app or website needs to change.
2. Before adding a name, check no business already uses it (a business that holds a reserved name keeps
   working, but its address would then clash with the new app):
   `curl https://api.unifiedtree.com/api/v1/public/workspace-branding?subdomain=<name>` must answer 404.
   On 8 Oct: `www api admin app mail marketing business unifiedtree demo` all 404 in production.
3. An explicit domain on a Vercel project beats the wildcard. Giving `admin.unifiedtree.com` to the admin
   project takes it away from the platform project's `*.unifiedtree.com` with no change to the wildcard.

## When the admin console gets its own project (`admin.unifiedtree.com`)

1. Deploy the admin app as its own Vercel project. Check it on its `*.vercel.app` address first.
2. In that project: Settings → Domains → add `admin.unifiedtree.com`. The zone is on Vercel DNS, so no record
   is needed; Vercel issues the certificate (a minute or two).
3. Check: `curl -sI https://admin.unifiedtree.com/` shows a different `x-vercel-id` deployment and the page
   title is the admin app's, not "Sign in"; `https://tata.unifiedtree.com` still shows "doesn't exist" and a
   real business still signs in.
4. Backend: CORS already allows `https://*.unifiedtree.com` (`UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS`); confirm
   with a request from the admin origin. Platform-admin endpoints are permission-gated (PR #12); nothing on the
   host decides access.
5. Rollback: remove the domain from the admin project; the address falls back to the wildcard and shows the
   reserved page again.

## When Marketing gets its own app (`marketing.unifiedtree.com`)

Same steps as admin if it is a Vercel project. If the Node app is hosted elsewhere (Cloud Run, a VM):

1. Vercel DNS → add a record for `marketing` (CNAME to the host, or A record). An explicit DNS record wins
   over the wildcard record for that name.
2. Do **not** also add `marketing.unifiedtree.com` to a Vercel project, or Vercel will keep serving it.
3. Note: the business session cookies are set with `Domain=.unifiedtree.com` (HttpOnly), so the browser also
   sends them to `marketing.` and `admin.`. Those apps must not log request cookies; if that is a concern,
   moving the business cookies to host-only is a separate change.

## `business.unifiedtree.com`

The client wants the business app to live at `business.unifiedtree.com` (on hold, 4 Oct). Until that is
decided it is reserved and shows the neutral page. If it becomes the business entry point, it needs a
deliberate change: the web app has to treat `business.` like the bare host (ask for the workspace, then go to
`<name>.unifiedtree.com`), not like a business, and the decision belongs with the workspace/company model.

## `app.unifiedtree.com`

No project of its own; it is the wildcard (the business app) and is reserved, so it shows the neutral page.
If it should go somewhere (e.g. redirect to `www`), add it as a domain with a redirect on the website project.

## Local and preview

- `<name>.localhost:<port>` behaves like `<name>.unifiedtree.com` (tests use `demo.localhost`;
  `tata.localhost`, `admin.localhost` show the new pages).
- `localhost`, `127.0.0.1` and Vercel preview addresses (`*.vercel.app`) are not business addresses: the app runs
  as before (the sign-in asks for the workspace name).

## Not covered

- Custom domains: `platform.tenant_domains` exists but nothing reads it; every business is `<name>.unifiedtree.com`.
- `InitialAdminBootstrap` takes its subdomain from configuration and does not check the reserved list (operator
  setting, not user input).
