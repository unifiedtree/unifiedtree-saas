-- ============================================================================
-- V090 - Wave 2-6 permission backfill (QA fix, 2026-08-11)
-- ----------------------------------------------------------------------------
-- CRITICAL bug found by QA workflow wmih6ivbj: the 11 permissions introduced
-- by V080 (hrms.disbursement.*, hrms.bank_profile.*, hrms.reimb_batch.*,
-- hrms.appraisal.initiate, hrms.kpi.manage, hrms.advance.foreclose) were
-- inserted into rbac.permissions but NEVER granted to any role — so no user
-- could ever satisfy @PreAuthorize. All Wave 2-6 admin endpoints were 403 by
-- default in prod, making every new feature effectively dead code.
--
-- Fix: grant the 11 new codes to OWNER, SUPER_ADMIN, and (module-appropriate)
-- HR_MANAGER + FINANCE_LEAD + DEPT_MANAGER. Idempotent via ON CONFLICT.
--
-- Same-shaped follow-on to V064 (which back-filled the pre-Wave-2 permissions)
-- — future waves adding perms should ALWAYS grant explicitly + call this
-- pattern belt-and-braces.
-- ============================================================================

-- ── OWNER (0010) — full admin: gets everything non-platform (mirrors V064) ──
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.code IN (
    'hrms.disbursement.read', 'hrms.disbursement.build', 'hrms.disbursement.post',
    'hrms.bank_profile.read', 'hrms.bank_profile.manage',
    'hrms.reimb_batch.read',  'hrms.reimb_batch.build',  'hrms.reimb_batch.post',
    'hrms.appraisal.initiate',
    'hrms.kpi.manage',
    'hrms.advance.foreclose'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── SUPER_ADMIN (0001) — same set ─────────────────────────────────────────
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.code IN (
    'hrms.disbursement.read', 'hrms.disbursement.build', 'hrms.disbursement.post',
    'hrms.bank_profile.read', 'hrms.bank_profile.manage',
    'hrms.reimb_batch.read',  'hrms.reimb_batch.build',  'hrms.reimb_batch.post',
    'hrms.appraisal.initiate',
    'hrms.kpi.manage',
    'hrms.advance.foreclose'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── HR_MANAGER (0002) — HR + performance + reimbursement (no bank/disbursement) ─
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000002'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.code IN (
    'hrms.reimb_batch.read', 'hrms.reimb_batch.build', 'hrms.reimb_batch.post',
    'hrms.appraisal.initiate',
    'hrms.kpi.manage',
    'hrms.advance.foreclose'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── FINANCE_LEAD (0003) — bank + disbursement + reimbursement + write-off ──
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000003'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.code IN (
    'hrms.disbursement.read', 'hrms.disbursement.build', 'hrms.disbursement.post',
    'hrms.bank_profile.read', 'hrms.bank_profile.manage',
    'hrms.reimb_batch.read',  'hrms.reimb_batch.build',  'hrms.reimb_batch.post',
    'hrms.advance.foreclose'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── DEPT_MANAGER (0005) — appraisal for their team + KPI manage ────────────
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000005'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.code IN (
    'hrms.appraisal.initiate',
    'hrms.kpi.manage'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── QA FIX (finding wmih6ivbj/HIGH-3): DDL comment truthiness ──────────────
-- The V083 pending_signup migration's comment on
-- expense_mgmt.reimbursement_batch_items UNIQUE(batch_id, claim_id) claimed
-- "A claim can only be inside one non-CANCELLED batch" — that's FALSE at the
-- DB level; the constraint only prevents the same claim being in the same
-- batch twice. The app enforces the invariant via SELECT ... FOR UPDATE in
-- ReimbursementBatchService.build (see the QA-FIX comment there). Recording
-- the corrected intent here so future readers of pg_constraint don't get
-- misled.
COMMENT ON INDEX expense_mgmt.uq_reimb_batch_item IS
    'App-level guarantee: a claim is in at most one non-CANCELLED batch. '
    'THIS INDEX only prevents duplicate items within the SAME batch; the '
    'cross-batch invariant is enforced by ReimbursementBatchService.build '
    'via SELECT ... FOR UPDATE on eligible claims. See QA finding wmih6ivbj/HIGH-3.';

-- ── Verification log ──────────────────────────────────────────────────────
DO $$
DECLARE c INT;
BEGIN
    SELECT count(*) INTO c
      FROM rbac.role_permissions rp
     WHERE rp.permission_code IN (
        'hrms.disbursement.read','hrms.disbursement.build','hrms.disbursement.post',
        'hrms.bank_profile.read','hrms.bank_profile.manage',
        'hrms.reimb_batch.read','hrms.reimb_batch.build','hrms.reimb_batch.post',
        'hrms.appraisal.initiate','hrms.kpi.manage','hrms.advance.foreclose'
     );
    RAISE NOTICE 'Wave 2-6 role grants after backfill: % (was 0)', c;
END $$;
