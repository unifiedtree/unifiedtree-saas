# Marketing SSO and internal API: refusal codes

For the Marketing Automation (Node) developer. Built on `feat/marketing-sso-error-codes` (9 Oct 2026).

Every refusal from `/v1/internal/marketing/**` (server to server, service token) and `/v1/sso/marketing/**`
(the person's browser, UnifiedTree account token) now has a `code` field in its JSON body.
**Switch on `code`. Do not match words in `message`.** The message text can change; the codes will not.

Backward compatible: HTTP statuses, `errorCode` and `message` are exactly what they were. Only `code` is new.
One body changed shape: a refused service token used to get an **empty** 401 from the security chain. It now gets
the JSON body below, with the same status and the same `WWW-Authenticate` header.

```json
{"timestamp": "...", "status": 401, "errorCode": "401 UNAUTHORIZED",
 "message": "Handoff ticket is invalid, expired or already used", "code": "TICKET_USED"}
```

`errorCode` is kept only for old readers. For most refusals it is just the status (`"401 UNAUTHORIZED"`), so don't
use it. Neither the service token nor the ticket is ever echoed in a body or written to a log.

## Sign-in codes

| code | HTTP | When | What Node should do |
|---|---|---|---|
| `SERVICE_TOKEN_REJECTED` | 401 | `X-UnifiedTree-Service-Token` is missing or wrong, or this server has no token configured (`UNIFIEDTREE_MARKETING_SERVICE_TOKEN` unset or shorter than 32 characters). Any `/v1/internal/marketing/**` call. Also 403 if the call carried a UnifiedTree user `Authorization: Bearer` token, and 503 from a backstop that should never be reached (server not configured and the chain let the call through). | This is a deployment problem, not the user's. Don't retry or loop the user through sign-in. Alert ops: the token must be the same on both servers. Tell the user "Marketing sign-in is unavailable right now". |
| `TICKET_INVALID` | 401 | `POST /sso/redeem`: the ticket is not 20 to 100 characters (message `Invalid handoff ticket`), or no such ticket exists: never issued, or expired more than a day ago and cleaned up. | Don't retry this ticket. Send the browser back to UnifiedTree to start sign-in again, which issues a new ticket. |
| `TICKET_USED` | 401 | `POST /sso/redeem`: the ticket was already redeemed (single use). This includes a first redeem that was refused with a 403 below: the ticket is used up before the checks run. If it is also past its minute, this code still wins. | Don't retry. If this browser already got a Marketing session from the first redeem (double submit, page refresh), keep using it. Otherwise start sign-in again. |
| `TICKET_EXPIRED` | 401 | `POST /sso/redeem`: the ticket was not redeemed within 60 seconds of being issued. | Start sign-in again to get a new ticket. If this happens often, look at the time between the redirect and the redeem call. |
| `NOT_A_MEMBER` | 403 | The account has no active membership in that workspace. | Refuse. Show "You're not a member of that workspace" and offer the company picker. |
| `ACCOUNT_INACTIVE` | 403 | The UnifiedTree account is not active, or the person's user in that workspace is switched off or no longer exists in HRMS. | Refuse, and end any Marketing session this person has in that company. Show "Your access has been turned off. Contact your admin." |
| `ACCOUNT_LOCKED` | 403 | The person's user in that workspace is locked until a later time (the same lock HRMS sign-in uses). | Refuse for now. Show "Temporarily locked, try again later". A later retry can succeed. |
| `WORKSPACE_INACTIVE` | 403 | The workspace is not active. | Refuse. Don't retry. |
| `COMPANY_ACCESS_DENIED` | 403 | The person has no access to that company, or the company is archived. | Refuse. Offer the company picker. |
| `MARKETING_NOT_ENTITLED` | 403 | The company does not have Marketing Automation, or it has lapsed. | Refuse. Show "This company doesn't have Marketing Automation". |
| `COMPANY_NOT_FOUND` | 404 | The company is not in that workspace. Mostly from `GET /companies/{id}/entitlement`, when the tenant and company don't belong together. | Treat it as bad input or a stale mapping on Node's side. Don't retry. |
| `COMPANY_INACTIVE` | 403 | `GET /companies/{id}/entitlement`: the company is archived. | Treat as not entitled. Don't retry. |

Where they come from:

- `POST /v1/internal/marketing/sso/redeem`: `SERVICE_TOKEN_REJECTED`, the three `TICKET_*` codes, then every access
  code (access is checked again when the ticket is redeemed, not only when it was issued).
- `GET /v1/internal/marketing/access`: `SERVICE_TOKEN_REJECTED` and every access code.
- `GET /v1/internal/marketing/companies/{id}/entitlement`: `SERVICE_TOKEN_REJECTED`, `COMPANY_NOT_FOUND`,
  `COMPANY_INACTIVE`.
- `POST /v1/sso/marketing/handoff` (browser): the same access codes, before any ticket is issued.

## Other codes on the internal API

| code | HTTP | When | What Node should do |
|---|---|---|---|
| `PRINCIPAL_CONFLICT` | 409 | `PUT /principals`: the company or person already has a different Marketing principal, or that Mongo user is mapped to another company. | Don't retry. Flag it for an operator. |
| `PRINCIPAL_HELD` | 409 | `PUT /principals`: an operator has quarantined or retired that Mongo user. | Don't retry. Flag it for an operator. |
| `IDEMPOTENCY_MISMATCH` | 409 | `POST /usage`: the `idempotencyKey` was already recorded for a different event. | Don't resend with that key. It is a bug on Node's side. |
| `VALIDATION_FAILED`, `INVALID_REQUEST`, `INVALID_PARAMETER` | 400 | The request is the wrong shape: a missing or blank field (for example a blank `ticket`), JSON that can't be read, or a missing or malformed query parameter. | A bug on Node's side. Fix the request; don't retry it unchanged. |
| `ACCESS_DENIED` | 403 | `/v1/sso/marketing/*` called with a token that is not a UnifiedTree account token. Browser only. | Not seen by Node. |
| `BAD_REQUEST`, `CONFLICT`, `NOT_FOUND`, ... | 400, 409, 404 | Any other refusal that has no code of its own. The code is the status name. Examples: `action must start with MARKETING_` on `/audit`, `wabaId is required` on `/channels`, `That company is not in that workspace` on `/channels` and `/usage`. | Act on the HTTP status. Log the message, but don't parse it. |
| none | 5xx | Unexpected server error. | Retry with backoff. |

If Node gets a `code` it does not know, act on the HTTP status.

## In the code

- `MarketingServiceTokenFilter`: the service-token check. Its `entryPoint` and `accessDeniedHandler` wrap Spring's
  defaults in `CanonicalProdSecurityConfig`. Under `/v1/internal/marketing/` they add the JSON body. On every
  other path they leave the defaults exactly as they were. The token is still compared in constant time.
- `MarketingAccessService`: throws `MarketingRefusal` (status, code, unchanged message). When a ticket can't be
  redeemed, `redeem` checks the ticket's row by its hash to tell used from expired from unknown.
- `MarketingErrorAdvice`: for `MarketingInternalController` and `MarketingSsoController` only. Builds the usual body
  with `GlobalExceptionHandler` and adds `code`. It takes the code from a `MarketingRefusal`, then from a
  `CODE: ` prefix on the message, then from the status name. Other controllers' bodies are unchanged.
- Tests: `MarketingRefusalCodesTest`, `MarketingServiceTokenFilterTest` (platform-saas),
  `MarketingInternalSecurityChainTest` (hrms-app, the real production security chain).
