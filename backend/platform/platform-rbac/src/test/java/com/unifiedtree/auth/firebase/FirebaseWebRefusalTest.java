package com.unifiedtree.auth.firebase;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.phone.PhoneLookupService;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Review 7 Oct: on a business's web sign-in an SMS code alone never signs in an admin or a 2FA login. */
class FirebaseWebRefusalTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final MfaService mfa = mock(MfaService.class);
    private final FirebaseAuthController controller = new FirebaseAuthController(mock(AuthService.class),
            mock(PhoneLookupService.class), mock(PublicEndpointRateLimiter.class), mfa, jdbc);
    private final PhoneLookupService.Match match =
            new PhoneLookupService.Match(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "x@acme.test");

    private void roles(String... codes) {
        when(jdbc.queryForList(contains("rbac.user_roles"), eq(String.class), any(), any())).thenReturn(List.of(codes));
    }

    @Test
    void theOwnerAndAdminsUseTheirEmail() {
        for (String role : List.of("OWNER", "SUPER_ADMIN", "ADMIN")) {
            roles("EMPLOYEE", role);
            assertThatThrownBy(() -> controller.refuseOnTheWeb(match))
                    .isInstanceOfSatisfying(HrmsException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("USE_EMAIL_FOR_ADMIN"));
        }
    }

    @Test
    void aTwoFactorLoginUsesThePassword() {
        roles("EMPLOYEE");
        when(mfa.requirementFor(eq(match.tenantId()), eq(match.authUserId()), any())).thenReturn(MfaService.Requirement.VERIFY);
        assertThatThrownBy(() -> controller.refuseOnTheWeb(match))
                .isInstanceOfSatisfying(HrmsException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("USE_PASSWORD_FOR_TWO_FACTOR"));
    }

    @Test
    void anEmployeeSignsIn() {
        roles("EMPLOYEE");
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
        assertThatCode(() -> controller.refuseOnTheWeb(match)).doesNotThrowAnyException();
    }
}
