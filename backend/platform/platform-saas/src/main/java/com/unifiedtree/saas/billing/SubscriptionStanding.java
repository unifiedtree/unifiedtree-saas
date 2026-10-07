package com.unifiedtree.saas.billing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Whether a subscription still pays for its modules: the one rule behind the HRMS request guard
 * ({@code SubscriptionAccessGuard}) and the company entitlement answer ({@code CompanyEntitlementService}),
 * so a lapsed subscription pauses the same modules in HRMS, in the admin console and in Marketing.
 *
 * <p>Owner rule, 6 Oct 2026:
 * <ul>
 *   <li>TRIALING / ACTIVE / PAUSED / GRACE: allowed.</li>
 *   <li>PAST_DUE: allowed until {@link #GRACE} after the due date ({@code past_due_since}, V144_1).</li>
 *   <li>HALTED / CANCELLED / EXPIRED / COMPLETED: allowed until {@code grace_until}, then paused.</li>
 *   <li>Unknown status: allowed (fail open, never worse than before).</li>
 * </ul>
 * Only the subscription's own modules pause ({@link #pauses}); a workspace with no subscription row at all is
 * refused unless it is on the grandfather list ({@code unifiedtree.subscription.grandfather-tenant-ids}).
 */
public final class SubscriptionStanding {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionStanding.class);

    /** Grace after the due date (owner rule, 6 Oct 2026). */
    public static final Duration GRACE = Duration.ofDays(7);

    private SubscriptionStanding() {}

    /** One subscription as the rule needs it. {@code modules} empty = it covers every module. */
    public record Standing(UUID subscriptionId, String status, Instant graceUntil, Instant pastDueSince,
                           List<String> modules) {}

    public record Decision(boolean allowed, String reason) {
        public static Decision allow() { return new Decision(true, null); }
        public static Decision deny(String reason) { return new Decision(false, reason); }
    }

    public static Decision evaluate(String status, Instant graceUntil, Instant pastDueSince, Instant now) {
        if (status == null) return Decision.allow();
        return switch (status) {
            case "PAST_DUE" -> {
                // Razorpay is still retrying; pause once 7 days have passed since the due date.
                if (pastDueSince != null && !pastDueSince.plus(GRACE).isAfter(now)) {
                    yield Decision.deny("The payment due on this subscription wasn't received within 7 days. "
                            + "Pay to continue; sign-in stays open.");
                }
                yield Decision.allow();
            }
            case "TRIALING", "ACTIVE", "PAUSED", "GRACE" -> Decision.allow();
            case "HALTED" -> {
                if (graceUntil != null && graceUntil.isAfter(now)) yield Decision.allow();   // still inside grace
                yield Decision.deny("The payment wasn't received and the 7-day grace period has ended. "
                        + "Pay to continue; sign-in stays open.");
            }
            case "CANCELLED", "EXPIRED", "COMPLETED" -> {
                // Honour whatever period the customer paid for. onCancelled stamps grace_until =
                // current_period_end (falls back to now+3d if there was no period end, e.g. mandate deleted
                // mid-trial), so a cancel on day 20 of a paid month keeps working through the rest of that month.
                if (graceUntil != null && graceUntil.isAfter(now)) yield Decision.allow();
                yield Decision.deny(switch (status) {
                    case "CANCELLED" -> "This subscription was cancelled and the paid period has ended. "
                                      + "Start a new one to restore access.";
                    case "EXPIRED"   -> "This subscription has expired. Start a new one to restore access.";
                    default          -> "This subscription completed its billing cycles. Start a new one to continue.";
                });
            }
            default -> Decision.allow();     // unknown status: fail-open (never worse than today)
        };
    }

    public static Decision evaluate(Standing s, Instant now) {
        return evaluate(s.status(), s.graceUntil(), s.pastDueSince(), now);
    }

    /** Whether a lapse pauses this module (no module = never; no module list = all). */
    public static boolean pauses(List<String> modules, String moduleKey) {
        if (moduleKey == null) return false;
        return modules == null || modules.isEmpty() || modules.contains(moduleKey);
    }

    /** The reason this module is paused right now, or null when it is not. */
    public static String pausedReason(Standing s, String moduleKey, Instant now) {
        Decision d = evaluate(s, now);
        return !d.allowed() && pauses(s.modules(), moduleKey) ? d.reason() : null;
    }

    /** The grandfather list: workspaces with no subscription row that are still let in. Bad entries are skipped. */
    public static Set<UUID> parseGrandfathered(String csv) {
        if (csv == null || csv.isBlank()) return Set.of();
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(s -> {
                    try { return UUID.fromString(s); }
                    catch (IllegalArgumentException e) {
                        log.warn("grandfather list has invalid uuid '{}' — skipping", s);
                        return null;
                    }
                })
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));
    }
}
