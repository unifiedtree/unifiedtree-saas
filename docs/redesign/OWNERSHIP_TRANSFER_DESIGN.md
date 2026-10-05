# Ownership transfer — design (A-29)

Status: **draft for the owner's OK** (6 Oct 2026). Nothing is built yet.
Spec: master context §12 — the new owner gets access, ownership moves, the old owner keeps a transition period of up to
~15 days (can guide, cannot act as owner), then loses full access.

## 1. How ownership is stored today (and the problem)

Ownership lives in four places, written together **only at sign-up** and never updated afterwards:

| Where | What | Who reads it |
|---|---|---|
| `rbac.user_roles` → role `OWNER` (`…0010`), plus `SUPER_ADMIN` (`…0001`) given at sign-up | the real power | every owner check (`AccessGuard.isOwner`, `AccessPolicy`, lifecycle, personal pages); billing mails (`TenantAdminLookup`) |
| `platform.account_workspaces.role = 'OWNER'` | account portal (website `/workspaces`, "can buy") | `AccountService` |
| `platform.tenants.owner_account_id` | fallback "who initiated" for plan changes | `WorkspacePlanController.resolveAccountId` |
| `platform.tenants.contact_email / contact_phone / admin_name`, `platform.subscriptions.contact_email` | the email sent to Razorpay in subscription notes | billing |

Today an owner can already give the `OWNER` role to anyone from the Roles/Access screen (`WorkspaceAccessService.grant`),
which changes only `rbac.user_roles` — the other three places keep pointing at the founder, and there is no "last owner" guard.
Billing checks read the permissions **inside the token**, so a role change only takes effect at the next sign-in/refresh.

## 2. The flow

1. **Start (current owner only).** Business settings → *Ownership* → "Transfer ownership". Pick the new owner from the
   business's active users, type your password again, add an optional note. One open transfer per business.
   The new owner gets an in-app notification + email.
2. **Accept (new owner).** A banner on their home: *"Asha wants to make you the owner of Acme. Accept / Decline"*.
   The offer expires after 7 days. The old owner can cancel it until it is accepted.
3. **On accept, in one transaction:**
   - new owner: gets `OWNER` + `SUPER_ADMIN`; gets an `account_workspaces` row with role `OWNER` (account created if missing);
     `tenants.owner_account_id`, `contact_email`, `contact_phone`, `admin_name` and `subscriptions.contact_email` move to them.
   - old owner: loses `OWNER` + `SUPER_ADMIN` and gets the **transition access** (see Q1) until `accepted_at + 15 days`;
     their `account_workspaces` role becomes `ADMIN` for that period.
   - both people's sessions are signed out (`SessionService.revokeAll`) so the new permissions apply at once.
   - audit row via `AccessAudit` (same transaction): who, from, to, when, transition end date.
4. **Transition (up to 15 days).** The old owner sees a banner "You handed ownership to Asha on 6 Oct. Your access ends on
   21 Oct." The new owner can end it early ("End transition now"). The old owner cannot undo the transfer.
5. **End.** A daily job (and the "end now" button) removes the transition access. What the old owner keeps is Q2.
   Audit row + email to both.

Billing handover — see Q3. The Razorpay subscription is not tied to a person (only an email in its notes), so it keeps
running; the autopay mandate, however, is the **old owner's card/UPI/bank**.

## 3. Data

New table (migration **V144_x**, idempotent, accessed with `JdbcTemplate` only):

```
platform.ownership_transfers(
  id uuid pk, tenant_id uuid not null,
  from_user_id uuid, from_account_id uuid, to_user_id uuid, to_account_id uuid,
  status text  -- PENDING | DECLINED | CANCELLED | EXPIRED | TRANSITION | COMPLETED
  note text, requested_at, expires_at, accepted_at, transition_ends_at, completed_at,
  ended_by uuid)
unique (tenant_id) where status in ('PENDING','TRANSITION')
```

No new permission: every action checks "is the caller the current owner / the named new owner" on the server.
(So `OwnerPermissionInvariantCheck` and the Roles screen are unaffected.)

## 4. API (backend) and screens (web)

- `GET  /v1/workspace/ownership-transfer` — the open transfer, if any (both parties + owner see it).
- `POST /v1/workspace/ownership-transfer` `{ toUserId, password, note }` — owner starts.
- `POST …/{id}/cancel` (owner, while PENDING) · `…/{id}/accept` · `…/{id}/decline` (new owner) · `…/{id}/end-transition` (new owner).
- Web: an *Ownership* section in Business settings; the accept/decline banner; the transition banner. The app shows the
  same banner text through the normal notification (no new app screen).

## 5. What needs Saiteja's lane (contract)

- The role changes (grant/revoke `OWNER`, `SUPER_ADMIN`, transition access) must go through `WorkspaceAccessService`
  (`app/hrms-api/.../access`, your lane, being changed for roles per company). I need **one narrow service method**
  `transferOwnership(tenantId, fromUserId, toUserId, transitionRoleCode)` or your OK to write it there.
- Q5 below changes `AccessPolicy` (your lane).

## 6. Questions for the owner (please answer before I build — recommended option first)

1. **Old owner during the 15 days:** (a) *view-only* across the business, can't change anything **(recommended — "can guide,
   cannot act")**, or (b) Admin (owner minus billing — can still change most things).
2. **After the 15 days, if the old owner is also an employee:** (a) keeps normal employee self-service (punch, leave,
   payslips) **(recommended)**, or (b) loses all access.
3. **Billing:** (a) the new owner is asked to set up autopay with their own payment method before the next due date; until
   then the old mandate keeps charging **(recommended)**, or (b) billing pauses until the new owner sets it up.
4. **Who can become owner:** (a) only someone who already has a login in this business **(recommended; invite them first
   otherwise)**, or (b) any email. (With one business per person, they cannot own another business.)
5. **More than one owner?** Today the Access screen lets an owner make other people owners. (a) Exactly one owner; the
   transfer is the only way to change it **(recommended)**, or (b) keep allowing several owners.
