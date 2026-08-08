package com.hrms.api.trial;

import com.unifiedtree.saas.trial.BillingSettings;
import com.unifiedtree.saas.trial.BillingSettingsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Daily sweep over {@code platform.subscriptions} for TRIAL rows that need
 * attention. Runs once per day at 08:30 Asia/Kolkata (well after midnight and
 * before Indian business hours pick up).
 *
 * <p>Two passes, both idempotent via one-shot stamps on the row:
 * <ol>
 *   <li>{@code warning} — ACTIVE trials with {@code current_period_end}
 *       within {@code trial_warning_days_before} days AND no
 *       {@code trial_warning_sent_at}. Send in-app + email, stamp the row.</li>
 *   <li>{@code expiry} — trials past {@code current_period_end} still
 *       ACTIVE. Flip status to EXPIRED and stamp {@code trial_expired_notice_sent_at};
 *       then notify. The workspace is UNTOUCHED (product decision: never lock out).</li>
 * </ol>
 *
 * <p>Ordering matters: expiry runs first so today's expiries also stamp the
 * "expired" notice (not a warning for the same day). Best-effort; any single
 * tenant's failure is logged and does not stop the sweep.
 */
@Component
public class TrialLifecycleJob {

    private static final Logger log = LoggerFactory.getLogger(TrialLifecycleJob.class);

    /**
     * Trials that lapsed more than this many days ago are flipped to EXPIRED
     * silently, without an email.
     *
     * <p>Latent safety for whenever this job is first switched on. It has
     * never run in production — {@code com.hrms.api.trial} is deliberately
     * absent from {@code CanonicalProfileScan} because the mandate-less trial
     * it serves is retired (see that class for the full reasoning). So its
     * first real sweep, whenever that happens, will meet the entire
     * historical backlog at once. Flipping those rows is correct bookkeeping;
     * emailing someone that a trial they forgot about ended weeks ago is not.
     */
    private static final int BACKFILL_GRACE_DAYS = 2;

    private final JdbcTemplate jdbc;
    private final BillingSettingsService billingSettings;
    private final TrialNotificationService notifier;

    public TrialLifecycleJob(JdbcTemplate jdbc,
                             BillingSettingsService billingSettings,
                             TrialNotificationService notifier) {
        this.jdbc = jdbc;
        this.billingSettings = billingSettings;
        this.notifier = notifier;
    }

    /** 08:30 Asia/Kolkata every day. */
    @Scheduled(cron = "0 30 8 * * *", zone = "Asia/Kolkata")
    public void run() {
        runOnce();
    }

    /** Package-visible so tests / admin endpoints can trigger a manual sweep. */
    public void runOnce() {
        BillingSettings s = billingSettings.current();
        String upgradeUrl = s.upgradeUrl();

        int expired = processExpired(upgradeUrl);
        int warned = processWarning(s.trialWarningDaysBefore(), upgradeUrl);
        log.info("TrialLifecycleJob: expired={} warned={}", expired, warned);
    }

    // -- expiry pass -----------------------------------------------------------

    private int processExpired(String upgradeUrl) {
        // `stale` = expired longer ago than BACKFILL_GRACE_DAYS.
        //
        // BACKFILL SAFETY. This job was absent from the canonical component
        // scan and so had never run in production: no trial was ever flipped
        // to EXPIRED and no notice was ever sent. The moment it is enabled it
        // therefore meets the entire historical backlog at once. Flipping
        // those rows is correct bookkeeping and we do it — but emailing them
        // is not: telling someone "your free trial has ended" about a trial
        // that lapsed weeks ago is confusing at best, and a burst of them
        // going out simultaneously to real customers is worse. So stale rows
        // are stamped silently and only genuinely-recent expiries notify.
        // After the first sweep the backlog is gone and this predicate stops
        // mattering.
        List<TrialRow> rows = jdbc.query("""
                SELECT id, tenant_id, subdomain,
                       (current_period_end < now() - make_interval(days => ?)) AS stale
                  FROM platform.subscriptions
                 WHERE plan_type = 'TRIAL'
                   AND status = 'ACTIVE'
                   AND current_period_end <= now()
                   AND trial_expired_notice_sent_at IS NULL
                """, TrialLifecycleJob::mapRow, BACKFILL_GRACE_DAYS);

        int notified = 0;
        for (TrialRow r : rows) {
            try {
                // Flip + stamp FIRST so a crash in the notifier can't cause a
                // repeat send tomorrow. The tenant/roles/modules are untouched
                // — only this ledger row changes state.
                int updated = jdbc.update("""
                        UPDATE platform.subscriptions
                           SET status = 'EXPIRED',
                               trial_expired_notice_sent_at = now(),
                               updated_at = now()
                         WHERE id = ?
                           AND plan_type = 'TRIAL'
                           AND status = 'ACTIVE'
                        """, r.id());
                if (updated == 0) continue; // raced with another worker; skip

                if (r.stale()) {
                    log.info("trial-expiry: subscription {} (tenant {}) expired more than {}d ago — "
                             + "status flipped, notice suppressed as backlog",
                            r.id(), r.tenantId(), BACKFILL_GRACE_DAYS);
                    continue;
                }
                notifier.notifyExpired(r.tenantId(), r.subdomain(), upgradeUrl);
                notified++;
            } catch (Exception ex) {
                log.warn("trial-expiry failed for subscription {}: {}", r.id(), ex.getMessage());
            }
        }
        return notified;
    }

    // -- warning pass ----------------------------------------------------------

    private int processWarning(int warnDaysBefore, String upgradeUrl) {
        if (warnDaysBefore < 0) return 0;
        List<TrialRow> rows = jdbc.query("""
                SELECT id, tenant_id, subdomain
                  FROM platform.subscriptions
                 WHERE plan_type = 'TRIAL'
                   AND status = 'ACTIVE'
                   AND trial_warning_sent_at IS NULL
                   AND current_period_end > now()
                   AND current_period_end <= now() + make_interval(days => ?)
                """, TrialLifecycleJob::mapRow, warnDaysBefore);

        int notified = 0;
        for (TrialRow r : rows) {
            try {
                int updated = jdbc.update("""
                        UPDATE platform.subscriptions
                           SET trial_warning_sent_at = now(), updated_at = now()
                         WHERE id = ?
                           AND trial_warning_sent_at IS NULL
                        """, r.id());
                if (updated == 0) continue;

                // Compute days-left server-side (was in the ORDER BY already but not returned).
                Integer daysLeft = jdbc.queryForObject("""
                        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (current_period_end - now()))/86400))::int
                          FROM platform.subscriptions WHERE id = ?
                        """, Integer.class, r.id());
                notifier.notifyEndingSoon(r.tenantId(), r.subdomain(),
                        daysLeft == null ? 1 : daysLeft, upgradeUrl);
                notified++;
            } catch (Exception ex) {
                log.warn("trial-warning failed for subscription {}: {}", r.id(), ex.getMessage());
            }
        }
        return notified;
    }

    private static TrialRow mapRow(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        boolean stale = hasColumn(rs, "stale") && rs.getBoolean("stale");
        return new TrialRow(
                UUID.fromString(rs.getString("id")),
                rs.getObject("tenant_id", UUID.class),
                rs.getString("subdomain"),
                stale);
    }

    /** The warning pass reuses this mapper but selects no {@code stale} column. */
    private static boolean hasColumn(java.sql.ResultSet rs, String name) throws java.sql.SQLException {
        java.sql.ResultSetMetaData md = rs.getMetaData();
        for (int i = 1; i <= md.getColumnCount(); i++) {
            if (name.equalsIgnoreCase(md.getColumnLabel(i))) return true;
        }
        return false;
    }

    private record TrialRow(UUID id, UUID tenantId, String subdomain, boolean stale) {}
}
