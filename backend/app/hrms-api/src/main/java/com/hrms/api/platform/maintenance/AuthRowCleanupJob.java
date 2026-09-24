package com.hrms.api.platform.maintenance;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Nightly purge of dead sign-in rows: refresh tokens that expired or were
 * revoked over a day ago, and OTP requests older than 30 days. Nothing else
 * deleted them, so both tables grew with every sign-in (V143.3 has the detail).
 *
 * <p>The work is one call to {@code auth.purge_dead_auth_rows()}, which sees
 * across workspaces (refresh_tokens has FORCE RLS). Safe on every Cloud Run
 * instance: a second run the same night finds nothing left to delete. Skipped,
 * with a log line, on a database that doesn't have the function yet.
 */
@Component
public class AuthRowCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(AuthRowCleanupJob.class);

    private final JdbcTemplate jdbc;

    public AuthRowCleanupJob(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(cron = "0 30 3 * * *", zone = "Asia/Kolkata")
    public void purge() {
        try {
            Boolean present = jdbc.queryForObject(
                    "SELECT to_regprocedure('auth.purge_dead_auth_rows()') IS NOT NULL", Boolean.class);
            if (!Boolean.TRUE.equals(present)) {
                log.info("Auth cleanup skipped: auth.purge_dead_auth_rows() not installed (V143.3)");
                return;
            }
            Map<String, Object> r = jdbc.queryForMap("SELECT * FROM auth.purge_dead_auth_rows()");
            log.info("Auth cleanup: {} dead refresh tokens and {} old OTP requests deleted",
                    r.get("refresh_tokens_deleted"), r.get("otp_requests_deleted"));
        } catch (Exception e) {
            log.warn("Auth cleanup failed: {}", e.getMessage());
        }
    }
}
