package com.hrms.app;

import com.hrms.api.access.WorkspaceAccessService;
import com.hrms.api.invitation.InvitationService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for the workspace re-invitation routing — no Spring context, no DB.
 * Covers the three branches of {@link WorkspaceAccessService#resendInvite}:
 *  1. credential linked to an employee  -> employee resend flow
 *  2. credential-only (no employee)     -> credential resend flow
 *  3. already-activated user            -> rejected with ALREADY_ACTIVE
 */
class WorkspaceAccessResendTest {

    private UserCredentialsRepository credRepo;
    private InvitationService invitationService;
    private WorkspaceAccessService service;

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID USER   = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID ACTOR  = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID EMP    = UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");

    @BeforeEach
    void setup() {
        credRepo = mock(UserCredentialsRepository.class);
        invitationService = mock(InvitationService.class);
        service = new WorkspaceAccessService(
            credRepo,
            mock(UserRoleRepository.class),
            mock(RoleRepository.class),
            invitationService,
            mock(WorkforceEmployeeService.class),
            mock(JdbcTemplate.class));
    }

    private UserCredentials creds(boolean active, UUID employeeId) {
        UserCredentials c = new UserCredentials();
        c.setActive(active);
        c.setEmployeeId(employeeId);
        return c;
    }

    @Test
    void routesToEmployeeFlow_whenEmployeeLinked() {
        var expected = new InvitationService.InvitationResult(true, OffsetDateTime.now().plusHours(72));
        when(credRepo.findById(USER)).thenReturn(Optional.of(creds(false, EMP)));
        when(invitationService.resendInvitation(EMP, TENANT, ACTOR)).thenReturn(expected);

        var result = service.resendInvite(TENANT, USER, ACTOR);

        assertThat(result).isSameAs(expected);
        verify(invitationService).resendInvitation(EMP, TENANT, ACTOR);
        verify(invitationService, never()).sendInviteToCredential(any(), any(), any());
    }

    @Test
    void routesToCredentialFlow_whenNoEmployee() {
        var expected = new InvitationService.InvitationResult(true, OffsetDateTime.now().plusHours(72));
        when(credRepo.findById(USER)).thenReturn(Optional.of(creds(false, null)));
        when(invitationService.sendInviteToCredential(USER, TENANT, ACTOR)).thenReturn(expected);

        var result = service.resendInvite(TENANT, USER, ACTOR);

        assertThat(result).isSameAs(expected);
        verify(invitationService).sendInviteToCredential(USER, TENANT, ACTOR);
        verify(invitationService, never()).resendInvitation(any(), any(), any());
    }

    @Test
    void rejectsAlreadyActiveUser() {
        when(credRepo.findById(USER)).thenReturn(Optional.of(creds(true, EMP)));

        assertThatThrownBy(() -> service.resendInvite(TENANT, USER, ACTOR))
            .isInstanceOf(BusinessRuleException.class)
            .hasMessageContaining("already activated");

        verify(invitationService, never()).resendInvitation(any(), any(), any());
        verify(invitationService, never()).sendInviteToCredential(any(), any(), any());
    }
}
