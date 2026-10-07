package com.hrms.app;

import com.hrms.api.access.WorkspaceAccessService;
import com.hrms.api.invitation.InvitationService;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Users &amp; access → Invite, one business per person (owner decision, 6 Oct 2026): an email
 * that already signs in to another business gets no login here, with or without an employee,
 * and nothing is made first. Re-send goes through InvitationService (OneBusinessPerPersonInviteTest).
 */
class WorkspaceAccessOneBusinessTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID ACTOR = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final HrmsException REFUSAL = new HrmsException(
            InvitationService.IN_ANOTHER_BUSINESS_MESSAGE, HttpStatus.CONFLICT, "EMAIL_IN_ANOTHER_BUSINESS");

    private UserCredentialsRepository credRepo;
    private InvitationService invitations;
    private WorkforceEmployeeService workforce;
    private WorkspaceAccessService service;

    @BeforeEach
    void setUp() {
        credRepo = mock(UserCredentialsRepository.class);
        invitations = mock(InvitationService.class);
        workforce = mock(WorkforceEmployeeService.class);
        service = new WorkspaceAccessService(credRepo, mock(UserRoleRepository.class), mock(RoleRepository.class),
                invitations, workforce, mock(JdbcTemplate.class), mock(com.hrms.api.access.AccessGuard.class),
                mock(com.hrms.api.access.AccessAudit.class), mock(EmployeeContactGuard.class));
        when(credRepo.findByEmailIgnoreCase(any())).thenReturn(Optional.empty());
        doThrow(REFUSAL).when(invitations).assertNotInAnotherBusiness("asha@acme.test", TENANT);
    }

    @Test
    void aSignInOnlyInviteIsRefusedAndNoLoginIsMade() {
        assertThatThrownBy(() -> service.inviteUser(TENANT, ACTOR,
                new WorkspaceAccessService.InviteRequest(" Asha@Acme.test ", null, null, List.of(), false, null)))
                .isSameAs(REFUSAL);
        verify(credRepo, never()).save(any());
        verify(invitations, never()).sendInviteToCredential(any(), any(), any());
    }

    @Test
    void anInviteWithAnEmployeeIsRefusedBeforeTheEmployeeIsMade() {
        assertThatThrownBy(() -> service.inviteUser(TENANT, ACTOR,
                new WorkspaceAccessService.InviteRequest("asha@acme.test", "Asha", "R", List.of(), true, COMPANY)))
                .isSameAs(REFUSAL);
        verifyNoInteractions(workforce);
        verify(invitations, never()).sendInvitation(any(), any(), any());
    }

    @Test
    void anEmailOnlyInThisBusinessIsStillInvited() {
        UserCredentials saved = new UserCredentials();
        saved.setId(UUID.randomUUID());
        when(credRepo.save(any(UserCredentials.class))).thenReturn(saved);

        service.inviteUser(TENANT, ACTOR, new WorkspaceAccessService.InviteRequest("ravi@acme.test", null, null, List.of(), false, null));

        verify(invitations).assertNotInAnotherBusiness("ravi@acme.test", TENANT);
        verify(invitations).sendInviteToCredential(saved.getId(), TENANT, ACTOR);
    }

    @Test
    void someoneAlreadySignedInHereIsNotChecked() {
        UserCredentials active = new UserCredentials();
        active.setId(UUID.randomUUID());
        active.setActive(true);
        when(credRepo.findByEmailIgnoreCase("asha@acme.test")).thenReturn(Optional.of(active));

        service.inviteUser(TENANT, ACTOR, new WorkspaceAccessService.InviteRequest("asha@acme.test", null, null, List.of(), false, null));

        verify(invitations, never()).assertNotInAnotherBusiness(any(), any());
    }
}
