package com.unifiedtree.auth.phone;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Phone sign-in on a business's own login page stays inside that business (contract §5b). */
class PhoneLookupScopeTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PhoneLookupService lookup = new PhoneLookupService(jdbc);
    private final UUID acme = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID login = UUID.randomUUID();

    @Test
    void onABusinessPageOnlyThatBusinessIsSearched() {
        when(jdbc.queryForList(contains("FROM hrms.employees"), eq("9876543210"), eq(acme)))
                .thenReturn(List.of(Map.of("id", employee, "email", "ravi@acme.test")));
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(UUID.class), eq(employee), eq(acme)))
                .thenReturn(List.of(login));

        var m = lookup.findByPhone("+91 98765 43210", acme).orElseThrow();

        assertThat(m.tenantId()).isEqualTo(acme);
        assertThat(m.authUserId()).isEqualTo(login);
        // The across-businesses match (newest login anywhere) is never consulted on a business page.
        verify(jdbc, never()).queryForList(contains("phone_login_match"), any(Object[].class));
        verify(jdbc, never()).queryForList(contains("phone_login_match"), anyString());
    }

    @Test
    void aNumberOnFileOnlyInAnotherBusinessIsNotRegisteredHere() {
        when(jdbc.queryForList(contains("FROM hrms.employees"), eq("9876543210"), eq(acme))).thenReturn(List.of());
        assertThat(lookup.findByPhone("9876543210", acme)).isEmpty();
    }

    @Test
    void anUnknownBusinessMatchesNothing() {
        when(jdbc.queryForList(contains("FROM platform.tenants"), eq(UUID.class), eq("nope"))).thenReturn(List.of());
        UUID none = lookup.businessBySubdomain("nope");
        assertThat(none).isEqualTo(PhoneLookupService.NO_SUCH_BUSINESS);
        assertThat(lookup.findByPhone("9876543210", none)).isEmpty();
    }

    @Test
    void withoutABusinessTheAppKeepsTodaysLookup() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForList(contains("phone_login_match"), eq("9876543210")))
                .thenReturn(List.of(Map.of("tenant_id", acme, "user_id", login, "employee_id", employee, "email", "ravi@acme.test")));
        assertThat(lookup.findByPhone("9876543210", null)).isPresent();
    }

    @Test
    void tooShortANumberNeverMatches() {
        assertThat(lookup.findByPhone("12345", acme)).isEmpty();
    }
}
