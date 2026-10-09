package com.unifiedtree.auth.phone;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Owner's decision Q-21 (9 Oct): the mobile app's SMS sign-in, checked before any SMS is sent. */
class PhoneSignInRuleTest {

    private static final String NUMBER = "+919876543210";

    private final PhoneLookupService lookup = mock(PhoneLookupService.class);
    private final MfaService mfa = mock(MfaService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PhoneSignInRule rule = new PhoneSignInRule(lookup, mfa, jdbc);
    private final PhoneLookupService.Match match =
            new PhoneLookupService.Match(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "ravi@acme.test");

    @AfterEach
    void unbind() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private void found(String... roles) {
        when(lookup.findTheOnlyLogin(NUMBER)).thenReturn(Optional.of(match));
        when(jdbc.queryForList(contains("rbac.user_roles"), eq(String.class), any(), any())).thenReturn(List.of(roles));
    }

    private static void refused(Runnable call, HttpStatus status, String code, String message) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(HrmsException.class, e -> {
            assertThat(e.getStatus()).isEqualTo(status);
            assertThat(e.getErrorCode()).isEqualTo(code);
            assertThat(e.getMessage()).isEqualTo(message);
        });
    }

    @Test
    void aNumberOnMoreThanOneActiveLoginIsRefused() {
        when(lookup.findTheOnlyLogin(NUMBER)).thenThrow(new PhoneLookupService.SeveralLogins());
        refused(() -> rule.forTheApp(NUMBER), HttpStatus.CONFLICT, "PHONE_ON_SEVERAL_LOGINS",
                "This number is on more than one login. Sign in with your email.");
    }

    @Test
    void aTwoFactorLoginUsesThePassword() {
        found("EMPLOYEE");
        when(mfa.requirementFor(eq(match.tenantId()), eq(match.authUserId()), any())).thenReturn(MfaService.Requirement.VERIFY);
        refused(() -> rule.forTheApp(NUMBER), HttpStatus.FORBIDDEN, "USE_PASSWORD_FOR_TWO_FACTOR",
                "Your login uses two-factor sign-in. Use your password.");
    }

    @Test
    void aLoginTheBusinessMakesSetUpTwoFactorUsesThePasswordToo() {
        found("ADMIN");
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.SETUP);
        assertThatThrownBy(() -> rule.forTheApp(NUMBER)).isInstanceOfSatisfying(HrmsException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo("USE_PASSWORD_FOR_TWO_FACTOR"));
    }

    @Test
    void anUnknownOrInactiveNumberIsAsBefore() {
        when(lookup.findTheOnlyLogin(NUMBER)).thenReturn(Optional.empty());
        assertThat(rule.forTheApp(NUMBER)).isEmpty();
        verify(mfa, never()).requirementFor(any(), any(), any());
    }

    @Test
    void theOneActiveLoginSignsIn() {
        found("EMPLOYEE");
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
        assertThat(rule.forTheApp(NUMBER)).contains(match);
    }

    @Test
    void theOwnerAndAdminsKeepSmsInTheAppButNotOnTheWeb() {
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
        for (String role : List.of("OWNER", "ADMIN", "SUPER_ADMIN")) {
            found("EMPLOYEE", role);
            assertThat(rule.forTheApp(NUMBER)).as(role).contains(match);
            assertThat(rule.refusal(match, true)).as(role).contains(PhoneSignInRule.Refusal.ADMIN);
        }
    }

    @Test
    void rolesAndTwoFactorAreReadInTheLoginsBusinessAndTheBindingIsPutBack() {
        UUID other = UUID.randomUUID();
        TenantContext.setTenantId(other);
        when(jdbc.queryForList(contains("rbac.user_roles"), eq(String.class), any(), any())).thenAnswer(inv -> {
            assertThat(TenantContext.getTenantId()).isEqualTo(match.tenantId());
            assertThat(com.hrms.core.tenant.TenantContext.getTenantId()).isEqualTo(match.tenantId());
            return List.of("EMPLOYEE");
        });
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
        assertThat(rule.refusal(match, false)).isEmpty();
        assertThat(TenantContext.getTenantId()).isEqualTo(other);
        assertThat(com.hrms.core.tenant.TenantContext.getTenantId()).isNull();
    }
}
