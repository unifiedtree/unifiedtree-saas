-- ============================================================================
-- V113 — Backfill hrms.employees.branch_id from the assigned geofence zone
-- ============================================================================
--
-- Context: Anil Issue Document 2, item 1 (2026-09-01).
--
-- HR sets a Geofence per employee (mandatory for attendance) but rarely sets
-- Branch. The Workforce Directory's Branch column shows "—" for every row
-- because it renders hrms.employees.branch_id, which is null.
--
-- The client's mental model is Branch → Geofence → Employee, so an employee's
-- branch should be *inferred* from the geofence unless HR overrides it.
-- GeoFenceZone already carries a branch_id, so this is a pure back-fill.
--
-- WorkforceEmployeeService.create() / update() were changed in the same commit
-- to derive branch_id from geo_fence_zone_id at write time; this migration
-- closes the gap for rows that already exist.
--
-- Semantics:
--   * ONLY updates rows whose branch_id is currently NULL — never overwrites
--     an admin's explicit branch pick.
--   * Skips employees with no geofence and geofences with no branch — those
--     rows legitimately stay branch-less.
--   * Uses tenant_id to keep the join scoped (no accidental cross-tenant
--     joins even if RLS is bypassed at migration time).
--
-- Reversible: no; the pre-state (branch_id = NULL where geofence has a branch)
-- was itself the bug. If restore is needed the pre-image is in the snapshot
-- Cloud SQL takes on this DB.

-- Schema note: the GeoFenceZone entity lives at public.geo_fence_zones
-- (@Table(schema = "public") in com.hrms.attendance.entity.GeoFenceZone).
-- A parallel org.geofence_zones exists from an early split but the app
-- doesn't write to it — the JPA-mapped one is the source of truth.
UPDATE hrms.employees e
   SET branch_id = z.branch_id
  FROM public.geo_fence_zones z
 WHERE e.geo_fence_zone_id IS NOT NULL
   AND e.branch_id IS NULL
   AND z.id = e.geo_fence_zone_id
   AND z.branch_id IS NOT NULL
   AND z.tenant_id = e.tenant_id;
