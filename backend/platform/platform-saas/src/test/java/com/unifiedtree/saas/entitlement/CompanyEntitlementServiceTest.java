package com.unifiedtree.saas.entitlement;

import com.unifiedtree.saas.billing.SubscriptionStanding.Standing;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.Billing;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.CompanyModuleRow;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.Entitlement;
import org.junit.jupiter.api.Test;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** The precedence rule that decides whether a company has a product. */
class CompanyEntitlementServiceTest {

    static final Instant NOW = Instant.parse("2026-10-06T12:00:00Z");
    static final UUID TENANT = UUID.randomUUID();
    static final UUID COMPANY = UUID.randomUUID();

    static CompanyModuleRow row(String source, String status, Instant starts, Instant ends) {
        return new CompanyModuleRow(UUID.randomUUID(), TENANT, COMPANY, "whatsapp", status, source,
                null, null, starts, ends, "MANUAL".equals(source) ? "operator reason" : null, "platform:ops@x",
                null, NOW.minus(Duration.ofDays(1)));
    }

    /** Billing that never pauses: no subscriptions known, workspace grandfathered. */
    static final Billing GOOD = new Billing(Map.of(), null, true);

    static Instant ago(long days) { return NOW.minus(Duration.ofDays(days)); }
    static Instant in(long days) { return NOW.plus(Duration.ofDays(days)); }

    @Test
    void noRowsAndNoWorkspaceGrantMeansNotEntitled() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(), null, GOOD, NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("NONE");
    }

    @Test
    void activeSubscriptionRowEntitles() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("SUBSCRIPTION", "ACTIVE", ago(10), in(20))), null, GOOD, NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("SUBSCRIPTION");
    }

    @Test
    void manualSuspensionBeatsAPaidSubscription() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(
                row("SUBSCRIPTION", "ACTIVE", ago(10), in(20)),
                row("MANUAL", "SUSPENDED", ago(1), null)), null, GOOD, NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("MANUAL");
        assertThat(e.status()).isEqualTo("SUSPENDED");
    }

    @Test
    void manualActivationWorksWithoutASubscription() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("MANUAL", "ACTIVE", ago(1), in(30))), null, GOOD, NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("MANUAL");
    }

    @Test
    void anExpiredManualOverrideNoLongerDecides() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(
                row("MANUAL", "SUSPENDED", ago(30), ago(1)),
                row("SUBSCRIPTION", "ACTIVE", ago(10), in(20))), null, GOOD, NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("SUBSCRIPTION");
    }

    @Test
    void aCancelledManualOverrideIsIgnored() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("MANUAL", "CANCELLED", ago(5), null)), null, GOOD, NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("NONE");
    }

    @Test
    void anEndedTrialDoesNotEntitle() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("TRIAL", "ACTIVE", ago(10), ago(3))), null, GOOD, NOW);
        assertThat(e.entitled()).isFalse();
    }

    @Test
    void aFutureStartDoesNotEntitleYet() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("SUBSCRIPTION", "ACTIVE", in(2), in(30))), null, GOOD, NOW);
        assertThat(e.entitled()).isFalse();
    }

    @Test
    void workspaceGrantStillWorksForProductsGrantedPerWorkspace() {
        // HRMS today: granted per workspace in tenant_modules, no company rows.
        Entitlement e = CompanyEntitlementService.decide("hrms", List.of(),
                Map.of("status", "ACTIVE"), GOOD, NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("WORKSPACE");
    }

    @Test
    void anExpiredWorkspaceGrantDoesNotEntitle() {
        Entitlement e = CompanyEntitlementService.decide("hrms", List.of(),
                Map.of("status", "ACTIVE", "expires_at", Timestamp.from(ago(1))), GOOD, NOW);
        assertThat(e.entitled()).isFalse();
    }

    @Test
    void companySuspensionAlsoBeatsTheWorkspaceGrant() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("MANUAL", "SUSPENDED", ago(1), null)), Map.of("status", "ACTIVE"), GOOD, NOW);
        assertThat(e.entitled()).isFalse();
    }

    // ── Pause: the same SubscriptionStanding rule as the HRMS guard ─────────

    static final UUID SUB = UUID.randomUUID();

    static CompanyModuleRow paidRow() {
        return new CompanyModuleRow(UUID.randomUUID(), TENANT, COMPANY, "whatsapp", "ACTIVE", "SUBSCRIPTION",
                SUB, 5, ago(40), in(20), null, null, null, NOW.minus(Duration.ofDays(1)));
    }

    static Billing subIs(String status, Instant graceUntil, Instant pastDueSince, List<String> modules) {
        return new Billing(Map.of(SUB, new Standing(SUB, status, graceUntil, pastDueSince, modules)), null, false);
    }

    @Test
    void aHaltedSubscriptionPastGracePausesTheCompanyProduct() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(paidRow()), null,
                subIs("HALTED", ago(1), null, List.of()), NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("SUBSCRIPTION");
        assertThat(e.status()).isEqualTo(CompanyEntitlementService.STATUS_PAUSED);
        assertThat(e.reason()).contains("grace period has ended");
    }

    @Test
    void pastDuePausesOnlyAfterSevenDays() {
        assertThat(CompanyEntitlementService.decide("whatsapp", List.of(paidRow()), null,
                subIs("PAST_DUE", null, ago(6), List.of()), NOW).entitled()).isTrue();
        assertThat(CompanyEntitlementService.decide("whatsapp", List.of(paidRow()), null,
                subIs("PAST_DUE", null, ago(7), List.of()), NOW).entitled()).isFalse();
    }

    @Test
    void aLapsedSubscriptionOnlyPausesItsOwnModules() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(paidRow()), null,
                subIs("HALTED", ago(1), null, List.of("payroll")), NOW);
        assertThat(e.entitled()).isTrue();
    }

    @Test
    void aCancelledSubscriptionKeepsWorkingThroughThePaidPeriod() {
        assertThat(CompanyEntitlementService.decide("whatsapp", List.of(paidRow()), null,
                subIs("CANCELLED", in(10), null, List.of()), NOW).entitled()).isTrue();
        assertThat(CompanyEntitlementService.decide("whatsapp", List.of(paidRow()), null,
                subIs("CANCELLED", ago(1), null, List.of()), NOW).entitled()).isFalse();
    }

    @Test
    void anOperatorsManualActivationIsNotPaused() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(paidRow(), row("MANUAL", "ACTIVE", ago(1), in(30))), null,
                subIs("HALTED", ago(1), null, List.of()), NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("MANUAL");
    }

    @Test
    void aWorkspaceGrantPausesWithTheWorkspacesLatestSubscription() {
        Billing lapsed = new Billing(Map.of(), new Standing(SUB, "EXPIRED", null, null, List.of()), false);
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(), Map.of("status", "ACTIVE"),
                lapsed, NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("WORKSPACE");
        assertThat(e.status()).isEqualTo(CompanyEntitlementService.STATUS_PAUSED);
    }

    @Test
    void aWorkspaceGrantWithNoSubscriptionNeedsTheGrandfatherList() {
        Map<String, Object> ws = Map.of("status", "ACTIVE");
        assertThat(CompanyEntitlementService.decide("whatsapp", List.of(), ws,
                new Billing(Map.of(), null, false), NOW).entitled()).isFalse();
        assertThat(CompanyEntitlementService.decide("whatsapp", List.of(), ws,
                new Billing(Map.of(), null, true), NOW).entitled()).isTrue();
    }

    @Test
    void manualSwitchingIsMarketingOnly() {
        assertThat(CompanyEntitlementService.MANUAL_MODULES).containsExactly("whatsapp");
    }
}
