package com.hrms.app.reports;

import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.settings.service.HrConfigurationService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Loads one company's employees for the headcount workbook
 * ({@link HeadcountWorkbook}). Read-only, under the request's tenant (RLS).
 * The fiscal year comes from the company record, through
 * {@link HrConfigurationService#fiscalYearStart}, the one source.
 */
@Service
public class HeadcountWorkbookService {

    private final JdbcTemplate jdbc;
    private final HrConfigurationService hrConfig;

    public HeadcountWorkbookService(JdbcTemplate jdbc, HrConfigurationService hrConfig) {
        this.jdbc = jdbc;
        this.hrConfig = hrConfig;
    }

    @Transactional(readOnly = true)
    public HeadcountWorkbook.Workbook build(UUID companyId, LocalDate asOf, LocalDate today,
                                            boolean includeEmployees, boolean includeGender) {
        String companyName = jdbc.query("SELECT name FROM org.companies WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null, companyId);
        if (companyName == null) throw new ResourceNotFoundException("Company " + companyId + " not found");
        List<HeadcountWorkbook.Row> rows = jdbc.query("""
                SELECT e.id, e.employee_code, e.first_name, e.middle_name, e.last_name, e.email,
                       e.gender, e.employment_type, e.employment_status, e.is_active,
                       e.date_of_joining, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date AS created_on,
                       e.probation_end_date, e.confirmation_date, e.notice_start_date,
                       e.last_working_day, e.date_of_termination,
                       d.name AS department, g.title AS designation, b.name AS branch,
                       NULLIF(TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')), '') AS manager
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id
                  LEFT JOIN org.branches b ON b.id = e.branch_id
                  LEFT JOIN hrms.employees m ON m.id = e.reporting_manager_id
                 WHERE e.company_id = ?
                """, HeadcountWorkbookService::row, companyId);
        return HeadcountWorkbook.build(companyName, asOf, today, hrConfig.fiscalYearStart(companyId),
                rows, includeEmployees, includeGender);
    }

    private static HeadcountWorkbook.Row row(ResultSet rs, int i) throws SQLException {
        return new HeadcountWorkbook.Row(
                rs.getObject("id", UUID.class), rs.getString("employee_code"),
                rs.getString("first_name"), rs.getString("middle_name"), rs.getString("last_name"),
                rs.getString("email"), rs.getString("gender"), rs.getString("employment_type"),
                rs.getString("employment_status"), rs.getBoolean("is_active"),
                date(rs, "date_of_joining"), date(rs, "created_on"), date(rs, "probation_end_date"),
                date(rs, "confirmation_date"), date(rs, "notice_start_date"), date(rs, "last_working_day"),
                date(rs, "date_of_termination"),
                rs.getString("department"), rs.getString("designation"), rs.getString("branch"), rs.getString("manager"));
    }

    private static LocalDate date(ResultSet rs, String column) throws SQLException {
        Date d = rs.getDate(column);
        return d == null ? null : d.toLocalDate();
    }
}
