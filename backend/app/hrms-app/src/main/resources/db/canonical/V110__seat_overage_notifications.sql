-- ============================================================================
-- V110 - Dedup table for the BILLING_OVER_CAP admin notification
-- ============================================================================
-- Client rule (Anil punchlist 2026-08-22): tenants that were already over
-- their paid seat cap on the day SeatQuotaEnforcer's hard 402 shipped
-- (nclever, unifiedtree01 — grandfathered) get an in-app warning nudging
-- them to set up autopay for the extras. New tenants never satisfy the
-- trigger — the enforcer blocks the create that would push them over — so
-- this alert is self-selecting.
--
-- Dedup must be race-safe (two admins opening the dashboard simultaneously
-- both hit the seat-usage read on the same second) and cheap on the fast
-- path (the read is polled every 30 seconds by the dashboard tile). One row
-- per (tenant, calendar month) with an ON CONFLICT DO NOTHING claim insert
-- meets both.
--
-- Flyway note: this deployment runs with SPRING_FLYWAY_ENABLED=false, so
-- this file lives here as a paper trail. The bootstrap in
-- com.hrms.app.config.SeatOverageSchemaBootstrap runs an idempotent
-- CREATE TABLE IF NOT EXISTS at ApplicationReadyEvent — the table lands
-- whether or not anyone applies this migration manually.
--
-- Rollback (safe): the notifier's dedup pre-check swallows the "relation
-- does not exist" error and the seat-usage read still returns normally; the
-- warning simply stops being emitted. DROP TABLE platform.seat_overage_notifications;
--
-- TODO(billing-ceiling): drop this table + the notifier + the enum value
-- when the Razorpay ceiling flow ships and everyone hits the hard 402.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.seat_overage_notifications (
    tenant_id      UUID NOT NULL,
    notified_month DATE NOT NULL,
    notified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, notified_month)
);
