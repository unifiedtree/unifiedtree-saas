package com.hrms.app.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Creates the {@code attendance.shift_change_requests} table on startup.
 *
 * <p>Flyway is disabled on this deployment ({@code SPRING_FLYWAY_ENABLED=false},
 * {@code ddl-auto: validate}), so a normal migration would not run and a JPA
 * {@code @Entity} would fail schema validation before it exists. Instead this
 * runs an idempotent {@code CREATE TABLE IF NOT EXISTS} once the context is
 * ready, and the shift-change-request feature accesses the table via raw
 * {@code JdbcTemplate} (no entity → no validation coupling).
 *
 * <p>Every statement is wrapped so a missing CREATE privilege (or any DDL
 * error) is logged and swallowed — it must NEVER break application startup. If
 * it cannot create the table, the feature's endpoints degrade gracefully and an
 * operator can apply the same DDL manually.
 */
@Component
@Order(50)
public class ShiftChangeRequestSchemaBootstrap {

    private static final Logger log = LoggerFactory.getLogger(ShiftChangeRequestSchemaBootstrap.class);

    private final JdbcTemplate jdbc;

    public ShiftChangeRequestSchemaBootstrap(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ensureSchema() {
        exec("""
            CREATE TABLE IF NOT EXISTS attendance.shift_change_requests (
                id                        UUID PRIMARY KEY,
                tenant_id                 UUID NOT NULL,
                employee_id               UUID NOT NULL,
                current_shift_policy_id   UUID,
                requested_shift_policy_id UUID NOT NULL,
                reason                    TEXT,
                status                    VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                approver_id               UUID,
                decision_note             TEXT,
                decided_at                TIMESTAMPTZ,
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """, "create shift_change_requests");
        exec("CREATE INDEX IF NOT EXISTS idx_scr_tenant_status "
                + "ON attendance.shift_change_requests (tenant_id, status)", "idx_scr_tenant_status");
        exec("CREATE INDEX IF NOT EXISTS idx_scr_employee "
                + "ON attendance.shift_change_requests (tenant_id, employee_id)", "idx_scr_employee");
        // Best-effort RLS — matches the rest of attendance.*. If the app role
        // lacks privilege the table is still protected by explicit tenant_id
        // filtering in every query (ShiftChangeRequestService).
        exec("ALTER TABLE attendance.shift_change_requests ENABLE ROW LEVEL SECURITY", "enable RLS");
        exec("DROP POLICY IF EXISTS tenant_isolation_scr ON attendance.shift_change_requests", "drop old policy");
        exec("""
            CREATE POLICY tenant_isolation_scr ON attendance.shift_change_requests
                USING (tenant_id = current_tenant_id())
                WITH CHECK (tenant_id = current_tenant_id())
            """, "create RLS policy");
    }

    private void exec(String sql, String label) {
        try {
            jdbc.execute(sql);
            log.info("shift-change schema: {} ok", label);
        } catch (Exception ex) {
            log.warn("shift-change schema: {} skipped ({})", label, ex.getMessage());
        }
    }
}
