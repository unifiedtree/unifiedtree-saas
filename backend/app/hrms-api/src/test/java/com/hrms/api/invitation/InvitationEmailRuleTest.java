package com.hrms.api.invitation;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.service.EmailAlreadyUsedException;
import com.hrms.employee.service.EmployeeContactGuard;
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
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Invite / resend invite (POST /v1/employees/{id}/invite, Users &amp; access): the
 * login is made with the employee's work email, trimmed and lower-cased, and
 * never with an address another employee has — before, the find-or-create by
 * email handed the new person that other employee's login.
 */
class InvitationEmailRuleTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID actor = UUID.randomUUID();

    private final UserCredentialsRepository credRepo = mock(UserCredentialsRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final EmployeeContactGuard guard = mock(EmployeeContactGuard.class);
    private InvitationService service;

    @BeforeEach
    void setUp() {
        service = new InvitationService(credRepo, mock(UserRoleRepository.class), mock(RoleRepository.class),
                mock(InvitationTokenRepository.class), new PasswordService(), mock(AuthService.class),
                mock(InvitationEmailSender.class), jdbc, mock(ApplicationEventPublisher.class),
                mock(NotificationEmailComposer.class), guard, mock(com.unifiedtree.auth.session.SessionService.class));
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private void employeeHasEmail(String email) {
        Map<String, Object> row = new HashMap<>();
        row.put("email", email);
        row.put("first_name", "Ravi");
        row.put("company_id", UUID.randomUUID());
        when(jdbc.queryForList(anyString(), eq(employee), eq(tenant))).thenReturn(List.of(row));
    }

    @Test
    void theEmailIsCheckedNormalisedLeavingOutThisEmployee() {
        employeeHasEmail("  Ravi@X.com ");
        doThrow(new EmailAlreadyUsedException("This email already belongs to Aisha Khan (EMP-0003)."))
                .when(guard).assertEmailFree("ravi@x.com", employee);
        assertThatThrownBy(() -> service.sendInvitation(employee, tenant, actor))
                .isInstanceOf(EmailAlreadyUsedException.class)
                .hasMessage("This email already belongs to Aisha Khan (EMP-0003).");
        verify(credRepo, never()).save(any());
    }

    @Test
    void aLoginThatBelongsToAnotherEmployeeIsNeverReused() {
        employeeHasEmail("ravi@x.com");
        UserCredentials someoneElses = new UserCredentials();
        someoneElses.setEmployeeId(UUID.randomUUID());
        when(credRepo.findByEmailIgnoreCase("ravi@x.com")).thenReturn(Optional.of(someoneElses));
        assertThatThrownBy(() -> service.sendInvitation(employee, tenant, actor))
                .isInstanceOf(EmailAlreadyUsedException.class)
                .satisfies(e -> assertThat(((EmailAlreadyUsedException) e).getStatus().value()).isEqualTo(409));
        verify(credRepo, never()).save(any());
    }

    @Test
    void anEmployeeWithoutAWorkEmailCantBeInvited() {
        employeeHasEmail("  ");
        assertThatThrownBy(() -> service.sendInvitation(employee, tenant, actor))
                .isInstanceOf(BusinessRuleException.class)
                .satisfies(e -> assertThat(((BusinessRuleException) e).getErrorCode()).isEqualTo("EMAIL_REQUIRED"));
        verify(guard, never()).assertEmailFree(any(), any());
    }
}
