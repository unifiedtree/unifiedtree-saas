package com.hrms.api.invitation;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.service.EmployeeContactGuard;
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

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** One business per person (owner decision, 6 Oct 2026): no new login for an email that is in another business. */
class OneBusinessPerPersonInviteTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UserCredentialsRepository credRepo = mock(UserCredentialsRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private InvitationService service;

    @BeforeEach
    void setUp() {
        service = new InvitationService(credRepo, mock(UserRoleRepository.class), mock(RoleRepository.class),
                mock(InvitationTokenRepository.class), new PasswordService(), mock(AuthService.class),
                mock(InvitationEmailSender.class), jdbc, mock(ApplicationEventPublisher.class),
                mock(NotificationEmailComposer.class), mock(EmployeeContactGuard.class));
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    @Test
    void anEmailInAnotherBusinessIsRefusedAndNoLoginIsMade() {
        Map<String, Object> row = new HashMap<>();
        row.put("email", "Asha@Acme.test ");
        row.put("first_name", "Asha");
        row.put("company_id", UUID.randomUUID());
        when(jdbc.queryForList(anyString(), eq(employee), eq(tenant))).thenReturn(List.of(row));
        when(credRepo.findByEmailIgnoreCase("asha@acme.test")).thenReturn(Optional.empty());
        when(jdbc.queryForObject(contains("email_signs_in_elsewhere(?, ?)"), eq(Boolean.class), eq("asha@acme.test"), eq(tenant)))
                .thenReturn(true);

        assertThatThrownBy(() -> service.sendInvitation(employee, tenant, UUID.randomUUID()))
                .isInstanceOfSatisfying(BusinessRuleException.class,
                        e -> org.assertj.core.api.Assertions.assertThat(e.getMessage()).isEqualTo(InvitationService.IN_ANOTHER_BUSINESS_MESSAGE));
        verify(credRepo, never()).save(any());
    }

    @Test
    void anEmailOnlyInThisBusinessIsFine() {
        when(jdbc.queryForObject(contains("email_signs_in_elsewhere(?, ?)"), eq(Boolean.class), eq("ravi@acme.test"), eq(tenant)))
                .thenReturn(false);
        assertThatCode(() -> service.assertNotInAnotherBusiness("ravi@acme.test", tenant)).doesNotThrowAnyException();
    }

    @Test
    void beforeTheMigrationIsAppliedTheCheckIsSkipped() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(false);
        assertThatCode(() -> service.assertNotInAnotherBusiness("asha@acme.test", tenant)).doesNotThrowAnyException();
        verify(jdbc, never()).queryForObject(contains("email_signs_in_elsewhere(?, ?)"), eq(Boolean.class), any(), any());
    }
}
