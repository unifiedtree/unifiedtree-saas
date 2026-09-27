package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.employee.entity.Employee;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.Month;
import java.time.format.TextStyle;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Payday: the pay date of the company's payroll runs that falls in the window,
 * for people who can read their own payslips ({@code payroll.payslip.read.self},
 * payroll module). Only a date a run actually has; nothing is worked out from
 * the processing day here (that is the payslip schedule's job, BW-55).
 */
@Component
class PaydaySource implements AroundSource {

    private final JdbcTemplate jdbc;

    PaydaySource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "PAYDAY"; }
    @Override public String module() { return "payroll"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("payroll.payslip.read.self"); }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        return jdbc.query("""
                SELECT r.id, r.pay_date, r.period_year, r.period_month
                  FROM payroll.runs r
                 WHERE r.tenant_id = ? AND r.company_id = ? AND r.status <> 'CANCELLED'
                   AND r.pay_date BETWEEN ? AND ?
                 ORDER BY r.pay_date, r.period_year, r.period_month
                """, (rs, i) -> new AroundItem("PAYDAY", rs.getObject("pay_date", LocalDate.class), "ON", "Payday",
                        Month.of(rs.getInt("period_month")).getDisplayName(TextStyle.FULL, Locale.ENGLISH) + " "
                                + rs.getInt("period_year") + " pay",
                        null, rs.getObject("id", UUID.class), null, null, null, "/me/payslips"),
                caller.tenantId(), me.getCompanyId(), from, to);
    }
}
