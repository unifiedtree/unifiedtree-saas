# UnifiedTree Autopay — What Happens in Every Scenario

Plain-English reference for support, ops, and product. Uses one example
customer throughout: **Acme Corp buys the HR module for 5 employees on
Aug 1** (₹40/user/month = ₹200/month).

---

## Quick reference

| Scenario | Do they keep access? | Are they charged? |
|---|---|---|
| 1. Day-1 signup | 7 days free, then ₹200/mo | No charge for 7 days; auto-debit on day 8 |
| 2. Delete UPI mandate the same evening | Yes, till end of trial | Never charged |
| 3. Delete mandate day 3 of trial | Yes, till end of trial | Never charged |
| 4. Delete mandate mid-paid-month | Yes, till end of paid month | Nothing extra |
| 5. Add 3 employees mid-trial (5→8) | Yes | Trial extends; first charge is ₹320 |
| 6. Add 3 employees mid-paid-month (5→8) | Yes, immediately | ~₹72 prorated now + ₹320 next month |
| 7. Reduce employees mid-paid-month (8→5) | Yes at 8 seats till renewal | No refund; drops to ₹200 next month |
| 8. Cancel then resubscribe | Access till current period ends | No second trial — charged immediately |
| 9. Bank rejects the auto-debit | Yes for ~10 days (retry window), then no | Only what actually cleared |
| 10. Owner forgets about it | Keeps going forever | Auto-debit runs monthly, silently |

**The four rules that never break:**
1. **One trial per workspace, ever.** Cancel + resubscribe = no fresh trial.
2. **Paid time is never taken back.** If money was charged for a month, access lasts that month.
3. **No silent charges.** Every debit produces a webhook we log to `payment_events`.
4. **Duplicates ignored.** If Razorpay retries a webhook, we process it once and no-op the rest.

---

## The scenarios in detail

### 1. Day-1 purchase (Aug 1, 5 employees, HR module)

- Owner clicks "Set up autopay". Razorpay opens the UPI mandate approval screen.
- On success we write a subscription row: status `TRIAL`, current period Aug 1 → Aug 8, `free_trial_used` flag flips to TRUE for that workspace (this is the one-way flag that stops trial farming).
- **No money moves for 7 days.**
- On **Aug 8**, Razorpay auto-debits ₹200. If it succeeds we flip status to `ACTIVE`, next period runs Aug 8 → Sep 8.

---

### 2. Delete the UPI mandate the same evening (Aug 1)

- Nothing catches fire immediately — there's no charge scheduled inside the trial window.
- On **Aug 8**, Razorpay tries to collect ₹200 from a mandate that no longer exists → fails.
- After Razorpay's retry cycle we get a `subscription.cancelled` webhook. We give access until the end of the trial (Aug 8 midnight).
- Net: **customer got the full 7 days free, no money moved, access ends when the trial would have ended anyway.**

---

### 3. Delete the mandate on day 3 of the trial (Aug 4)

- Trial is still valid until Aug 8. Customer keeps working normally.
- On **Aug 8** the same "auto-debit fails → cancelled" chain fires as scenario 2.
- Access ends Aug 8 midnight. They can hit "Set up autopay" again — but they **won't get another trial** (the `free_trial_used` flag). They'll be charged ₹200 on the spot for the first paid month.

---

### 4. Delete the mandate after a paid month (say Sep 15, mid-cycle)

- Sep 8 charge already succeeded, they're paid through Oct 8.
- Owner deletes the mandate on Sep 15. On **Oct 8** Razorpay tries to charge, fails, retries, then `cancelled`.
- We set access to end at **Oct 8 midnight** (Netflix pattern — they paid for the month, they get the month).
- After Oct 8 the workspace's modules are locked. They can resubscribe any time — same "no second trial, charged immediately" as scenario 3.

---

### 5. Add 3 employees mid-trial (Aug 4, going 5 → 8)

- Owner adjusts seats in the platform. We call Razorpay `subscriptions.update` with quantity 8, effective immediately.
- Because we're still in the trial window (no charge has moved yet), the change is **free** — no proration charge fires.
- On **Aug 8**, first debit is ₹40 × 8 = **₹320** instead of ₹200.
- Trial is not extended, not restarted; the same one-per-workspace flag applies.

---

### 6. Add employees mid-paid-month (Sep 20, going 5 → 8)

- We call Razorpay `subscriptions.update` with quantity 8, `schedule_change_at='now'`.
- Razorpay calculates the **prorated top-up** — 3 extra seats × ~18 days remaining (Sep 20 → Oct 8) = roughly **₹72 debited immediately** from the mandate.
- Webhook fires, we log it to `payment_events` and update seat count.
- On **Oct 8** the regular monthly charge is now ₹320.

---

### 7. Reduce employees (Sep 20, going 8 → 5)

- We call Razorpay `subscriptions.update` with quantity 5, `schedule_change_at='cycle_end'`.
- **The reduction takes effect NEXT cycle.** No refund for the current one — they already paid for 8 seats for Sep 8 → Oct 8, and they get them.
- DB writes `seats_next_cycle=5` but keeps `seats=8` until Oct 8.
- On **Oct 8** the debit drops to ₹200.
- If a customer really wants an immediate reduction with prorated refund, that's an ops action (cancel + recreate) — we don't expose it in the UI today.

---

### 8. Cancel-then-resubscribe (anti-abuse case)

- Customer cancels Aug 20 (mid-cycle after trial converted). We set access to end at the current period end (Sep 8), keep them running until then.
- On Sep 8 the paywall kicks in and their modules lock.
- Customer resubscribes on Sep 20. The `free_trial_used=TRUE` flag on the workspace **blocks a second trial**.
- Subscription starts as `ACTIVE` immediately, **₹200 charged on the spot**, next period Sep 20 → Oct 20.
- This is enforced under an advisory lock so a burst of parallel resubscribe clicks can't double-grant a trial.

---

### 9. Failed monthly renewal (mandate is valid but bank rejects)

- Razorpay follows its dunning schedule — usually 3 attempts spread over ~10 days.
- First failure: we stay `ACTIVE`, no user impact yet.
- Second failure: webhook fires `subscription.halted` — we send an in-app + push notification to the owner ("payment failed, please update").
- All retries fail: `subscription.cancelled` webhook. Because the paid period has already lapsed, **access ends immediately** (Razorpay already gave them the 10-day dunning runway; we don't stack another grace period on top).

---

### 10. Owner leaves / laptop dies / doesn't touch the app for a month

- Nothing changes. Razorpay auto-debits on schedule from the still-valid mandate. Access continues silently.
- If the mandate was deleted from the bank app, we hear about it via webhook (halted → cancelled), and scenarios 4 or 9 apply.

---

## What this looks like in the code (for developers)

- **Subscription state machine:** `platform.subscriptions.status` moves through `PENDING_MANDATE → TRIALING → ACTIVE → (PAST_DUE → HALTED → GRACE → CANCELLED)` or `→ COMPLETED / PAUSED / EXPIRED`.
- **Trial guard:** `PlanChangeService.startAt()` reads `free_trial_used` under an advisory lock. Trial-abuse is impossible.
- **Grace-until logic:** on `onCancelled`, we compute `grace_until = COALESCE(CASE trial_ends_at > now THEN LEAST(trial_ends_at, current_period_end) ELSE current_period_end END, razorpay-fallback, now + 3 days)`. In English: "the furthest-in-future of trial end, paid period end, or Razorpay's own end date; last-resort 3-day fallback that never fires in real traffic".
- **Webhook idempotency:** every Razorpay event has `event.id` — we `INSERT ... ON CONFLICT DO NOTHING` into `platform.razorpay_webhook_events`, so replays are no-ops.
- **Nightly job:** `SubscriptionStateReconciler.revokeExpiredCancellations()` flips `status='CANCELLED'` workspaces whose `grace_until` has passed → modules lock, paywall guard blocks writes.

## What we DON'T support today (be honest with the customer)

- Immediate seat-reduction with prorated refund — has to be done via Razorpay dashboard by ops.
- Multi-currency — the `currency` column exists but the UI enforces INR at launch.
- Direct bank/UPI adapter (HDFC Connect, ICICI CIB) — "Mark Paid" takes a manual UTR at launch.
- Interest-bearing personal loans — schema carries `interest_rate_pct` but recovery math treats everything as rate=0.

Related memory: [[razorpay-paid-signup]], [[plan-change-autopay-flow]], [[synthetic-e2e-mandatory-for-payment]].
