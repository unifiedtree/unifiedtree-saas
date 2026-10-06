package com.unifiedtree.saas.entitlement;

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

    static Instant ago(long days) { return NOW.minus(Duration.ofDays(days)); }
    static Instant in(long days) { return NOW.plus(Duration.ofDays(days)); }

    @Test
    void noRowsAndNoWorkspaceGrantMeansNotEntitled() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(), null, NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("NONE");
    }

    @Test
    void activeSubscriptionRowEntitles() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("SUBSCRIPTION", "ACTIVE", ago(10), in(20))), null, NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("SUBSCRIPTION");
    }

    @Test
    void manualSuspensionBeatsAPaidSubscription() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(
                row("SUBSCRIPTION", "ACTIVE", ago(10), in(20)),
                row("MANUAL", "SUSPENDED", ago(1), null)), null, NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("MANUAL");
        assertThat(e.status()).isEqualTo("SUSPENDED");
    }

    @Test
    void manualActivationWorksWithoutASubscription() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("MANUAL", "ACTIVE", ago(1), in(30))), null, NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("MANUAL");
    }

    @Test
    void anExpiredManualOverrideNoLongerDecides() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp", List.of(
                row("MANUAL", "SUSPENDED", ago(30), ago(1)),
                row("SUBSCRIPTION", "ACTIVE", ago(10), in(20))), null, NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("SUBSCRIPTION");
    }

    @Test
    void aCancelledManualOverrideIsIgnored() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("MANUAL", "CANCELLED", ago(5), null)), null, NOW);
        assertThat(e.entitled()).isFalse();
        assertThat(e.source()).isEqualTo("NONE");
    }

    @Test
    void anEndedTrialDoesNotEntitle() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("TRIAL", "ACTIVE", ago(10), ago(3))), null, NOW);
        assertThat(e.entitled()).isFalse();
    }

    @Test
    void aFutureStartDoesNotEntitleYet() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("SUBSCRIPTION", "ACTIVE", in(2), in(30))), null, NOW);
        assertThat(e.entitled()).isFalse();
    }

    @Test
    void workspaceGrantStillWorksForProductsGrantedPerWorkspace() {
        // HRMS today: granted per workspace in tenant_modules, no company rows.
        Entitlement e = CompanyEntitlementService.decide("hrms", List.of(),
                Map.of("status", "ACTIVE"), NOW);
        assertThat(e.entitled()).isTrue();
        assertThat(e.source()).isEqualTo("WORKSPACE");
    }

    @Test
    void anExpiredWorkspaceGrantDoesNotEntitle() {
        Entitlement e = CompanyEntitlementService.decide("hrms", List.of(),
                Map.of("status", "ACTIVE", "expires_at", Timestamp.from(ago(1))), NOW);
        assertThat(e.entitled()).isFalse();
    }

    @Test
    void companySuspensionAlsoBeatsTheWorkspaceGrant() {
        Entitlement e = CompanyEntitlementService.decide("whatsapp",
                List.of(row("MANUAL", "SUSPENDED", ago(1), null)), Map.of("status", "ACTIVE"), NOW);
        assertThat(e.entitled()).isFalse();
    }
}
