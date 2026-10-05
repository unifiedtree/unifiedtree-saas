package com.hrms.app;

import com.hrms.api.access.WorkspaceAccessService;
import com.hrms.api.invitation.InvitationService;
import com.hrms.employee.service.EmailAlreadyUsedException;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.service.EmployeeContactGuard.Field;
import com.hrms.employee.service.EmployeeContactGuard.Owner;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Users &amp; access → Invite (2026-10-05 email rule): the address is saved trimmed
 * and lower-cased, and a sign-in-only invite may not take an employee's work or
 * personal email (that person is invited from their profile and keeps one login).
 */
class WorkspaceAccessInviteEmailTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID ACTOR = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    private UserCredentialsRepository credRepo;
    private InvitationService invitations;
    private WorkforceEmployeeService workforce;
    private EmployeeContactGuard guard;
    private WorkspaceAccessService service;

    @BeforeEach
    void setUp() {
        credRepo = mock(UserCredentialsRepository.class);
        invitations = mock(InvitationService.class);
        workforce = mock(WorkforceEmployeeService.class);
        guard = mock(EmployeeContactGuard.class);
        service = new WorkspaceAccessService(credRepo, mock(UserRoleRepository.class), mock(RoleRepository.class),
                invitations, workforce, mock(JdbcTemplate.class), mock(com.hrms.api.access.AccessGuard.class),
                mock(com.hrms.api.access.AccessAudit.class), guard);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("u", null,
                List.of(new SimpleGrantedAuthority("hrms.employee.read"))));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void aNewPersonIsCreatedWithTheAddressTrimmedAndLowerCased() {
        WorkforceEmployeeResponse emp = mock(WorkforceEmployeeResponse.class);
        UUID empId = UUID.randomUUID();
        when(emp.id()).thenReturn(empId);
        when(workforce.create(any(CreateWorkforceEmployeeRequest.class))).thenReturn(emp);
        UserCredentials login = new UserCredentials();
        when(credRepo.findByEmailIgnoreCase("ravi@x.com")).thenReturn(Optional.of(login));

        service.inviteUser(TENANT, ACTOR, new WorkspaceAccessService.InviteRequest(" Ravi@X.com ", "Ravi", "K", List.of(), true, COMPANY));

        ArgumentCaptor<CreateWorkforceEmployeeRequest> req = ArgumentCaptor.forClass(CreateWorkforceEmployeeRequest.class);
        verify(workforce).create(req.capture());
        assertThat(req.getValue().email()).isEqualTo("ravi@x.com");
        verify(invitations).sendInvitation(empId, TENANT, ACTOR);
    }

    @Test
    void aSignInOnlyInviteCantTakeAnEmployeesEmail() {
        when(credRepo.findByEmailIgnoreCase("aisha@x.com")).thenReturn(Optional.empty());
        when(guard.emailOwner(eq(TENANT), eq("aisha@x.com"), any()))
                .thenReturn(Optional.of(new Owner(UUID.randomUUID(), "Aisha Khan", "EMP-0003", false, Field.PERSONAL)));
        assertThatThrownBy(() -> service.inviteUser(TENANT, ACTOR,
                new WorkspaceAccessService.InviteRequest("Aisha@X.com", null, null, List.of(), false, null)))
                .isInstanceOf(EmailAlreadyUsedException.class)
                .hasMessage("This email is already the personal email of Aisha Khan (EMP-0003).");
        verify(credRepo, never()).save(any());
    }

    @Test
    void aSignInOnlyInviteToAFreeAddressStillWorks() {
        when(credRepo.findByEmailIgnoreCase("new@x.com")).thenReturn(Optional.empty());
        when(guard.emailOwner(any(), any(), any())).thenReturn(Optional.empty());
        UserCredentials saved = new UserCredentials();
        saved.setId(UUID.randomUUID());
        when(credRepo.save(any(UserCredentials.class))).thenReturn(saved);

        service.inviteUser(TENANT, ACTOR, new WorkspaceAccessService.InviteRequest("New@x.com", null, null, List.of(), false, null));

        ArgumentCaptor<UserCredentials> c = ArgumentCaptor.forClass(UserCredentials.class);
        verify(credRepo).save(c.capture());
        assertThat(c.getValue().getEmail()).isEqualTo("new@x.com");
        verify(invitations).sendInviteToCredential(saved.getId(), TENANT, ACTOR);
    }
}
