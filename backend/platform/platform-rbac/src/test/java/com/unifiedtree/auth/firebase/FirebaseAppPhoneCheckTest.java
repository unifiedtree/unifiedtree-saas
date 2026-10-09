package com.unifiedtree.auth.firebase;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.phone.PhoneLookupService;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Owner's decision Q-21: the app's pre-SMS check (/phone/check, no business named) refuses what the code couldn't sign in. */
class FirebaseAppPhoneCheckTest {

    private final PhoneLookupService lookup = mock(PhoneLookupService.class);
    private final MfaService mfa = mock(MfaService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final FirebaseAuthController controller = new FirebaseAuthController(mock(AuthService.class),
            lookup, mock(PublicEndpointRateLimiter.class), mfa, jdbc);
    private final PhoneLookupService.Match match =
            new PhoneLookupService.Match(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "x@acme.test");
    private final HttpServletRequest app = mock(HttpServletRequest.class);

    @AfterEach
    void unbind() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private Object check(HttpServletRequest http) {
        return controller.phoneCheck(new FirebaseAuthController.PhoneCheckRequest("9876543210"), http).getBody();
    }

    private void roles(String... codes) {
        when(jdbc.queryForList(contains("rbac.user_roles"), eq(String.class), any(), any())).thenReturn(List.of(codes));
    }

    @Test
    void aNumberOnSeveralLoginsIsRefusedBeforeAnySms() {
        when(lookup.findTheOnlyLogin("9876543210")).thenThrow(new PhoneLookupService.SeveralLogins());
        assertThatThrownBy(() -> check(app)).isInstanceOfSatisfying(HrmsException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo("PHONE_ON_SEVERAL_LOGINS"));
    }

    @Test
    void aTwoFactorLoginIsRefusedBeforeAnySms() {
        when(lookup.findTheOnlyLogin("9876543210")).thenReturn(Optional.of(match));
        roles("EMPLOYEE");
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.VERIFY);
        assertThatThrownBy(() -> check(app)).isInstanceOfSatisfying(HrmsException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo("USE_PASSWORD_FOR_TWO_FACTOR"));
    }

    @Test
    void anUnknownOrInactiveNumberIsNotRegisteredAsBefore() {
        when(lookup.findTheOnlyLogin("9876543210")).thenReturn(Optional.empty());
        assertThat(check(app)).isEqualTo(Map.of("registered", false));
    }

    @Test
    void theOwnersOnlyLoginIsRegisteredInTheApp() {
        when(lookup.findTheOnlyLogin("9876543210")).thenReturn(Optional.of(match));
        roles("OWNER");
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
        assertThat(check(app)).isEqualTo(Map.of("registered", true));
    }

    @Test
    void theWebKeepsItsOwnAnswer() {
        // A business named (the web): unchanged, several logins answer 200 registered:false + reason.
        HttpServletRequest web = mock(HttpServletRequest.class);
        when(web.getHeader("X-Tenant-Subdomain")).thenReturn("acme");
        UUID acme = UUID.randomUUID();
        when(lookup.businessBySubdomain("acme")).thenReturn(acme);
        when(lookup.findByPhone("9876543210", acme)).thenThrow(new PhoneLookupService.SeveralLogins());
        assertThat(check(web)).isEqualTo(Map.of("registered", false, "reason", "PHONE_ON_SEVERAL_LOGINS"));
        verify(lookup, never()).findTheOnlyLogin(anyString());
    }
}
