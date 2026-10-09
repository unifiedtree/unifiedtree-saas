package com.unifiedtree.auth.phone;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
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

/** The mobile app's phone lookup (owner's decision Q-21): only the one active login with this number. */
class PhoneLookupTheOnlyLoginTest {

    private static final String NUMBER = "9876543210";

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PhoneLookupService lookup = new PhoneLookupService(jdbc);
    private final UUID acme = UUID.randomUUID();
    private final UUID beta = UUID.randomUUID();
    private final UUID ravi = UUID.randomUUID();
    private final UUID raviLogin = UUID.randomUUID();

    @BeforeEach
    void twoBusinesses() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForList(contains("FROM platform.tenants"), eq(UUID.class))).thenReturn(List.of(acme, beta));
        when(jdbc.queryForList(contains("FROM hrms.employees"), eq(NUMBER), any())).thenReturn(List.of());
    }

    private void indexFinds(UUID tenant, UUID login, UUID employee) {
        when(jdbc.queryForList(contains("phone_login_match"), eq(NUMBER))).thenReturn(List.of(
                Map.of("tenant_id", tenant, "user_id", login, "employee_id", employee, "email", "ravi@acme.test")));
    }

    private void employees(UUID tenant, UUID... ids) {
        List<Map<String, Object>> rows = java.util.Arrays.stream(ids)
                .map(id -> Map.<String, Object>of("id", id, "email", id + "@x.test")).toList();
        when(jdbc.queryForList(contains("FROM hrms.employees"), eq(NUMBER), eq(tenant))).thenReturn(rows);
        for (UUID id : ids) {
            when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(UUID.class), eq(id), eq(tenant)))
                    .thenReturn(List.of(id.equals(ravi) ? raviLogin : UUID.randomUUID()));
        }
    }

    @Test
    void aNumberOnNoActiveLoginIsNotRegisteredAndNoBusinessIsScanned() {
        // Unknown, or only on an inactive employee / a switched-off login: the index finds nothing, as today.
        when(jdbc.queryForList(contains("phone_login_match"), eq(NUMBER))).thenReturn(List.of());
        assertThat(lookup.findTheOnlyLogin("+91 98765 43210")).isEmpty();
        verify(jdbc, never()).queryForList(contains("FROM platform.tenants"), eq(UUID.class));
    }

    @Test
    void oneActiveLoginSignsInAsToday() {
        indexFinds(acme, raviLogin, ravi);
        employees(acme, ravi);
        var m = lookup.findTheOnlyLogin(NUMBER).orElseThrow();
        assertThat(m.tenantId()).isEqualTo(acme);
        assertThat(m.authUserId()).isEqualTo(raviLogin);
        assertThat(m.employeeId()).isEqualTo(ravi);
    }

    @Test
    void twoActiveLoginsInOneBusinessSignNobodyIn() {
        indexFinds(acme, raviLogin, ravi);
        employees(acme, ravi, UUID.randomUUID());
        assertThatThrownBy(() -> lookup.findTheOnlyLogin(NUMBER)).isInstanceOf(PhoneLookupService.SeveralLogins.class);
    }

    @Test
    void oneActiveLoginInEachOfTwoBusinessesSignsNobodyIn() {
        indexFinds(acme, raviLogin, ravi);
        employees(acme, ravi);
        employees(beta, UUID.randomUUID());
        assertThatThrownBy(() -> lookup.findTheOnlyLogin(NUMBER)).isInstanceOf(PhoneLookupService.SeveralLogins.class);
    }

    @Test
    void eachBusinessCountsOnlyActiveEmployeesWithAnActiveLogin() {
        indexFinds(acme, raviLogin, ravi);
        employees(acme, ravi);
        lookup.findTheOnlyLogin(NUMBER);
        // The web's rule, in every business: an inactive employee or a switched-off login is not a second login.
        verify(jdbc).queryForList(contains("e.is_active = TRUE"), eq(NUMBER), eq(acme));
        verify(jdbc).queryForList(contains("uc.is_active = TRUE"), eq(NUMBER), eq(beta));
    }

    @Test
    void theIndexFindingAnotherPersonThanTheScanMeansTwo() {
        indexFinds(beta, UUID.randomUUID(), UUID.randomUUID());
        employees(acme, ravi);
        assertThatThrownBy(() -> lookup.findTheOnlyLogin(NUMBER)).isInstanceOf(PhoneLookupService.SeveralLogins.class);
    }

    @Test
    void aBusinessTheScanCannotReadKeepsTodaysAnswer() {
        indexFinds(acme, raviLogin, ravi);
        when(jdbc.queryForList(contains("FROM hrms.employees"), eq(NUMBER), eq(acme))).thenThrow(new RuntimeException("drift"));
        assertThat(lookup.findTheOnlyLogin(NUMBER)).get().extracting(PhoneLookupService.Match::authUserId).isEqualTo(raviLogin);
    }

    @Test
    void tooShortANumberNeverMatches() {
        assertThat(lookup.findTheOnlyLogin("12345")).isEmpty();
        verify(jdbc, never()).queryForList(contains("phone_login_match"), anyString());
    }
}
