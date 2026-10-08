package com.hrms.api.invitation;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.notifications.template.NotificationEmailComposer;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 2026-10-05 (demo-hrms tester): "Reset Password" said the password was
 * updated, then the workspace refused the new password. A signed-out request
 * carries no tenant, so the reset was routed by the email alone, to the
 * workspace it last signed in to; an address in two workspaces got a link that
 * reset the OTHER one. These pin: the page's own workspace wins, the reset
 * writes exactly the token's own row (id AND workspace), and a reset that
 * changes no row fails instead of reporting success.
 */
class PasswordResetTest {

    private static final String EMAIL = "tester@example.test";

    private final UUID pageWorkspace = UUID.randomUUID();
    private final UUID otherWorkspace = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID tokenId = UUID.randomUUID();

    private final UserCredentialsRepository credRepo = mock(UserCredentialsRepository.class);
    private final InvitationTokenRepository tokenRepo = mock(InvitationTokenRepository.class);
    private final AuthService auth = mock(AuthService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final NotificationEmailComposer composer = mock(NotificationEmailComposer.class);
    private final PasswordService passwords = new PasswordService();
    private InvitationService service;

    @BeforeEach
    void setUp() {
        service = new InvitationService(credRepo, mock(UserRoleRepository.class), mock(RoleRepository.class),
                tokenRepo, passwords, auth, mock(InvitationEmailSender.class), jdbc,
                mock(ApplicationEventPublisher.class), composer, mock(com.hrms.employee.service.EmployeeContactGuard.class));
        ReflectionTestUtils.setField(service, "platformBaseUrl", "https://unifiedtree.com");
        when(composer.compose(any(), any(), anyString(), anyMap(), anyString(), anyString()))
                .thenReturn(new NotificationEmailComposer.ComposedEmail("Reset", "<p>reset</p>", false));
        // The address signs in to two workspaces; the OTHER one was used last.
        when(auth.resolveLoginTenant(EMAIL)).thenReturn(otherWorkspace);
        when(jdbc.queryForList(startsWith("SELECT id FROM platform.tenants"), eq(UUID.class), eq("demo-hrms")))
                .thenReturn(List.of(pageWorkspace));
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private void addressHasSignInOnThePage(int rows) {
        when(jdbc.queryForObject(contains("FROM auth.user_credentials WHERE tenant_id = ?"), eq(Integer.class),
                eq(pageWorkspace), eq(EMAIL))).thenReturn(rows);
    }

    private void credentialIn(UUID workspace) {
        UserCredentials c = new UserCredentials();
        c.setId(userId);
        c.setTenantId(workspace);
        c.setEmail(EMAIL);
        when(credRepo.findByEmailIgnoreCase(EMAIL)).thenReturn(java.util.Optional.of(c));
    }

    private UUID issuedTokenWorkspace() {
        ArgumentCaptor<InvitationToken> saved = ArgumentCaptor.forClass(InvitationToken.class);
        verify(tokenRepo).save(saved.capture());
        assertEquals("PASSWORD_RESET", saved.getValue().getPurpose());
        return saved.getValue().getTenantId();
    }

    @Test
    void resetAskedOnAWorkspacePageIsForThatWorkspace() {
        addressHasSignInOnThePage(1);
        credentialIn(pageWorkspace);

        service.requestPasswordReset(EMAIL, null, "demo-hrms");

        verify(auth, never()).resolveLoginTenant(any());
        assertEquals(pageWorkspace, issuedTokenWorkspace());
    }

    @Test
    void addressWithNoSignInOnThatPageStillRoutesByEmail() {
        addressHasSignInOnThePage(0);
        credentialIn(otherWorkspace);

        service.requestPasswordReset(EMAIL, null, "demo-hrms");

        verify(auth).resolveLoginTenant(EMAIL);
        assertEquals(otherWorkspace, issuedTokenWorkspace());
    }

    @Test
    void noPageWorkspaceKeepsTheOldEmailRouting() {
        credentialIn(otherWorkspace);

        service.requestPasswordReset(EMAIL, null);

        verify(auth).resolveLoginTenant(EMAIL);
        assertEquals(otherWorkspace, issuedTokenWorkspace());
    }

    // ---- platform operators (F1, 9 Oct 2026) ---------------------------------

    private static final UUID PLATFORM = TenantContext.PLATFORM_TENANT_ID;

    @Test
    void aPlatformOperatorAddressGetsNoLinkWhenThePlatformTenantIsNamed() {
        when(auth.resolveLoginTenant(EMAIL)).thenReturn(null);   // routing never names the platform tenant

        service.requestPasswordReset(EMAIL, PLATFORM, null);

        verify(auth).resolveLoginTenant(EMAIL);
        verify(credRepo, never()).findByEmailIgnoreCase(any());
        verify(tokenRepo, never()).save(any());
    }

    @Test
    void aPlatformOperatorAddressGetsNoLinkFromThePlatformAddress() {
        when(auth.resolveLoginTenant(EMAIL)).thenReturn(null);
        when(jdbc.queryForList(startsWith("SELECT id FROM platform.tenants"), eq(UUID.class), eq("unifiedtree")))
                .thenReturn(List.of(PLATFORM));
        when(jdbc.queryForObject(contains("FROM auth.user_credentials WHERE tenant_id = ?"), eq(Integer.class),
                eq(PLATFORM), eq(EMAIL))).thenReturn(1);

        service.requestPasswordReset(EMAIL, null, "unifiedtree");

        verify(credRepo, never()).findByEmailIgnoreCase(any());
        verify(tokenRepo, never()).save(any());
    }

    @Test
    void anOperatorAddressThatIsAlsoABusinessLoginStillGetsThatBusinesssLink() {
        credentialIn(otherWorkspace);

        service.requestPasswordReset(EMAIL, PLATFORM, null);

        assertEquals(otherWorkspace, issuedTokenWorkspace());
    }

    @Test
    void controllerPassesThePagesWorkspaceThrough() {
        InvitationService svc = mock(InvitationService.class);
        new InvitationController(svc).forgotPassword(
                new InvitationController.ForgotPasswordRequest(EMAIL, null), "demo-hrms");
        verify(svc).requestPasswordReset(EMAIL, null, "demo-hrms");
    }

    // ---- consuming the link ---------------------------------------------------

    private String tokenFor(UUID workspace) throws Exception {
        String raw = "raw-reset-token";
        String hash = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        when(jdbc.queryForList("SELECT * FROM auth.invitation_resolve(?)", hash)).thenReturn(List.of(Map.<String, Object>of(
                "id", tokenId, "tenant_id", workspace, "user_id", userId, "purpose", "PASSWORD_RESET",
                "expires_at", OffsetDateTime.now().plusHours(1))));
        return raw;
    }

    @Test
    void resetWritesTheTokensOwnRowInItsWorkspaceAndUsesTheToken() throws Exception {
        String raw = tokenFor(pageWorkspace);
        when(jdbc.queryForList(contains("UPDATE auth.user_credentials"), eq(String.class), any(), any(), any()))
                .thenReturn(List.of(EMAIL));

        service.resetPassword(raw, "NewPass@2026");

        ArgumentCaptor<Object> args = ArgumentCaptor.forClass(Object.class);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForList(sql.capture(), eq(String.class), args.capture(), args.capture(), args.capture());
        assertTrue(sql.getValue().contains("WHERE id = ? AND tenant_id = ?"));
        assertTrue(sql.getValue().contains("password_updated_at = now()"));
        assertTrue(passwords.matches("NewPass@2026", (String) args.getAllValues().get(0)), "the new password is what is stored");
        assertEquals(userId, args.getAllValues().get(1));
        assertEquals(pageWorkspace, args.getAllValues().get(2));
        verify(jdbc).update("UPDATE auth.invitation_tokens SET used_at = now() WHERE id = ?", tokenId);
        verify(credRepo, never()).save(any());
    }

    @Test
    void resetThatChangesNoRowFailsAndLeavesTheLinkUsable() throws Exception {
        String raw = tokenFor(pageWorkspace);
        when(jdbc.queryForList(contains("UPDATE auth.user_credentials"), eq(String.class), any(), any(), any()))
                .thenReturn(List.of());

        BusinessRuleException ex = assertThrows(BusinessRuleException.class,
                () -> service.resetPassword(raw, "NewPass@2026"));

        assertEquals("RESET_NOT_APPLIED", ex.getErrorCode());
        verify(jdbc, never()).update(eq("UPDATE auth.invitation_tokens SET used_at = now() WHERE id = ?"), any(Object[].class));
    }

    @Test
    void tooShortPasswordIsRefusedBeforeAnyWrite() throws Exception {
        String raw = tokenFor(pageWorkspace);
        assertThrows(BusinessRuleException.class, () -> service.resetPassword(raw, "Abc12"));
        verify(jdbc, never()).queryForList(contains("UPDATE auth.user_credentials"), eq(String.class), any(), any(), any());
    }
}
