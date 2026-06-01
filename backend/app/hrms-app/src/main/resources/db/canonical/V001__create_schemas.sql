-- ============================================================================
-- V001 - UnifiedTree canonical schema bootstrap
-- ============================================================================
-- Creates the per-module Postgres schemas and the tenant-resolution helper
-- used by Row-Level Security policies in every business table.
--
-- Schema map:
--   platform     SaaS tenants, domains, module catalog, tenant module activation
--   auth         user credentials, OTP codes, refresh tokens, sessions
--   rbac         roles, permissions, role-permission grants
--   org          companies, branches, geofence zones (tenant-owned)
--   hrms         departments, designations, employees, contractors, classification rules
--   attendance   punch records, event logs, regularizations, shift policies
--   leave_mgmt   leave types, balances, requests  (avoids reserved word `leave`)
--   settings     holiday calendar, HR config, notification templates
--   audit        append-only audit trail
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS rbac;
CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS hrms;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS leave_mgmt;
CREATE SCHEMA IF NOT EXISTS settings;
CREATE SCHEMA IF NOT EXISTS audit;

-- ----------------------------------------------------------------------------
-- Tenant resolution helper. Every tenant-isolated table has an RLS policy
-- USING (tenant_id = current_tenant_id()).
--
-- The application MUST run this once per transaction:
--   SET LOCAL app.tenant_id = '<uuid>';
-- (LOCAL is required because PgBouncer's transaction pool reuses connections.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION current_tenant_id() IS
    'Returns the tenant UUID set on the current transaction via SET LOCAL app.tenant_id.
     Used by RLS policies. NULL means no tenant set - RLS policies will block all rows.';

-- ----------------------------------------------------------------------------
-- enum-like value domains shared across schemas (avoid duplicate enums per table)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE platform.tenant_status AS ENUM (
        'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'TERMINATED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE platform.plan_tier AS ENUM (
        'STARTER', 'PROFESSIONAL', 'ENTERPRISE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE platform.module_status AS ENUM (
        'REQUESTED', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'EXPIRED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
