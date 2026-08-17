-- V102__policy_version.sql (audit 2026-08-15 B7)
--
-- Add a version column to policy_mgmt.policy_acknowledgements so a version
-- bump on the underlying HR policy forces employees to re-acknowledge (the
-- old ack rows stay valid for their version only). PolicyService.acknowledge
-- writes the current policy_version at ack time, and
-- PolicyService.needsAcknowledgment now compares latest-vs-last-acknowledged
-- rather than existence-only.
--
-- Idempotent — Flyway is disabled in prod, migrations are hand-applied.
--
-- NOTE: The policies table is policy_mgmt.hr_policies (NOT policy_mgmt.policies).

ALTER TABLE policy_mgmt.policy_acknowledgements
    ADD COLUMN IF NOT EXISTS policy_version VARCHAR(20);

-- Backfill: existing ack rows written before this migration reference an
-- indeterminate version — stamp them with the CURRENT version of their
-- policy so pre-existing acks stay valid until the operator ships a new
-- version.
UPDATE policy_mgmt.policy_acknowledgements a
   SET policy_version = p.policy_version
  FROM policy_mgmt.hr_policies p
 WHERE a.policy_id = p.id
   AND a.policy_version IS NULL
   AND p.policy_version IS NOT NULL;

-- Index for the "latest ack for (policy, employee)" lookup used by
-- needsAcknowledgment. Deliberately NOT a unique constraint on
-- (policy_id, employee_id): the semantics are one row per (policy, employee,
-- version), so multiple rows CAN coexist for the same (policy, employee)
-- pair across versions.
CREATE INDEX IF NOT EXISTS ix_policy_acks_lookup
    ON policy_mgmt.policy_acknowledgements (policy_id, employee_id, policy_version);
