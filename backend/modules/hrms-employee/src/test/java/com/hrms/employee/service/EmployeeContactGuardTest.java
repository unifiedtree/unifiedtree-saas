package com.hrms.employee.service;

import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.service.EmployeeContactGuard.Field;
import com.hrms.employee.service.EmployeeContactGuard.Owner;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The workspace's email rule (owner, 2026-10-05: "unique mails should be there for each company"). */
class EmployeeContactGuardTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID AISHA = UUID.randomUUID();
    private static final Owner AISHA_WORK = new Owner(AISHA, "Aisha Khan", "EMP-0003", false, Field.WORK);

    private JdbcTemplate jdbc;
    private EmployeeContactGuard guard;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        guard = new EmployeeContactGuard(jdbc);
        TenantContext.setTenantId(TENANT);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    private static void signInWith(String... permissions) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("u", null,
                java.util.Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList()));
    }

    @SuppressWarnings("unchecked")
    private void employeesMatch(List<Owner> owners) {
        when(jdbc.query(startsWith("SELECT id, first_name"), any(RowMapper.class), any(Object[].class)))
                .thenReturn((List) owners);
    }

    @Test
    void emailsAreComparedTrimmedAndLowerCased() {
        assertThat(EmployeeContactGuard.normalizeEmail("  Ravi.K@Example.COM \t")).isEqualTo("ravi.k@example.com");
        assertThat(EmployeeContactGuard.normalizeEmail("reader@unifiedtree.demo")).isEqualTo("reader@unifiedtree.demo");
        assertThat(EmployeeContactGuard.normalizeEmail("   ")).isNull();
        assertThat(EmployeeContactGuard.normalizeEmail(null)).isNull();
    }

    @Test
    void phonesAreComparedByTheirLastTenDigits() {
        assertThat(EmployeeContactGuard.phoneKey("+91 98450-12345")).isEqualTo("9845012345");
        assertThat(EmployeeContactGuard.phoneKey("9845012345")).isEqualTo("9845012345");
        assertThat(EmployeeContactGuard.phoneKey("12345")).isNull();
        assertThat(EmployeeContactGuard.phoneKey(null)).isNull();
    }

    @Test
    void theLookupUsesTheNormalisedAddressInThisWorkspaceAndLeavesOutThePersonBeingEdited() {
        employeesMatch(List.of(AISHA_WORK));
        UUID self = UUID.randomUUID();
        assertThat(guard.emailOwner(TENANT, " Aisha@X.com ", self)).contains(AISHA_WORK);

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), args.capture());
        assertThat(sql.getValue()).contains("lower(btrim(email)) = ?").contains("lower(btrim(personal_email)) = ?")
                .contains("tenant_id = ?").contains("id <> ?");
        assertThat(args.getValue()).containsExactly("aisha@x.com", TENANT, "aisha@x.com", "aisha@x.com", self);
    }

    @Test
    void addingSomeoneHasNoOneToLeaveOut() {
        employeesMatch(List.of());
        guard.emailOwner(TENANT, "new@x.com", null);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(2)).query(sql.capture(), any(RowMapper.class), any(Object[].class));
        assertThat(sql.getAllValues()).noneMatch(s -> s.contains("<> ?"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void anotherEmployeesLoginCountsWhenNoEmployeeRecordHasTheAddress() {
        employeesMatch(List.of());
        Owner login = new Owner(AISHA, "Aisha Khan", "EMP-0003", false, Field.LOGIN);
        when(jdbc.query(contains("FROM auth.user_credentials"), any(RowMapper.class), any(Object[].class)))
                .thenReturn((List) List.of(login));
        assertThat(guard.emailOwner(TENANT, "aisha@x.com", null)).contains(login);
    }

    @Test
    void aBlankEmailIsNeverAClash() {
        assertThat(guard.emailOwner(TENANT, "  ", null)).isEmpty();
        assertThat(guard.emailOwner(null, "a@x.com", null)).isEmpty();
    }

    @Test
    void aTakenEmailIsA409ThatNamesThePersonToHrOnly() {
        employeesMatch(List.of(AISHA_WORK));
        signInWith("hrms.employee.write");
        assertThatThrownBy(() -> guard.assertEmailFree("READER@unifiedtree.demo ", null))
                .isInstanceOf(EmailAlreadyUsedException.class)
                .hasMessage("This email already belongs to Aisha Khan (EMP-0003).")
                .satisfies(e -> {
                    assertThat(((EmailAlreadyUsedException) e).getErrorCode()).isEqualTo("EMAIL_ALREADY_USED");
                    assertThat(((EmailAlreadyUsedException) e).getStatus().value()).isEqualTo(409);
                });

        SecurityContextHolder.getContext().setAuthentication(null);
        signInWith("hrms.employee.team.manage");
        assertThatThrownBy(() -> guard.assertEmailFree("reader@unifiedtree.demo", null))
                .hasMessage("This email is already used by another employee in this workspace.");
    }

    @Test
    void someoneWhoLeftStillHasTheirEmail() {
        Owner left = new Owner(AISHA, "Aisha Khan", "EMP-0003", true, Field.WORK);
        assertThat(EmployeeContactGuard.conflictMessage(left, true))
                .isEqualTo("This email already belongs to Aisha Khan (EMP-0003), who has left. Their record keeps the email, so use a different one.");
    }

    @Test
    void aPersonalEmailClashSaysWhoseItIs() {
        Owner personal = new Owner(AISHA, "Aisha Khan", "EMP-0003", false, Field.PERSONAL);
        assertThat(EmployeeContactGuard.conflictMessage(personal, true))
                .isEqualTo("This email is already the personal email of Aisha Khan (EMP-0003).");
        assertThat(EmployeeContactGuard.conflictMessage(personal, false))
                .isEqualTo(EmployeeContactGuard.GENERIC_EMAIL_MESSAGE);
    }

    @Test
    void namesAreShownToPeopleWhoReadOrEditEveryRecord() {
        assertThat(EmployeeContactGuard.callerMaySeeOwners()).isFalse();
        signInWith("hrms.employee.read");
        assertThat(EmployeeContactGuard.callerMaySeeOwners()).isTrue();
    }

    @Test
    void aRaceOnTheUniqueIndexIsRecognised() {
        assertThat(EmployeeContactGuard.isEmailIndexViolation(new DataIntegrityViolationException("x",
                new RuntimeException("duplicate key value violates unique constraint \"uq_employees_tenant_email_norm\""))))
                .isTrue();
        assertThat(EmployeeContactGuard.isEmailIndexViolation(new DataIntegrityViolationException("uq_employee_company_code")))
                .isFalse();
    }

    @Test
    void aSharedPhoneIsAWarningThatNamesUpToThreePeople() {
        Owner a = new Owner(UUID.randomUUID(), "A One", "EMP-1", false, Field.WORK);
        Owner b = new Owner(UUID.randomUUID(), "B Two", "EMP-2", false, Field.WORK);
        Owner c = new Owner(UUID.randomUUID(), "C Three", "EMP-3", true, Field.WORK);
        Owner d = new Owner(UUID.randomUUID(), "D Four", "EMP-4", false, Field.WORK);
        assertThat(EmployeeContactGuard.phoneWarning(List.of(a), true)).isEqualTo("Also used by A One (EMP-1).");
        assertThat(EmployeeContactGuard.phoneWarning(List.of(a, b), true)).isEqualTo("Also used by A One (EMP-1) and B Two (EMP-2).");
        assertThat(EmployeeContactGuard.phoneWarning(List.of(a, b, c, d), true))
                .isEqualTo("Also used by A One (EMP-1), B Two (EMP-2), C Three (EMP-3) and 1 more.");
        assertThat(EmployeeContactGuard.phoneWarning(List.of(a), false)).isEqualTo("This number is also used by another employee.");
        assertThat(EmployeeContactGuard.phoneWarning(List.of(), true)).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void thePhoneLookupComparesTheLastTenDigits() {
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn((List) List.of(AISHA_WORK));
        assertThat(guard.phoneOwners(TENANT, "+91 98450 12345", AISHA)).containsExactly(AISHA_WORK);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(contains("right(regexp_replace"), any(RowMapper.class), args.capture());
        assertThat(args.getValue()).containsExactly(TENANT, "9845012345", AISHA);
        assertThat(guard.phoneOwners(TENANT, "12", null)).isEmpty();
    }
}
