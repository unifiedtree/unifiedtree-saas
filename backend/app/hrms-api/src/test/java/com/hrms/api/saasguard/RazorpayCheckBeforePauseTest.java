package com.hrms.api.saasguard;

import com.hrms.api.saasguard.SubscriptionAccessGuard.SubStatus;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.subscription.SubscriptionStateReconciler;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Owner, 7 Oct 2026: before pausing for non-payment (PAST_DUE or HALTED), ask Razorpay whether it's paid. */
class RazorpayCheckBeforePauseTest {

    private final UUID tenant = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final RazorpayClient razorpay = mock(RazorpayClient.class);
    private final SubscriptionStateReconciler reconciler = mock(SubscriptionStateReconciler.class);
    private SubscriptionAccessGuard guard;

    private final SubStatus unpaid = new SubStatus("PAST_DUE", null, "sub_1",
            List.of("hrms", "attendance", "leave", "payroll"), new BigDecimal("4000"), Instant.now().minus(Duration.ofDays(9)));
    private final SubStatus paid = new SubStatus("ACTIVE", null, "sub_1",
            List.of("hrms", "attendance", "leave", "payroll"), new BigDecimal("4000"), null);

    @BeforeEach
    void setUp() {
        when(jdbc.queryForObject(contains("information_schema"), eq(Boolean.class))).thenReturn(true);
        guard = new SubscriptionAccessGuard(jdbc, razorpay, reconciler, "");
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").claim("tenant_id", tenant.toString()).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @SuppressWarnings("unchecked")
    private void ledgerSays(SubStatus first, SubStatus... then) {
        when(jdbc.queryForObject(contains("FROM platform.subscriptions"), any(RowMapper.class), eq(tenant)))
                .thenReturn(first, (Object[]) then);
    }

    private boolean call(String path, MockHttpServletResponse res) throws Exception {
        return guard.preHandle(new MockHttpServletRequest("GET", path), res, null);
    }

    @Test
    void razorpaySaysPaidSoNothingIsPaused() throws Exception {
        ledgerSays(unpaid, paid);
        when(reconciler.reconcileFromRazorpay("sub_1", razorpay)).thenReturn("active");

        assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isTrue();
        verify(reconciler).reconcileFromRazorpay("sub_1", razorpay);
    }

    @Test
    void razorpaySaysUnpaidSoTheModulePauses() throws Exception {
        ledgerSays(unpaid, unpaid);
        when(reconciler.reconcileFromRazorpay("sub_1", razorpay)).thenReturn("pending");
        MockHttpServletResponse res = new MockHttpServletResponse();

        assertThat(call("/v1/leave/types", res)).isFalse();
        assertThat(res.getStatus()).isEqualTo(402);
        assertThat(res.getContentAsString()).contains("\"code\":\"MODULE_PAUSED\"");
    }

    @Test
    void razorpayUnreachableMeansNoPauseAndNoHammering() throws Exception {
        ledgerSays(unpaid);
        when(reconciler.reconcileFromRazorpay(anyString(), any())).thenReturn(null);

        assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isTrue();
        assertThat(call("/v1/payroll/settings", new MockHttpServletResponse())).isTrue();
        verify(reconciler, times(1)).reconcileFromRazorpay(anyString(), any());
    }

    @Test
    void theReconcilerWritesWithTheTenantUnboundSoTheyCommit() throws Exception {
        // A tenant-bound connection is not auto-committing (TenantAwareDataSource): the paid -> ACTIVE
        // update would be lost. The guard asks with the tenant unbound and binds it again after.
        ledgerSays(unpaid, paid);
        UUID[] seen = new UUID[1];
        when(reconciler.reconcileFromRazorpay("sub_1", razorpay)).thenAnswer(i -> {
            seen[0] = TenantContext.getTenantId();
            return "active";
        });
        TenantContext.setTenantId(tenant);
        try {
            assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isTrue();
            assertThat(seen[0]).isNull();
            assertThat(TenantContext.getTenantId()).isEqualTo(tenant);
        } finally {
            TenantContext.clear();
        }
    }

    @Test
    void pagesThatArentPausedNeverAskRazorpay() throws Exception {
        ledgerSays(unpaid);
        assertThat(call("/v1/me/companies", new MockHttpServletResponse())).isTrue();
        assertThat(call("/v1/notifications", new MockHttpServletResponse())).isTrue();
        verify(reconciler, never()).reconcileFromRazorpay(anyString(), any());
    }
}
