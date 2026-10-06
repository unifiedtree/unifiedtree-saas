package com.hrms.api.saasguard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.saasguard.SubscriptionAccessGuard.AccessDecision;
import com.hrms.api.saasguard.SubscriptionAccessGuard.SubStatus;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** After the grace only the unpaid modules pause; sign-in and business pages stay open (owner, 6 Oct 2026). */
class ModulePauseTest {

    private static final Instant NOW = Instant.parse("2026-11-14T06:30:00Z");
    private static final List<String> HRMS = List.of("hrms", "attendance", "leave", "payroll");

    private static SubStatus pastDue(Instant dueSince) {
        return new SubStatus("PAST_DUE", null, "sub_1", HRMS, new BigDecimal("4000.00"), dueSince);
    }

    @Test
    void pastDueKeepsWorkingForSevenDaysAfterTheDueDateThenPauses() {
        assertThat(SubscriptionAccessGuard.evaluate(pastDue(NOW.minus(Duration.ofDays(6))), NOW).allowed()).isTrue();
        assertThat(SubscriptionAccessGuard.evaluate(pastDue(NOW.minus(Duration.ofDays(7))), NOW).allowed()).isFalse();
        // Without V144_1 (no due date known) PAST_DUE never pauses, as before.
        assertThat(SubscriptionAccessGuard.evaluate(pastDue(null), NOW).allowed()).isTrue();
    }

    @Test
    void haltedStillPausesOnlyAfterItsGrace() {
        assertThat(SubscriptionAccessGuard.evaluate(new SubStatus("HALTED", NOW.plusSeconds(60)), NOW).allowed()).isTrue();
        assertThat(SubscriptionAccessGuard.evaluate(new SubStatus("HALTED", NOW.minusSeconds(60)), NOW).allowed()).isFalse();
    }

    @Test
    void onlyTheUnpaidModulesPause() {
        SubStatus sub = pastDue(NOW.minus(Duration.ofDays(9)));
        assertThat(SubscriptionAccessGuard.pauses(sub, TenantModuleGuard.moduleForPath("/v1/leave/requests"))).isTrue();
        assertThat(SubscriptionAccessGuard.pauses(sub, TenantModuleGuard.moduleForPath("/v1/payroll/runs"))).isTrue();
        assertThat(SubscriptionAccessGuard.pauses(sub, TenantModuleGuard.moduleForPath("/v1/hrms/employees"))).isTrue();
        // Business-level calls need no module: they stay open so the owner can pay.
        for (String open : List.of("/v1/me/companies", "/v1/notifications", "/v1/workspace/seats/usage", "/v1/settings/users", "/v1/users")) {
            assertThat(SubscriptionAccessGuard.pauses(sub, TenantModuleGuard.moduleForPath(open))).as(open).isFalse();
        }
        // A module this subscription doesn't cover is not paused by it.
        SubStatus onlyPayroll = new SubStatus("HALTED", NOW.minusSeconds(1), "sub_2", List.of("payroll"), null, null);
        assertThat(SubscriptionAccessGuard.pauses(onlyPayroll, "leave")).isFalse();
        assertThat(SubscriptionAccessGuard.pauses(onlyPayroll, "payroll")).isTrue();
        // A legacy row without a module list pauses every module path (today's behaviour for module calls).
        assertThat(SubscriptionAccessGuard.pauses(new SubStatus("HALTED", NOW.minusSeconds(1)), "leave")).isTrue();
    }

    @Test
    void theBodyCarriesTheAgreedFields() throws Exception {
        SubStatus sub = pastDue(Instant.parse("2026-11-05T18:30:00Z"));   // due 6 Nov (IST)
        AccessDecision d = SubscriptionAccessGuard.evaluate(sub, NOW);
        JsonNode b = new ObjectMapper().readTree(SubscriptionAccessGuard.pausedBody(sub, d, "leave", NOW, true));

        assertThat(b.get("code").asText()).isEqualTo("MODULE_PAUSED");
        assertThat(b.get("error").asText()).isEqualTo("subscription_lapsed");
        assertThat(b.get("moduleKey").asText()).isEqualTo("leave");
        assertThat(b.get("companyId").isNull()).isTrue();
        assertThat(b.get("dueAmountInr").decimalValue()).isEqualByComparingTo("4000");
        assertThat(b.get("dueSince").asText()).isEqualTo("2026-11-06");
        assertThat(b.get("graceEndedOn").asText()).isEqualTo("2026-11-13");
        assertThat(b.get("canPay").asBoolean()).isTrue();
        assertThat(b.get("message").asText()).contains("sign-in stays open");
        assertThat(b.get("status").asText()).isEqualTo("PAST_DUE");
    }
}
