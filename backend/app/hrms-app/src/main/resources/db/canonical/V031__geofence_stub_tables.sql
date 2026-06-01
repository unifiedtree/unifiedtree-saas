-- ============================================================================
-- V031 - Stub tables for GeoFenceAudit and GeoFenceZone entities.
--
-- These entities live in com.hrms.attendance.entity and are picked up by
-- canonical EntityScan. Their endpoints are blocked by @Profile("!canonical")
-- on LegacyAttendanceExtrasController. The tables are created here (in the
-- default public schema, matching @Table(name=...) with no schema attr) so
-- Hibernate ddl-auto=validate passes at startup. They remain empty in
-- canonical and are not exposed via any API.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.geo_fence_zones (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    company_id      UUID            NOT NULL,
    branch_id       UUID,
    department_id   UUID,
    name            VARCHAR(100)    NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    radius_meters   INT             NOT NULL DEFAULT 100,
    punch_method    VARCHAR(30)     NOT NULL DEFAULT 'FACE_RECOGNITION',
    color_hex       VARCHAR(10),
    icon_key        VARCHAR(50),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.geo_fence_audits (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    employee_id     UUID            NOT NULL,
    branch_id       UUID,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    within_fence    BOOLEAN         NOT NULL,
    distance_meters DOUBLE PRECISION,
    action_taken    VARCHAR(50),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    version         BIGINT          NOT NULL DEFAULT 0
);
