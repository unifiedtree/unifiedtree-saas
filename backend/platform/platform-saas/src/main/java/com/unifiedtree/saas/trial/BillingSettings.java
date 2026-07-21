package com.unifiedtree.saas.trial;

/**
 * Snapshot of the singleton {@code platform.billing_settings} row.
 *
 * <p>Trial length, warning offset and the upgrade URL are DB-driven so product
 * can tune them with a single UPDATE — no code deploy. Values are safe defaults
 * (7 / 1 / marketing pricing page); the DB row is authoritative in production.
 */
public record BillingSettings(
        boolean trialEnabled,
        int trialDays,
        int trialWarningDaysBefore,
        String upgradeUrl
) {
    public static BillingSettings defaults() {
        return new BillingSettings(true, 7, 1, "https://www.unifiedtree.com/pricing");
    }
}
