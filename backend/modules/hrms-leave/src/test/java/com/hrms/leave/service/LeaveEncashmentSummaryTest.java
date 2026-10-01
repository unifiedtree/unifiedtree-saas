package com.hrms.leave.service;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentSummary;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** "Can encash now" for the Encash tab (BW-45): each person's own limit, summed. */
class LeaveEncashmentSummaryTest {

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID();
    private final UUID asha = UUID.randomUUID(), ravi = UUID.randomUUID(), earned = UUID.randomUUID(), casual = UUID.randomUUID();
    private JdbcTemplate jdbc;
    private LeaveEncashmentService service;
    private String sql;
    private List<Object> args;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        jdbc = mock(JdbcTemplate.class);
        service = new LeaveEncashmentService(jdbc, mock(LeaveAccrualService.class), mock(ApplicationEventPublisher.class));
    }

    @AfterEach void clear() { TenantContext.clear(); }

    private static ResultSet row(UUID employee, UUID type, String name, Integer max, double available, double requested) throws SQLException {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("employee_id", UUID.class)).thenReturn(employee);
        when(rs.getObject("type_id", UUID.class)).thenReturn(type);
        when(rs.getString("type_name")).thenReturn(name);
        when(rs.getInt("max_encash_days")).thenReturn(max == null ? 0 : max);
        when(rs.wasNull()).thenReturn(max == null);
        when(rs.getDouble("available")).thenReturn(available);
        when(rs.getDouble("requested")).thenReturn(requested);
        return rs;
    }

    @Test void everyonesLimitIsTheirBalanceCappedByWhatIsLeftOfTheYearlyLimitInHalfDays() {
        doAnswer(inv -> {
            Object[] all = inv.getArguments();
            sql = (String) all[0];
            args = new ArrayList<>(Arrays.asList(all).subList(2, all.length));
            RowCallbackHandler h = inv.getArgument(1);
            h.processRow(row(asha, earned, "Earned leave", null, 7.75, 0));   // 7.5
            h.processRow(row(asha, casual, "Casual leave", 5, 10, 3));        // 2
            h.processRow(row(ravi, earned, "Earned leave", null, 0, 0));      // nothing
            h.processRow(row(ravi, casual, "Casual leave", 5, 10, 5));        // yearly limit used up
            return null;
        }).when(jdbc).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));

        EncashmentSummary s = service.summary(company);
        assertEquals(9.5, s.days());
        assertEquals(1, s.people());
        assertEquals(company, s.companyId());
        assertEquals(List.of("Casual leave", "Earned leave"), s.types().stream().map(t -> t.leaveTypeName()).toList());
        assertEquals(2.0, s.types().get(0).days());
        assertEquals(7.5, s.types().get(1).days());
        assertEquals(1, s.types().get(1).people());
        // Only people whose balances are kept, only encashable active types, only this workspace and company.
        assertTrue(sql.contains(LeaveAccrualService.LIVE));
        assertTrue(sql.contains("lt.is_encashable = TRUE") && sql.contains("lt.is_active = TRUE"));
        assertEquals(tenant, args.get(2));
        assertEquals(company, args.get(3));
    }

    @Test void withoutTheEncashmentTableItIsNotSwitchedOnYet() {
        doThrow(new BadSqlGrammarException("summary", "SELECT …", new SQLException("relation does not exist", "42P01")))
                .when(jdbc).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
        FeatureNotReady e = assertThrows(FeatureNotReady.class, () -> service.summary(null));
        assertEquals("FEATURE_NOT_READY", e.getErrorCode());
    }
}
