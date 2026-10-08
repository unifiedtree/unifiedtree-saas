package com.hrms.api.saasguard;

import com.hrms.api.saasguard.SubscriptionAccessGuard.SubStatus;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.subscription.SubscriptionStateReconciler;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
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
    /** The guard's short-timeout client (RazorpayClient.withTimeouts). */
    private final RazorpayClient quick = mock(RazorpayClient.class);
    private final SubscriptionStateReconciler reconciler = mock(SubscriptionStateReconciler.class);
    private final RazorpayClient.SubscriptionView view = mock(RazorpayClient.SubscriptionView.class);
    private SubscriptionAccessGuard guard;

    /** Due 8 days ago: past the 7-day grace (1 day), inside the 48 h fail-open cap. */
    private final SubStatus unpaid = due(Duration.ofDays(8));
    private final SubStatus paid = new SubStatus("ACTIVE", null, "sub_1",
            List.of("hrms", "attendance", "leave", "payroll"), new BigDecimal("4000"), null);

    private static SubStatus due(Duration ago) {
        return new SubStatus("PAST_DUE", null, "sub_1",
                List.of("hrms", "attendance", "leave", "payroll"), new BigDecimal("4000"), Instant.now().minus(ago));
    }

    @BeforeEach
    void setUp() {
        when(jdbc.queryForObject(contains("information_schema"), eq(Boolean.class))).thenReturn(true);
        when(razorpay.withTimeouts(any(), any())).thenReturn(quick);
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

    private void razorpayAnswers(String status) {
        when(quick.fetchSubscription("sub_1")).thenReturn(view);
        when(reconciler.applyFetched("sub_1", view)).thenReturn(status);
    }

    @Test
    void theCheckUsesShortTimeouts() {
        verify(razorpay).withTimeouts(SubscriptionAccessGuard.CHECK_CONNECT_TIMEOUT, SubscriptionAccessGuard.CHECK_READ_TIMEOUT);
        assertThat(SubscriptionAccessGuard.CHECK_READ_TIMEOUT).isLessThanOrEqualTo(Duration.ofSeconds(3));
    }

    @Test
    void razorpaySaysPaidSoNothingIsPaused() throws Exception {
        ledgerSays(unpaid, paid);
        razorpayAnswers("active");

        assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isTrue();
        verify(reconciler).applyFetched("sub_1", view);
    }

    @Test
    void razorpaySaysUnpaidSoTheModulePauses() throws Exception {
        ledgerSays(unpaid, unpaid);
        razorpayAnswers("pending");
        MockHttpServletResponse res = new MockHttpServletResponse();

        assertThat(call("/v1/leave/types", res)).isFalse();
        assertThat(res.getStatus()).isEqualTo(402);
        assertThat(res.getContentAsString()).contains("\"code\":\"MODULE_PAUSED\"");
    }

    @Test
    void razorpayUnreachableMeansNoPauseAndNoHammering() throws Exception {
        ledgerSays(unpaid);
        when(quick.fetchSubscription(anyString())).thenThrow(new ResponseStatusException(HttpStatus.BAD_GATEWAY, "timeout"));

        assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isTrue();
        assertThat(call("/v1/payroll/settings", new MockHttpServletResponse())).isTrue();
        verify(quick, times(1)).fetchSubscription(anyString());
    }

    @Test
    void razorpaySayingNoPausesInsteadOfFailingOpen() throws Exception {
        // Razorpay doesn't know this subscription (400 / 404): it can't vouch for a payment, so the rule applies.
        for (int status : new int[] {400, 404}) {
            SubscriptionAccessGuard g = new SubscriptionAccessGuard(jdbc, razorpay, reconciler, "");
            ledgerSays(unpaid);
            doThrow(new RazorpayClient.Refused(status, "unknown subscription")).when(quick).fetchSubscription(anyString());
            MockHttpServletResponse res = new MockHttpServletResponse();

            assertThat(g.preHandle(new MockHttpServletRequest("GET", "/v1/leave/types"), res, null)).as("Razorpay %s", status).isFalse();
            assertThat(res.getStatus()).isEqualTo(402);
        }
    }

    @Test
    void ourKeysRefusedOrRateLimitedFailOpenUntilTheCap() throws Exception {
        // 401 (wrong / rotated keys) and 429 (rate limit) say nothing about this business's payment.
        for (int status : new int[] {401, 429}) {
            SubscriptionAccessGuard g = new SubscriptionAccessGuard(jdbc, razorpay, reconciler, "");
            ledgerSays(unpaid);
            doThrow(new RazorpayClient.Refused(status, "refused")).when(quick).fetchSubscription(anyString());
            assertThat(g.preHandle(new MockHttpServletRequest("GET", "/v1/leave/types"), new MockHttpServletResponse(), null))
                    .as("Razorpay %s inside the cap", status).isTrue();

            g = new SubscriptionAccessGuard(jdbc, razorpay, reconciler, "");
            ledgerSays(due(Duration.ofDays(10)));
            assertThat(g.preHandle(new MockHttpServletRequest("GET", "/v1/leave/types"), new MockHttpServletResponse(), null))
                    .as("Razorpay %s past the cap", status).isFalse();
        }
    }

    @Test
    void missingKeysPauseToo() throws Exception {
        ledgerSays(unpaid);
        when(quick.fetchSubscription(anyString()))
                .thenThrow(new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured"));
        assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isFalse();
    }

    @Test
    void failingOpenStopsTwoDaysPastThePausePoint() throws Exception {
        // Due 10 days ago: grace ended 3 days ago, past the 48 h cap. Razorpay down: paused anyway.
        ledgerSays(due(Duration.ofDays(10)));
        when(quick.fetchSubscription(anyString())).thenThrow(new ResponseStatusException(HttpStatus.BAD_GATEWAY, "timeout"));
        assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isFalse();
    }

    @Test
    void aPageLoadOfManyCallsAsksRazorpayOnce() throws Exception {
        ledgerSays(unpaid);
        CountDownLatch asked = new CountDownLatch(1), release = new CountDownLatch(1);
        when(quick.fetchSubscription(anyString())).thenAnswer(i -> {
            asked.countDown();
            release.await(5, TimeUnit.SECONDS);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "timeout");
        });
        ExecutorService pool = Executors.newFixedThreadPool(5);
        try {
            Future<Boolean> first = pool.submit(() -> {
                SecurityContextHolder.getContext().setAuthentication(
                        new JwtAuthenticationToken(Jwt.withTokenValue("t").header("alg", "none").claim("tenant_id", tenant.toString()).build()));
                return call("/v1/leave/types", new MockHttpServletResponse());
            });
            assertThat(asked.await(5, TimeUnit.SECONDS)).isTrue();
            // While the first is waiting for Razorpay, the rest go straight through without asking.
            for (int n = 0; n < 4; n++) assertThat(call("/v1/leave/types", new MockHttpServletResponse())).isTrue();
            release.countDown();
            assertThat(first.get(5, TimeUnit.SECONDS)).isTrue();
        } finally {
            pool.shutdownNow();
        }
        verify(quick, times(1)).fetchSubscription(anyString());
    }

    @Test
    void theReconcilerWritesWithTheTenantUnboundSoTheyCommit() throws Exception {
        // A tenant-bound connection is not auto-committing (TenantAwareDataSource): the paid -> ACTIVE
        // update would be lost. The guard saves with the tenant unbound and binds it again after.
        ledgerSays(unpaid, paid);
        when(quick.fetchSubscription("sub_1")).thenReturn(view);
        UUID[] seen = new UUID[1];
        when(reconciler.applyFetched("sub_1", view)).thenAnswer(i -> {
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
        verify(quick, never()).fetchSubscription(anyString());
    }
}
