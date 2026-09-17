package com.hrms.api.platform;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.YearMonth;

/**
 * Keeps the monthly partitions of {@code attendance.records},
 * {@code attendance.event_logs} and {@code audit.events} ahead of the clock.
 *
 * <p><b>Why this exists.</b> Those three tables are RANGE partitioned by month
 * and {@code ensure_monthly_partition()} has shipped since V007/V010 — but
 * nothing ever called it. There is no pg_cron and no pg_partman on the
 * instance, and a repo-wide search found the function only inside migration
 * files. On 2026-09-13 the newest real partition was {@code 2026_08}, so every
 * September write had been silently landing in the DEFAULT partitions.
 *
 * <p>That fails quietly, which is what makes it dangerous:
 * <ul>
 *   <li>partition pruning stops working for new data, so queries on the
 *       hottest tables in the product degrade toward scanning one
 *       ever-growing child;</li>
 *   <li>Postgres then <em>refuses</em> to create the month's partition while
 *       rows for that month sit in DEFAULT, so the backlog can only be cleared
 *       by detaching DEFAULT and re-routing rows — a lock on a hot table that
 *       gets more expensive every single day.</li>
 * </ul>
 *
 * <p><b>Safe to run on every instance.</b> Cloud Run scales horizontally and
 * there is no leader election here, so N instances each run this. That is fine:
 * the underlying function is {@code CREATE TABLE IF NOT EXISTS}, so concurrent
 * calls are idempotent. A loser in a creation race surfaces as a duplicate-table
 * error, which is caught and logged at debug rather than treated as a failure.
 *
 * <p>The function is SECURITY DEFINER as of V120 — the app connects as
 * {@code ut_app}, which has EXECUTE on it but no CREATE on those schemas.
 *
 * <p>No tenant context is set: this is DDL on shared partitioned tables and is
 * not tenant-scoped. It deliberately does not open a long transaction.
 */
@Component
public class PartitionMaintenanceJob {

    private static final Logger log = LoggerFactory.getLogger(PartitionMaintenanceJob.class);

    /**
     * How many months ahead to keep provisioned. Three means a total outage of
     * this job would have to last a full quarter before anything reached the
     * DEFAULT partition again — comfortably longer than anyone would take to
     * notice, and the cost is a handful of empty tables.
     */
    private static final int MONTHS_AHEAD = 3;

    private final JdbcTemplate jdbc;

    public PartitionMaintenanceJob(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Run once at startup as well as on the daily schedule. A deploy is the
     * most likely moment for someone to be watching logs, and it means a fresh
     * environment is correct immediately instead of at the next 02:40.
     */
    @PostConstruct
    void ensureOnStartup() {
        try {
            ensurePartitions();
        } catch (Exception e) {
            // Never let partition maintenance stop the application booting —
            // the DEFAULT partition still accepts writes.
            log.warn("Startup partition check failed (continuing): {}", e.getMessage());
        }
    }

    /** Daily at 02:40 IST — off the hour to avoid piling onto other cron work. */
    @Scheduled(cron = "0 40 2 * * *", zone = "Asia/Kolkata")
    public void scheduledEnsure() {
        ensurePartitions();
    }

    void ensurePartitions() {
        YearMonth start = YearMonth.from(LocalDate.now());
        int created = 0;
        for (int i = 0; i <= MONTHS_AHEAD; i++) {
            YearMonth ym = start.plusMonths(i);
            created += call("attendance.ensure_monthly_partition", ym);
            created += call("audit.ensure_monthly_partition", ym);
        }
        // Only interesting when it actually did something; otherwise this would
        // be a daily line of noise saying "nothing to do".
        if (created > 0) {
            log.info("Partition maintenance: ensured {} partition group(s) through {}",
                    created, start.plusMonths(MONTHS_AHEAD));
        }
    }

    private int call(String fn, YearMonth ym) {
        try {
            jdbc.queryForObject("SELECT " + fn + "(?, ?)", Object.class,
                    ym.getYear(), ym.getMonthValue());
            return 1;
        } catch (Exception e) {
            // Another instance winning the race is expected, not a problem.
            log.debug("{}({}, {}) skipped: {}", fn, ym.getYear(), ym.getMonthValue(), e.getMessage());
            return 0;
        }
    }
}
