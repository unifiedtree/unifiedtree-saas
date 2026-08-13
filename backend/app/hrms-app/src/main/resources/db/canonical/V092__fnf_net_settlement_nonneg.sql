-- ============================================================================
-- V091 - FnF net settlement must be non-negative (QA fix, 2026-08-13)
-- ----------------------------------------------------------------------------
-- The bug: FnfService did not stop a caller from POSTing components whose
-- DEDUCTION total exceeded the EARNING total, so a "settlement" with
-- net_settlement < 0 could reach APPROVED / PAID — effectively asking the
-- company to charge the ex-employee on the way out.
--
-- The service-side guard now rejects with 422 INVALID_NET_SETTLEMENT at
-- create / approve / pay time; this migration mirrors the same invariant at
-- the database boundary so a rogue backfill or a legacy row can never bypass
-- the check. Idempotent — the constraint is added only if it doesn't already
-- exist.
--
-- If any historical row already violates the constraint, ALTER will fail
-- loudly with 23514 (check_violation). That is intentional: fix the data
-- (typically by demoting the row to CANCELLED) before re-running.
-- ============================================================================

ALTER TABLE fnf_mgmt.fnf_settlements
    DROP CONSTRAINT IF EXISTS ck_fnf_settlements_net_nonneg;

ALTER TABLE fnf_mgmt.fnf_settlements
    ADD CONSTRAINT ck_fnf_settlements_net_nonneg
    CHECK (net_settlement >= 0);
