package com.unifiedtree.saas.plans;

import java.util.Locale;

/**
 * How often a workspace is billed. Drives the number of months a single charge
 * covers and whether the annual per-plan discount applies.
 */
public enum BillingCycle {
    MONTHLY(1),
    ANNUAL(12);

    private final int months;

    BillingCycle(int months) {
        this.months = months;
    }

    /** Months covered by one charge: 1 for monthly, 12 for annual. */
    public int months() {
        return months;
    }

    /** Lenient parse — anything unrecognised falls back to MONTHLY (the safe default). */
    public static BillingCycle from(String raw) {
        if (raw == null || raw.isBlank()) return MONTHLY;
        try {
            return BillingCycle.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return MONTHLY;
        }
    }
}
