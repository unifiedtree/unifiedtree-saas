package com.unifiedtree.saas.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.saas.controller.AccountController;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSessionRequest;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSessionResponse;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The business's own sign-in page using the website's sign-in by itself (11 Oct 2026):
 * POST /v1/accounts/workspaces/session with {@code silent: true} never skips the two-factor code,
 * and the website's Enter (no flag) is exactly as before.
 */
class SilentWorkspaceSessionTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuthService auth = mock(AuthService.class);
    private final MfaService mfa = mock(MfaService.class);
    private final AccountService accounts = new AccountService(jdbc, null, null, auth, null, mfa, "unifiedtree.com");
    private final UUID account = UUID.randomUUID();
    private final UUID acme = UUID.randomUUID();
    private final UUID ravi = UUID.randomUUID();
    private final Jwt accountToken = Jwt.withTokenValue("account-token").header("alg", "HS256")
            .subject(account.toString()).claim("token_type", "account").build();
    private final LoginResponse session = new LoginResponse("access", "refresh", Instant.now(), ravi, null, acme,
            "ravi@acme.test", "Ravi", "Kumar", List.of("EMPLOYEE"), List.of("hrms.ess.read"), null);

    /** Ravi's account is an ACTIVE member of the ACTIVE business Acme, as login `ravi`, an employee. */
    private void raviBelongsToAcme() throws Exception {
        ResultSet row = mock(ResultSet.class);
        when(row.next()).thenReturn(true);
        when(row.getString("id")).thenReturn(UUID.randomUUID().toString());
        when(row.getString("account_id")).thenReturn(account.toString());
        when(row.getString("tenant_id")).thenReturn(acme.toString());
        when(row.getString("auth_user_id")).thenReturn(ravi.toString());
        when(row.getString("role")).thenReturn("EMPLOYEE");
        when(row.getBoolean("default_workspace")).thenReturn(true);
        when(row.getString("display_name")).thenReturn("Acme");
        when(row.getString("subdomain")).thenReturn("acme");
        when(row.getString("status")).thenReturn("ACTIVE");
        when(jdbc.query(contains("FROM platform.account_workspaces"), any(ResultSetExtractor.class), eq(account), eq(acme)))
                .thenAnswer(inv -> inv.<ResultSetExtractor<?>>getArgument(1).extractData(row));
        when(jdbc.queryForList(contains("FROM rbac.user_roles"), eq(String.class), eq(acme), eq(ravi)))
                .thenReturn(List.of("EMPLOYEE"));
        when(auth.issueWorkspaceSession(acme, ravi)).thenReturn(session);
    }

    @Test
    void theWebsitesEnterIsAsBeforeWithNoTwoFactorCheck() throws Exception {
        raviBelongsToAcme();
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.VERIFY);

        assertThat(accounts.createWorkspaceSession(accountToken, acme).auth()).isSameAs(session);
        assertThat(accounts.createWorkspaceSession(accountToken, acme, false).auth()).isSameAs(session);
        verify(mfa, never()).requirementFor(any(), any(), any());
    }

    @Test
    void aSilentSignInForALoginWithoutTwoFactorGetsTheBusinessSession() throws Exception {
        raviBelongsToAcme();
        when(mfa.requirementFor(eq(acme), eq(ravi), any())).thenReturn(MfaService.Requirement.NONE);

        WorkspaceSessionResponse out = accounts.createWorkspaceSession(accountToken, acme, true);

        assertThat(out.auth()).isSameAs(session);
        assertThat(out.workspace().tenantId()).isEqualTo(acme);
        // The roles are the login's own, read in that business.
        verify(mfa).requirementFor(acme, ravi, List.of("EMPLOYEE"));
    }

    @Test
    void aSilentSignInNeverSkipsTheTwoFactorCode() throws Exception {
        raviBelongsToAcme();
        for (MfaService.Requirement needed : List.of(MfaService.Requirement.VERIFY, MfaService.Requirement.SETUP)) {
            when(mfa.requirementFor(eq(acme), eq(ravi), any())).thenReturn(needed);
            assertThatThrownBy(() -> accounts.createWorkspaceSession(accountToken, acme, true))
                    .as(needed.name())
                    .isInstanceOfSatisfying(HrmsException.class, e -> {
                        assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                        assertThat(e.getErrorCode()).isEqualTo("USE_PASSWORD_FOR_TWO_FACTOR");
                    });
        }
        verify(auth, never()).issueWorkspaceSession(any(), any());
    }

    @Test
    void aSilentSignInIntoABusinessTheAccountIsNotPartOfIsRefusedBeforeAnything() {
        // No membership row (not a member, or the business or the membership isn't ACTIVE).
        assertThatThrownBy(() -> accounts.createWorkspaceSession(accountToken, acme, true))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verify(mfa, never()).requirementFor(any(), any(), any());
        verify(auth, never()).issueWorkspaceSession(any(), any());
    }

    @Test
    void theRequestsSilentFlagIsOptional() throws Exception {
        ObjectMapper json = new ObjectMapper();
        assertThat(json.readValue("{\"tenantId\":\"" + acme + "\"}", WorkspaceSessionRequest.class).silent()).isNull();
        assertThat(json.readValue("{\"tenantId\":\"" + acme + "\",\"silent\":true}", WorkspaceSessionRequest.class).silent()).isTrue();
    }

    @Test
    void theEndpointPassesTheFlagOnAndAnAbsentFlagIsNotSilent() {
        AccountService service = mock(AccountService.class);
        when(service.createWorkspaceSession(any(), any(), anyBoolean())).thenReturn(new WorkspaceSessionResponse(session, null));
        AccountController controller = new AccountController(service, mock(PublicEndpointRateLimiter.class));
        HttpServletResponse res = mock(HttpServletResponse.class);

        controller.session(accountToken, new WorkspaceSessionRequest(acme, true), res);
        verify(service).createWorkspaceSession(accountToken, acme, true);

        controller.session(accountToken, new WorkspaceSessionRequest(acme, null), res);
        controller.session(accountToken, new WorkspaceSessionRequest(acme, false), res);
        verify(service, org.mockito.Mockito.times(2)).createWorkspaceSession(accountToken, acme, false);
    }
}
