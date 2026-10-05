# Ownership transfer — design (A-29)

Status: **owner answered the 5 questions on 6 Oct 2026** (see §6). Nothing is built yet.
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
   - old owner: loses `OWNER` + `SUPER_ADMIN` and gets the built-in **`ADMIN`** role (full admin = owner minus billing,
     owner decision Q1) until `accepted_at + 15 days`; their `account_workspaces` role becomes `ADMIN` for that period.
   - both people's sessions are signed out (`SessionService.revokeAll`) so the new permissions apply at once.
   - audit row via `AccessAudit` (same transaction): who, from, to, when, transition end date.
4. **Transition (up to 15 days).** The old owner sees a banner "You handed ownership to Asha on 6 Oct. Your access ends on
   21 Oct." The new owner can end it early ("End transition now"). The old owner cannot undo the transfer.
5. **End.** A daily job (and the "end now" button) removes the old owner's `ADMIN` role. If they are also an employee they
   keep their employee self-service (Q2); otherwise their login is deactivated and their `account_workspaces` row set to
   `REMOVED`. Audit row + email to both.

Billing handover (Q3): the Razorpay subscription is not tied to a person, so it keeps running on the old owner's mandate.
From accept, the new owner sees "Set up autopay with your payment method before <next due date>" (banner + the normal
reminders); once they do, the old mandate is replaced. Billing does not pause.

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
- One owner only (Q5): `AccessPolicy` / the Access screen must stop granting or revoking `OWNER` directly — the transfer
  becomes the only way. That is in your lane; the transfer service will be the single caller allowed to move `OWNER`.

## 6. Owner decisions (6 Oct 2026)

1. Old owner during the 15 days: **full admin access** (built-in `ADMIN`: everything except billing and ownership).
2. After the 15 days, an old owner who is also an employee **keeps employee self-service**.
3. The new owner **sets up autopay with their own payment method** before the next due date; until then the old mandate keeps charging.
4. Only someone who **already has a login in this business** can become owner (invite them first otherwise).
5. **Exactly one owner**; the transfer is the only way to change it.
