-- ============================================================================
-- V036 - Backfill global account portal rows for workspaces created before V035
-- ============================================================================
-- V035 introduced platform.accounts + platform.account_workspaces. Any tenants
-- created before that migration already have platform.tenants and
-- auth.user_credentials rows, but no global account portal row. This migration
-- links those existing owner credentials into the new account switcher model.
-- ============================================================================

WITH owner_credentials AS (
    SELECT DISTINCT ON (t.id)
           t.id AS tenant_id,
           lower(trim(t.contact_email)) AS email,
           COALESCE(NULLIF(trim(t.admin_name), ''), lower(trim(t.contact_email))) AS display_name,
           NULLIF(trim(t.contact_phone), '') AS phone,
           uc.id AS auth_user_id,
           uc.password_hash,
           t.created_at
      FROM platform.tenants t
      JOIN auth.user_credentials uc
        ON uc.tenant_id = t.id
       AND lower(uc.email) = lower(t.contact_email)
     WHERE t.id <> '00000000-0000-0000-0000-000000000000'::uuid
       AND t.contact_email IS NOT NULL
       AND trim(t.contact_email) <> ''
       AND uc.password_hash IS NOT NULL
     ORDER BY t.id, uc.created_at ASC
),
account_source AS (
    SELECT DISTINCT ON (email)
           email,
           display_name,
           phone,
           password_hash,
           created_at
      FROM owner_credentials
     ORDER BY email, created_at ASC
)
INSERT INTO platform.accounts
    (id, email, display_name, phone, password_hash, status,
     failed_login_count, password_updated_at, created_at, updated_at)
SELECT gen_random_uuid(), email, display_name, phone, password_hash,
       'ACTIVE', 0, now(), COALESCE(created_at, now()), now()
  FROM account_source
ON CONFLICT (email) DO NOTHING;

WITH owner_credentials AS (
    SELECT DISTINCT ON (t.id)
           t.id AS tenant_id,
           lower(trim(t.contact_email)) AS email,
           uc.id AS auth_user_id,
           t.created_at
      FROM platform.tenants t
      JOIN auth.user_credentials uc
        ON uc.tenant_id = t.id
       AND lower(uc.email) = lower(t.contact_email)
     WHERE t.id <> '00000000-0000-0000-0000-000000000000'::uuid
       AND t.contact_email IS NOT NULL
       AND trim(t.contact_email) <> ''
       AND uc.password_hash IS NOT NULL
     ORDER BY t.id, uc.created_at ASC
),
owner_accounts AS (
    SELECT oc.tenant_id,
           oc.auth_user_id,
           a.id AS account_id,
           oc.created_at,
           row_number() OVER (PARTITION BY a.id ORDER BY oc.created_at ASC, oc.tenant_id ASC) AS account_workspace_rank
      FROM owner_credentials oc
      JOIN platform.accounts a
        ON lower(a.email) = oc.email
)
UPDATE platform.tenants t
   SET owner_account_id = oa.account_id,
       created_by_account_id = COALESCE(t.created_by_account_id, oa.account_id)
  FROM owner_accounts oa
 WHERE t.id = oa.tenant_id
   AND t.owner_account_id IS NULL;

WITH owner_credentials AS (
    SELECT DISTINCT ON (t.id)
           t.id AS tenant_id,
           lower(trim(t.contact_email)) AS email,
           uc.id AS auth_user_id,
           t.created_at
      FROM platform.tenants t
      JOIN auth.user_credentials uc
        ON uc.tenant_id = t.id
       AND lower(uc.email) = lower(t.contact_email)
     WHERE t.id <> '00000000-0000-0000-0000-000000000000'::uuid
       AND t.contact_email IS NOT NULL
       AND trim(t.contact_email) <> ''
       AND uc.password_hash IS NOT NULL
     ORDER BY t.id, uc.created_at ASC
),
owner_accounts AS (
    SELECT oc.tenant_id,
           oc.auth_user_id,
           a.id AS account_id,
           row_number() OVER (PARTITION BY a.id ORDER BY oc.created_at ASC, oc.tenant_id ASC) AS account_workspace_rank
      FROM owner_credentials oc
      JOIN platform.accounts a
        ON lower(a.email) = oc.email
)
INSERT INTO platform.account_workspaces
    (id, account_id, tenant_id, auth_user_id, role, default_workspace,
     status, joined_at, created_at, updated_at)
SELECT gen_random_uuid(),
       oa.account_id,
       oa.tenant_id,
       oa.auth_user_id,
       'OWNER',
       oa.account_workspace_rank = 1
           AND NOT EXISTS (
               SELECT 1
                 FROM platform.account_workspaces existing
                WHERE existing.account_id = oa.account_id
                  AND existing.default_workspace = TRUE
           ),
       'ACTIVE',
       now(),
       now(),
       now()
  FROM owner_accounts oa
ON CONFLICT (account_id, tenant_id) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        role = 'OWNER',
        status = 'ACTIVE',
        updated_at = now();

WITH owner_credentials AS (
    SELECT DISTINCT ON (t.id)
           t.id AS tenant_id,
           uc.id AS auth_user_id
      FROM platform.tenants t
      JOIN auth.user_credentials uc
        ON uc.tenant_id = t.id
       AND lower(uc.email) = lower(t.contact_email)
     WHERE t.id <> '00000000-0000-0000-0000-000000000000'::uuid
       AND t.contact_email IS NOT NULL
       AND trim(t.contact_email) <> ''
       AND uc.password_hash IS NOT NULL
     ORDER BY t.id, uc.created_at ASC
)
INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
SELECT tenant_id,
       auth_user_id,
       '00000000-0000-0000-0000-000000000010'::uuid,
       now(),
       auth_user_id
  FROM owner_credentials
ON CONFLICT DO NOTHING;
