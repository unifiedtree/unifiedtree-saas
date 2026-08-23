package com.hrms.app.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Creates the {@code platform.seat_overage_notifications} dedup table on
 * startup.
 *
 * <p>Flyway is disabled on this deployment ({@code SPRING_FLYWAY_ENABLED=false},
 * {@code ddl-auto: validate}), so a matching migration in
 * {@code db/canonical/V110__seat_overage_notifications.sql} exists as a
 * paper trail but is never run automatically. This bootstrap makes the
 * table land whether or not that migration was applied — the notifier
 * ({@code SeatOverageNotifier}) hits it with raw {@code JdbcTemplate}
 * (no JPA entity → no schema-validation coupling), so an idempotent
 * {@code CREATE TABLE IF NOT EXISTS} at {@code ApplicationReadyEvent} is
 * enough.
 *
 * <p>Same pattern {@link ShiftChangeRequestSchemaBootstrap} uses. Every
 * statement is wrapped so a missing CREATE privilege (or any DDL error) is
 * logged and swallowed — this must NEVER break application startup. If it
 * cannot create the table, the notifier's dedup pre-check swallows the
 * "relation does not exist" error and the seat-usage read still returns
 * normally.
 *
 * <p>TODO(billing-ceiling): drop this table + the notifier + the
 * BILLING_OVER_CAP enum when the Razorpay ceiling flow ships and the hard
 * 402 becomes the universal behaviour.
 */
@Component
@Order(50)
public class SeatOverageSchemaBootstrap {

    private static final Logger log = LoggerFactory.getLogger(SeatOverageSchemaBootstrap.class);

    private final JdbcTemplate jdbc;

    public SeatOverageSchemaBootstrap(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ensureSchema() {
        // (tenant_id, notified_month) is the natural PK — one row per tenant
        // per calendar month says "we alerted this workspace this month". The
        // notifier uses ON CONFLICT DO NOTHING against this PK so two admins
        // opening the dashboard at the same second cannot double-emit.
        //
        // Not RLS-scoped: platform.* is a workspace-scoped table SET managed
        // exclusively by the SaaS backend, not by tenant users, and the
        // notifier already filters WHERE tenant_id = ? explicitly on every
        // read + write. Matches the shape of platform.subscriptions,
        // platform.tenant_modules, platform.tenants — none of which carry RLS
        // policies either.
        exec("""
            CREATE TABLE IF NOT EXISTS platform.seat_overage_notifications (
                tenant_id      UUID NOT NULL,
                notified_month DATE NOT NULL,
                notified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (tenant_id, notified_month)
            )
            """, "create seat_overage_notifications");
    }

    private void exec(String sql, String label) {
        try {
            jdbc.execute(sql);
            log.info("seat-overage schema: {} ok", label);
        } catch (Exception ex) {
            log.warn("seat-overage schema: {} skipped ({})", label, ex.getMessage());
        }
    }
}
