package com.hrms.api.saas;

import com.hrms.api.mail.MailService;
import com.hrms.api.saas.SaasDtos.SignupRequest;
import com.hrms.auth.util.JwtTokenProvider;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.Invocation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;

/**
 * A new company's default leave types (Annual, Sick, Casual) start at 0 days a year;
 * the admin sets the number they want. Covers the type rows and the admin's balances.
 */
class SaasPlatformServiceLeaveSeedTest {

    @Test
    void newCompanyLeaveTypesAndBalancesStartAtZeroDays() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SaasPlatformService service = new SaasPlatformService(jdbc, mock(PasswordEncoder.class),
                mock(JwtTokenProvider.class), mock(MailService.class), "unifiedtree.com", 15);

        service.createSignupRequest(new SignupRequest("Acme", "acme", "Asha Rao", "asha@acme.test",
                null, "password1", null, null, null, null, null, null, List.of("hrms")));

        List<Object[]> types = updates(jdbc, "INSERT INTO leave_types");
        List<Object[]> balances = updates(jdbc, "INSERT INTO leave_balances");

        // args: [sql, id, tenant, company, name, code, annual_entitlement]
        assertThat(types).extracting(a -> a[5]).containsExactly("ANNUAL", "SICK", "CASUAL");
        assertThat(types).extracting(a -> a[6]).containsOnly(0);
        // args: [sql, tenant, employee, leave_type, year, total_entitlement]
        assertThat(balances).hasSize(3);
        assertThat(balances).extracting(a -> a[5]).containsOnly(0);
    }

    private static List<Object[]> updates(JdbcTemplate jdbc, String sqlPrefix) {
        return mockingDetails(jdbc).getInvocations().stream()
                .filter(i -> i.getMethod().getName().equals("update"))
                .map(Invocation::getArguments)
                .filter(a -> a.length > 0 && a[0] instanceof String sql && sql.strip().startsWith(sqlPrefix))
                .toList();
    }
}
