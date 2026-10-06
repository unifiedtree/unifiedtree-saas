package com.unifiedtree.saas.billing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Whether V144_1 (platform.subscriptions.past_due_since + platform.billing_reminders_sent)
 * is applied. Production applies migrations by hand, sometimes after the deploy, so the
 * code that uses them asks here first and skips its extra work until they exist — a
 * missing column must never break a webhook or the reconciler (inside a transaction a
 * failed statement would also poison the statements after it).
 *
 * <p>A "yes" is remembered for good; a "no" is re-checked every 10 minutes.
 */
@Component
public class BillingReminderSchema {

    private static final Logger log = LoggerFactory.getLogger(BillingReminderSchema.class);
    private static final long RECHECK_MS = 10 * 60 * 1000L;

    private final JdbcTemplate jdbc;
    private volatile boolean ready;
    private volatile long checkedAt;

    public BillingReminderSchema(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean ready() {
        if (ready) return true;
        long now = System.currentTimeMillis();
        if (checkedAt != 0 && now - checkedAt < RECHECK_MS) return false;
        checkedAt = now;
        try {
            ready = Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                                    WHERE table_schema = 'platform' AND table_name = 'subscriptions'
                                      AND column_name = 'past_due_since')
                       AND to_regclass('platform.billing_reminders_sent') IS NOT NULL
                    """, Boolean.class));
        } catch (RuntimeException e) {
            log.warn("billing reminder schema check failed: {}", e.getMessage());
            ready = false;
        }
        if (!ready) log.info("V144_1 not applied yet — payment reminders and due-date grace are off until it is");
        return ready;
    }
}
