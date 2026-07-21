package com.unifiedtree.saas.trial;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Reads {@link BillingSettings} from the singleton {@code platform.billing_settings}
 * row. Callers use this instead of hardcoding trial length / warning offset
 * anywhere — product tunes the numbers via UPDATE, we redeploy nothing.
 *
 * <p>Falls back to {@link BillingSettings#defaults()} on any read failure so a
 * missing/malformed row can never crash signup or the daily job.
 */
@Service
public class BillingSettingsService {

    private static final Logger log = LoggerFactory.getLogger(BillingSettingsService.class);

    private final JdbcTemplate jdbc;

    public BillingSettingsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public BillingSettings current() {
        try {
            return jdbc.queryForObject("""
                    SELECT trial_enabled, trial_days, trial_warning_days_before, upgrade_url
                      FROM platform.billing_settings
                     WHERE id = 1
                    """, (rs, n) -> new BillingSettings(
                    rs.getBoolean("trial_enabled"),
                    rs.getInt("trial_days"),
                    rs.getInt("trial_warning_days_before"),
                    rs.getString("upgrade_url")));
        } catch (EmptyResultDataAccessException e) {
            log.warn("billing_settings row missing — using defaults");
            return BillingSettings.defaults();
        } catch (Exception e) {
            log.warn("billing_settings read failed: {} — using defaults", e.getMessage());
            return BillingSettings.defaults();
        }
    }
}
