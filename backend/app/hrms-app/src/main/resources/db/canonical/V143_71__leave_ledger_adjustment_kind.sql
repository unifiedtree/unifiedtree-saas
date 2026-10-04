-- V143.71: the leave balance audit trail accepts ADJUSTMENT rows, written when HR
-- gives everyone a leave type's days ("Apply to all employees" on Leave types).
--
-- Why. A balance is made once a year per person with the type's days at that
-- moment, and editing the type later never changed it. The client (nclever, 4 Oct
-- 2026) saw Leave types say Annual 1 day and Casual 1 day a year while the app and
-- All balances still said 21 and 6: the types were edited on 26 Sep, the balances
-- were made on 6-17 Aug from the sign-up defaults (21 / 12 / 6). The new admin
-- action sets everyone's balance to what the type gives, after a preview, and
-- records each changed balance on leave_mgmt.leave_balance_ledger so the person
-- (Leave > Balances) and HR can see what changed, from what, and who did it.
-- V143.23's check only allows ACCRUAL, CARRY_FORWARD, LAPSE and ENCASHMENT.
--
-- No data is changed here. Nothing is backfilled: whether nclever's balances should
-- follow its types (and at 1 day or at 0, which saving refused until this release)
-- is the admin's choice, made with the new action. For the record, read-only
-- counts from production on 4 Oct 2026: nclever has 6 people still working and 18
-- balances for 2026 (3 per person); 12 of them differ from their type (Annual 21
-- vs 1, Casual 6 vs 1; Sick 12 matches). In every other workspace together, 4 of
-- 364 such balances differ from their type, all in one workspace.
--
-- Safety. Only the CHECK constraint is replaced, by a strictly wider one, so every
-- existing row satisfies it. No JPA entity maps the ledger. The backend reads the
-- constraint before writing an ADJUSTMENT row (LeaveEntitlementService.ledgerReady),
-- so until this is applied "Apply to all employees" still works and simply writes
-- no ledger rows.
--
-- Numbered 143.71 (reserved; Flyway compares versions numerically, so it sorts
-- after 143.69). Idempotent: it does nothing once the check already allows
-- ADJUSTMENT, and nothing when the ledger table doesn't exist (V143.23 not applied).
-- Production has Flyway OFF: apply by hand, as the table owner.

DO $$
BEGIN
    IF to_regclass('leave_mgmt.leave_balance_ledger') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = to_regclass('leave_mgmt.leave_balance_ledger')
                          AND conname = 'ck_leave_ledger_kind'
                          AND pg_get_constraintdef(oid) LIKE '%''ADJUSTMENT''%') THEN
        ALTER TABLE leave_mgmt.leave_balance_ledger DROP CONSTRAINT IF EXISTS ck_leave_ledger_kind;
        ALTER TABLE leave_mgmt.leave_balance_ledger ADD CONSTRAINT ck_leave_ledger_kind
            CHECK (kind IN ('ACCRUAL', 'CARRY_FORWARD', 'LAPSE', 'ENCASHMENT', 'ADJUSTMENT'));
    END IF;
END $$;
