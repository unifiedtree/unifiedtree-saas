-- =============================================================================
-- Fix audit.events.actor_ip type mismatch (platform-wide audit bug).
--
-- The column was created as `inet`, but the AuditEvent entity maps actorIp as a
-- String, so Hibernate binds it as varchar -> Postgres rejects with
-- "column actor_ip is of type inet but expression is of type character varying".
-- Because AuditService.record() runs in @Transactional(REQUIRES_NEW), that error
-- surfaced at the inner-tx commit boundary and silently failed EVERY synchronous
-- audit write that flushes (employee create, leave approve, payroll lock, letter
-- generate, etc.) — discovered 2026-06-16 via the LetterDistributionService build.
--
-- Change the column to varchar so the String binding matches. 45 chars covers a
-- full-notation IPv6 address. IPs are stored/exported as strings in practice.
-- =============================================================================
ALTER TABLE audit.events
    ALTER COLUMN actor_ip TYPE varchar(45) USING actor_ip::text;
