package com.unifiedtree.saas.oauth;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
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

/** "Continue with Google" on a business's own login page (contract §5a). */
class BusinessGoogleSignInTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuthService auth = mock(AuthService.class);
    private final MfaService mfa = mock(MfaService.class);
    private final BusinessGoogleSignIn signIn = new BusinessGoogleSignIn(jdbc, auth, mfa, "https://{sub}.unifiedtree.com");
    private final UUID acme = UUID.randomUUID();
    private final UUID ravi = UUID.randomUUID();

    private void acmeHasRavi() {
        when(jdbc.queryForList(contains("FROM platform.tenants"), eq(UUID.class), eq("acme"))).thenReturn(List.of(acme));
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(UUID.class), eq(acme), eq("ravi@acme.test")))
                .thenReturn(List.of(ravi));
        when(jdbc.queryForList(contains("FROM rbac.user_roles"), eq(String.class), eq(acme), eq(ravi))).thenReturn(List.of("EMPLOYEE"));
    }

    @Test
    void theReturnPathMarksABusinessAndOnlyAValidOne() {
        assertThat(BusinessGoogleSignIn.returnToFor("Acme")).isEqualTo("/__business/acme");
        assertThat(BusinessGoogleSignIn.businessOf("/__business/acme")).isEqualTo("acme");
        assertThat(BusinessGoogleSignIn.returnToFor("acme.evil.com/x")).isNull();
        assertThat(BusinessGoogleSignIn.businessOf("/workspaces")).isNull();
        assertThat(BusinessGoogleSignIn.businessOf("/__business/../x")).isNull();
        // The marker passes the existing return-path rule, so the state row keeps it.
        assertThat(GoogleOauthService.sanitizeReturnTo("/__business/acme")).isEqualTo("/__business/acme");
        assertThat(signIn.businessUrl("acme")).isEqualTo("https://acme.unifiedtree.com");
    }

    @Test
    void aLoginInThatBusinessGetsABusinessSession() {
        acmeHasRavi();
        when(mfa.requirementFor(eq(acme), eq(ravi), any())).thenReturn(MfaService.Requirement.NONE);
        LoginResponse session = mock(LoginResponse.class);
        when(auth.issueWorkspaceSession(acme, ravi)).thenReturn(session);

        BusinessGoogleSignIn.Result r = signIn.signIn("acme", "Ravi@Acme.test");

        assertThat(r.tenantId()).isEqualTo(acme);
        assertThat(r.session()).isSameAs(session);
    }

    @Test
    void anEmailWithNoLoginInThisBusinessIsRefused() {
        when(jdbc.queryForList(contains("FROM platform.tenants"), eq(UUID.class), eq("acme"))).thenReturn(List.of(acme));
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(UUID.class), eq(acme), anyString())).thenReturn(List.of());
        assertThatThrownBy(() -> signIn.signIn("acme", "someone@else.test"))
                .isInstanceOfSatisfying(BusinessGoogleSignIn.Refused.class, e -> assertThat(e.code()).isEqualTo("GOOGLE_NOT_REGISTERED"));
        verify(auth, never()).issueWorkspaceSession(any(), any());
    }

    @Test
    void googleNeverSkipsTheTwoFactorCode() {
        acmeHasRavi();
        when(mfa.requirementFor(eq(acme), eq(ravi), any())).thenReturn(MfaService.Requirement.VERIFY);
        assertThatThrownBy(() -> signIn.signIn("acme", "ravi@acme.test"))
                .isInstanceOfSatisfying(BusinessGoogleSignIn.Refused.class, e -> assertThat(e.code()).isEqualTo("USE_PASSWORD_FOR_TWO_FACTOR"));
        verify(auth, never()).issueWorkspaceSession(any(), any());
    }

    @Test
    void inactiveAndLockedLoginsAreRefusedLikePasswordSignIn() {
        acmeHasRavi();
        when(mfa.requirementFor(eq(acme), eq(ravi), any())).thenReturn(MfaService.Requirement.NONE);
        when(auth.issueWorkspaceSession(acme, ravi)).thenThrow(new BusinessRuleException("Account is temporarily locked", "ACCOUNT_LOCKED"));
        assertThatThrownBy(() -> signIn.signIn("acme", "ravi@acme.test"))
                .isInstanceOfSatisfying(BusinessGoogleSignIn.Refused.class, e -> assertThat(e.code()).isEqualTo("ACCOUNT_LOCKED"));
    }

    @Test
    void anUnknownOrInactiveBusinessIsRefused() {
        when(jdbc.queryForList(contains("FROM platform.tenants"), eq(UUID.class), eq("gone"))).thenReturn(List.of());
        assertThatThrownBy(() -> signIn.signIn("gone", "ravi@acme.test"))
                .isInstanceOfSatisfying(BusinessGoogleSignIn.Refused.class, e -> assertThat(e.code()).isEqualTo("BUSINESS_NOT_FOUND"));
    }
}
