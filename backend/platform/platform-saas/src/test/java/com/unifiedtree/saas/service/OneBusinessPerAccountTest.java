package com.unifiedtree.saas.service;

import com.unifiedtree.saas.dto.SaasDtos.SignupRequest;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.Invocation;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * One business per account (owner decision, 6 Oct 2026), and the sign-up's
 * separate name for the first HRMS company.
 */
class OneBusinessPerAccountTest {

    @Test
    void anAccountThatAlreadyHasABusinessCannotCreateAnother() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SaasWriter writer = mock(SaasWriter.class);
        UUID account = UUID.randomUUID();
        when(jdbc.queryForObject(contains("platform.account_workspaces"), eq(Boolean.class), eq(account)))
                .thenReturn(true);

        assertThatThrownBy(() -> service(jdbc, writer).createFreeWorkspace(account, "hash",
                "Acme", "acme", "Asha Rao", "asha@acme.test", null, "India", "Asia/Kolkata", "INR", null))
                .isInstanceOfSatisfying(ResponseStatusException.class, e -> {
                    assertThat(e.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(e.getReason()).isEqualTo(SaasService.ONE_BUSINESS_PER_ACCOUNT);
                });
        verifyNoInteractions(writer);
    }

    @Test
    void anAccountWithoutABusinessCanCreateOne() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SaasWriter writer = mock(SaasWriter.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);
        when(jdbc.queryForObject(contains("platform.account_workspaces"), eq(Boolean.class), any(UUID.class)))
                .thenReturn(false);
        when(jdbc.queryForObject(contains("platform.tenants"), eq(Boolean.class), anyString()))
                .thenReturn(false);

        var resp = service(jdbc, writer).createFreeWorkspace(UUID.randomUUID(), "hash",
                "Acme", "acme", "Asha Rao", "asha@acme.test", null, "India", "Asia/Kolkata", "INR", "Acme Labs");

        assertThat(resp.subdomain()).isEqualTo("acme");
        SignupRequest sent = (SignupRequest) mockingDetails(writer).getInvocations().iterator().next().getArguments()[7];
        assertThat(sent.companyName()).isEqualTo("Acme");
        assertThat(sent.firstCompanyName()).isEqualTo("Acme Labs");
    }

    @Test
    void theFirstCompanyTakesItsOwnNameAndTheBusinessKeepsTheBusinessName() {
        assertThat(companyNameWritten("Acme Labs")).isEqualTo("Acme Labs");
        assertThat(tenantNameWritten("Acme Labs")).isEqualTo("Acme Group");
    }

    @Test
    void withoutACompanyNameTheFirstCompanyTakesTheBusinessName() {
        assertThat(companyNameWritten(null)).isEqualTo("Acme Group");
        assertThat(companyNameWritten("  ")).isEqualTo("Acme Group");
    }

    private static SaasService service(JdbcTemplate jdbc, SaasWriter writer) {
        return new SaasService(jdbc, writer, null, null, "unifiedtree.com",
                e -> { }, null, null, null, null);
    }

    private static String companyNameWritten(String firstCompanyName) {
        // args: [sql, id, tenant, name, legal_name, ...]
        return (String) insert(firstCompanyName, "INSERT INTO org.companies")[3];
    }

    private static String tenantNameWritten(String firstCompanyName) {
        // args: [sql, id, subdomain, display_name, ...]
        return (String) insert(firstCompanyName, "INSERT INTO platform.tenants")[3];
    }

    private static Object[] insert(String firstCompanyName, String sqlPrefix) {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new SaasWriter(jdbc).signup(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "acme", "unifiedtree.com", "hash", List.of(),
                new SignupRequest("Acme Group", "acme", "Asha Rao", "asha@acme.test", null, "password1",
                        null, null, null, null, null, null, List.of("hrms"), null, null, firstCompanyName));
        return mockingDetails(jdbc).getInvocations().stream()
                .filter(i -> i.getMethod().getName().equals("update"))
                .map(Invocation::getArguments)
                .filter(a -> a.length > 0 && a[0] instanceof String sql && sql.strip().startsWith(sqlPrefix))
                .findFirst().orElseThrow();
    }
}
