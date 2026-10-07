package com.unifiedtree.saas.signup;

import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.payment.subscription.SubscriptionService;
import com.unifiedtree.saas.plans.ModulePlanService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The paid sign-up refuses a reserved address before Razorpay, not after the mandate. */
class SubscriptionSignupReservedTest {

    @Test
    void aReservedAddressIsRefusedBeforeAnyPaymentStep() {
        SubscriptionService subscriptions = mock(SubscriptionService.class);
        PendingSignupService pending = mock(PendingSignupService.class);
        ModulePlanService plans = mock(ModulePlanService.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        RazorpayProperties props = mock(RazorpayProperties.class);
        when(props.isConfigured()).thenReturn(true);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), anyString())).thenReturn(false);
        SubscriptionSignupController controller = new SubscriptionSignupController(subscriptions, pending,
                null, plans, jdbc, props, mock(PublicEndpointRateLimiter.class));

        var req = new SubscriptionSignupController.SubscriptionSignupRequest("PAID", "Admin Co", "Admin",
                "Asha Rao", "asha@acme.test", null, "password1", "India", "Asia/Kolkata", "INR", null,
                List.of("hrms"), 1, "monthly", null, null, null, null, null, null, null);

        assertThatThrownBy(() -> controller.signup(req, null, new MockHttpServletRequest()))
                .isInstanceOfSatisfying(ResponseStatusException.class, e -> {
                    assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getReason()).contains("reserved");
                });
        verifyNoInteractions(subscriptions, pending, plans);
    }
}
