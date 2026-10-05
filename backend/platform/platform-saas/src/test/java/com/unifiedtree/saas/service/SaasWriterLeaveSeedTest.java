package com.unifiedtree.saas.service;

import com.unifiedtree.saas.dto.SaasDtos.SignupRequest;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.Invocation;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;

/**
 * A new workspace's default leave types (Annual, Sick, Casual) start at 0 days a year;
 * the admin sets the number they want. Covers the type rows and the admin's balances.
 */
class SaasWriterLeaveSeedTest {

    @Test
    void newWorkspaceLeaveTypesAndBalancesStartAtZeroDays() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SaasWriter writer = new SaasWriter(jdbc);

        writer.signup(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "acme", "unifiedtree.com", "hash", List.of(),
                new SignupRequest("Acme", "acme", "Asha Rao", "asha@acme.test", null, "password1",
                        null, null, null, null, null, null, List.of("hrms"), null, null, null));

        List<Object[]> types = updates(jdbc, "INSERT INTO leave_mgmt.leave_types");
        List<Object[]> balances = updates(jdbc, "INSERT INTO leave_mgmt.leave_balances");

        // args: [sql, id, tenant, company, name, code, annual_entitlement, category, description]
        assertThat(types).extracting(a -> a[5]).containsExactly("ANNUAL", "SICK", "CASUAL");
        assertThat(types).extracting(a -> a[6]).containsOnly(0);
        // args: [sql, id, tenant, employee, leave_type, year, total_entitlement, accrued]
        assertThat(balances).hasSize(3);
        assertThat(balances).extracting(a -> a[6]).containsOnly(0);
        assertThat(balances).extracting(a -> a[7]).containsOnly(0);
    }

    private static List<Object[]> updates(JdbcTemplate jdbc, String sqlPrefix) {
        return mockingDetails(jdbc).getInvocations().stream()
                .filter(i -> i.getMethod().getName().equals("update"))
                .map(Invocation::getArguments)
                .filter(a -> a.length > 0 && a[0] instanceof String sql && sql.strip().startsWith(sqlPrefix))
                .toList();
    }
}
