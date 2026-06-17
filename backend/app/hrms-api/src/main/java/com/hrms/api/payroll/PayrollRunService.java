package com.hrms.api.payroll;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.letters.service.PdfRenderer;
import com.hrms.payroll.engine.PayrollEngine;
import com.hrms.payroll.engine.PayrollEngine.ComponentDef;
import com.hrms.payroll.engine.PayrollEngine.EarningLine;
import com.hrms.payroll.engine.PayrollEngine.EmployeeStructureCfg;
import com.hrms.payroll.engine.PayrollEngine.PayrollEngineInput;
import com.hrms.payroll.engine.PayrollEngine.PayrollResult;
import com.hrms.payroll.engine.PayrollEngine.StatutoryConfig;
import com.hrms.payroll.lop.LopCalculator;
import com.hrms.payroll.lop.LopCalculator.DayStatus;
import com.hrms.payroll.lop.LopCalculator.LopInput;
import com.hrms.payroll.lop.LopCalculator.LopResult;
import com.hrms.payroll.service.DefaultComponentSeeder;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.*;

/**
 * Payroll run lifecycle + calculation orchestration (Prompt 13a). Lives in
 * hrms-api because it needs the pure {@link PayrollEngine} + {@link LopCalculator}
 * (hrms-payroll) AND the {@link PdfRenderer} (hrms-letters) AND raw RLS-scoped
 * JDBC against attendance / leave / holiday / employee tables.
 *
 * <p>Lifecycle: {@code DRAFT --process--> PROCESSING --lock--> LOCKED}. LOCKED is
 * terminal in 13a (reopen is deliberately rejected). PAID/CANCELLED are reserved
 * for a later phase.
 *
 * <p><b>Attendance defaulting is exception-based:</b> a working day with no
 * attendance record and no approved leave counts as PRESENT (paid). This matches
 * how Indian SMEs run payroll — pay is full unless an absence/LOP is explicitly
 * marked — and avoids silently under-paying employees whose attendance isn't
 * religiously tracked. Marked ABSENT and unpaid approved leave still produce LOP.
 */
@Service
public class PayrollRunService {

    private static final Logger log = LoggerFactory.getLogger(PayrollRunService.class);

    private final JdbcTemplate jdbc;
    private final PdfRenderer pdfRenderer;
    private final ObjectMapper objectMapper;
    private final DefaultComponentSeeder seeder;

    public PayrollRunService(JdbcTemplate jdbc, PdfRenderer pdfRenderer, ObjectMapper objectMapper,
                             DefaultComponentSeeder seeder) {
        this.jdbc = jdbc;
        this.pdfRenderer = pdfRenderer;
        this.objectMapper = objectMapper;
        this.seeder = seeder;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record CreateRunRequest(UUID companyId, Integer periodMonth, Integer periodYear) {}

    public record RunDto(
        UUID id, UUID companyId, String companyName, int periodMonth, int periodYear,
        String periodStart, String periodEnd, String status, int employeeCount,
        BigDecimal totalGross, BigDecimal totalDeductions, BigDecimal totalNet,
        String processedAt, String lockedAt, String createdAt, int skippedEmployeeCount) {}

    public record EligibleEmployeeDto(UUID employeeId, String employeeCode, String employeeName,
                                      BigDecimal ctcMonthly) {}

    public record RunEmployeeDto(UUID employeeId, String employeeCode, String employeeName,
                                 BigDecimal paidDays, BigDecimal lopDays,
                                 BigDecimal gross, BigDecimal deductions, BigDecimal netPay) {}

    public record PayslipLineDto(String code, String name, BigDecimal amount) {}

    public record PayslipDto(
        UUID runId, UUID employeeId, String employeeName, String employeeCode,
        String designation, String period, String panMasked, String bankMasked,
        BigDecimal paidDays, BigDecimal lopDays,
        List<PayslipLineDto> earnings, List<PayslipLineDto> deductions,
        List<PayslipLineDto> employerContributions,
        BigDecimal gross, BigDecimal totalDeductions, BigDecimal netPay) {}

    public record MyPayslipDto(UUID runId, String period, int periodMonth, int periodYear,
                               BigDecimal netPay, String status, String lockedAt) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public List<RunDto> listRuns(UUID tenantId, UUID companyId, Integer year, String status) {
        bindTenant(tenantId);
        StringBuilder sql = new StringBuilder("""
            SELECT r.*, c.name AS company_name
              FROM payroll.runs r
              LEFT JOIN org.companies c ON c.id = r.company_id
             WHERE 1=1
            """);
        List<Object> args = new ArrayList<>();
        if (companyId != null) { sql.append(" AND r.company_id = ?"); args.add(companyId); }
        if (year != null)      { sql.append(" AND r.period_year = ?"); args.add(year); }
        if (status != null)    { sql.append(" AND r.status = ?"); args.add(status); }
        sql.append(" ORDER BY r.period_year DESC, r.period_month DESC");
        return jdbc.query(sql.toString(), (rs, i) -> toRunDto(rs), args.toArray());
    }

    @Transactional
    public RunDto getRun(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        List<RunDto> rows = jdbc.query("""
            SELECT r.*, c.name AS company_name
              FROM payroll.runs r
              LEFT JOIN org.companies c ON c.id = r.company_id
             WHERE r.id = ?
            """, (rs, i) -> toRunDto(rs), runId);
        if (rows.isEmpty()) throw new BusinessRuleException("Payroll run not found", "RUN_NOT_FOUND");
        return rows.get(0);
    }

    @Transactional
    public List<EligibleEmployeeDto> listEligibleEmployees(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        RunRow run = loadRun(runId);
        return queryEligible(run.companyId(), run.periodStart(), run.periodEnd());
    }

    /**
     * Employees who would have been eligible for this run's period but were skipped
     * because they have no current salary structure assigned (FIX P1-4). Eligibility
     * filters mirror {@link #queryEligible} exactly, minus the structure join.
     */
    @Transactional
    public List<EligibleEmployeeDto> listSkippedEmployees(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        RunRow run = loadRun(runId);
        return jdbc.query("""
            SELECT e.id, e.employee_code,
                   coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'') AS name
              FROM hrms.employees e
             WHERE e.company_id = ?
               AND e.is_active = TRUE
               AND e.employment_status::text NOT IN ('EXITED','TERMINATED')
               AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
               AND (e.last_working_day IS NULL OR e.last_working_day >= ?)
               AND NOT EXISTS (SELECT 1 FROM payroll.employee_salary_structures s
                                WHERE s.employee_id = e.id AND s.is_current IS TRUE)
             ORDER BY e.employee_code
            """, (rs, i) -> new EligibleEmployeeDto(
                rs.getObject("id", UUID.class), rs.getString("employee_code"),
                rs.getString("name").trim(), null),
            run.companyId(), run.periodEnd(), run.periodStart());
    }

    @Transactional
    public List<RunEmployeeDto> listRunEmployees(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        return jdbc.query("""
            SELECT l.employee_id,
                   e.employee_code,
                   coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'') AS name,
                   ld.paid_days, ld.lop_days,
                   coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')),0)  AS gross,
                   coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'),0)                    AS deductions
              FROM payroll.payslip_lines l
              JOIN hrms.employees e ON e.id = l.employee_id
              LEFT JOIN payroll.run_lop_days ld ON ld.run_id = l.run_id AND ld.employee_id = l.employee_id
             WHERE l.run_id = ?
             GROUP BY l.employee_id, e.employee_code, e.first_name, e.last_name, ld.paid_days, ld.lop_days
             ORDER BY e.employee_code
            """, (rs, i) -> {
                BigDecimal gross = rs.getBigDecimal("gross");
                BigDecimal ded = rs.getBigDecimal("deductions");
                return new RunEmployeeDto(
                    rs.getObject("employee_id", UUID.class), rs.getString("employee_code"),
                    rs.getString("name").trim(), rs.getBigDecimal("paid_days"), rs.getBigDecimal("lop_days"),
                    gross, ded, gross.subtract(ded));
            }, runId);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────

    @Transactional
    public RunDto createDraftRun(UUID tenantId, CreateRunRequest req, UUID createdBy) {
        bindTenant(tenantId);
        if (req.companyId() == null || req.periodMonth() == null || req.periodYear() == null) {
            throw new BusinessRuleException("companyId, periodMonth and periodYear are required", "INVALID_RUN");
        }
        YearMonth ym = YearMonth.of(req.periodYear(), req.periodMonth());
        LocalDate start = ym.atDay(1);
        LocalDate end = ym.atEndOfMonth();
        UUID id = jdbc.query("""
            INSERT INTO payroll.runs
                (tenant_id, company_id, period_month, period_year, period_start, period_end, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?)
            ON CONFLICT (tenant_id, company_id, period_year, period_month) DO NOTHING
            RETURNING id
            """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
            tenantId, req.companyId(), req.periodMonth(), req.periodYear(), start, end, createdBy);
        if (id == null) {
            id = jdbc.queryForObject("""
                SELECT id FROM payroll.runs
                 WHERE tenant_id = ? AND company_id = ? AND period_year = ? AND period_month = ?
                """, UUID.class, tenantId, req.companyId(), req.periodYear(), req.periodMonth());
        }
        return getRun(tenantId, id);
    }

    @Transactional
    public RunDto processRun(UUID tenantId, UUID runId, UUID processedBy) {
        bindTenant(tenantId);
        RunRow run = loadRun(runId);
        if ("LOCKED".equals(run.status()) || "PAID".equals(run.status())) {
            throw new BusinessRuleException("Run is locked and cannot be re-processed", "RUN_LOCKED");
        }
        YearMonth ym = YearMonth.of(run.periodYear(), run.periodMonth());

        Map<String, CompMeta> components = loadComponentsMeta();
        if (components.isEmpty()) {
            // FIX P0-1: a fresh tenant has no salary components, which used to make the
            // very first payroll run fail with COMPONENTS_NOT_SEEDED. Auto-seed the 9
            // standard components on demand (idempotent — ON CONFLICT DO NOTHING; mirrors
            // the loadSettings auto-create idiom below) so payroll works out-of-the-box
            // for every tenant, including ones provisioned before this fix. Concurrent
            // first-callers entering this branch together are safe for the same reason
            // (ON CONFLICT DO NOTHING → no dup rows, no error). See PayrollService.listComponents.
            log.info("No salary components for tenant {} — auto-seeding defaults before processing", tenantId);
            seeder.seedForTenant(tenantId);
            components = loadComponentsMeta();
            if (components.isEmpty()) {
                throw new BusinessRuleException("Unable to seed default salary components", "COMPONENTS_NOT_SEEDED");
            }
        }
        Map<String, Object> settings = loadSettings(tenantId);

        // Idempotent re-process: clear any prior output for this run.
        jdbc.update("DELETE FROM payroll.payslip_lines WHERE run_id = ?", runId);
        jdbc.update("DELETE FROM payroll.run_lop_days WHERE run_id = ?", runId);

        List<EligibleEmployeeDto> eligible = queryEligible(run.companyId(), run.periodStart(), run.periodEnd());
        for (EligibleEmployeeDto emp : eligible) {
            processEmployee(tenantId, runId, run.companyId(), emp.employeeId(), ym, components, settings);
        }

        // FIX P1-3: never let a run complete with negative net pay. Deductions
        // exceeding earnings means a misconfigured structure; halt the whole run
        // (this @Transactional rolls back the payslip writes above) and name the
        // affected employees so HR can fix the structures and re-process.
        List<String> negativeNet = jdbc.query("""
            SELECT e.employee_code
              FROM payroll.payslip_lines l
              JOIN hrms.employees e ON e.id = l.employee_id
             WHERE l.run_id = ?
             GROUP BY e.employee_code
            HAVING coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')),0)
                 - coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'),0) < 0
             ORDER BY e.employee_code
            """, (rs, i) -> rs.getString("employee_code"), runId);
        if (!negativeNet.isEmpty()) {
            throw new BusinessRuleException(
                "Run halted: " + negativeNet.size() + " employee(s) have negative net pay ("
                    + String.join(", ", negativeNet)
                    + "). Their deductions exceed earnings — fix the salary structures and re-process.",
                "NEGATIVE_NET_PAYROLL");
        }

        // FIX P1-4: count otherwise-eligible employees skipped for lacking a current
        // salary structure, so the run can surface them instead of silently dropping them.
        int skipped = countSkipped(run.companyId(), run.periodStart(), run.periodEnd());

        // Roll up run totals from the persisted lines.
        jdbc.update("""
            UPDATE payroll.runs r SET
                total_gross = coalesce((SELECT sum(amount) FROM payroll.payslip_lines
                                         WHERE run_id = r.id AND category IN ('EARNING','REIMBURSEMENT')), 0),
                total_deductions = coalesce((SELECT sum(amount) FROM payroll.payslip_lines
                                         WHERE run_id = r.id AND category = 'DEDUCTION'), 0),
                total_net = coalesce((SELECT sum(amount) FROM payroll.payslip_lines
                                         WHERE run_id = r.id AND category IN ('EARNING','REIMBURSEMENT')), 0)
                          - coalesce((SELECT sum(amount) FROM payroll.payslip_lines
                                         WHERE run_id = r.id AND category = 'DEDUCTION'), 0),
                employee_count = (SELECT count(DISTINCT employee_id) FROM payroll.payslip_lines WHERE run_id = r.id),
                status = 'PROCESSING', processed_at = now(), processed_by = ?,
                skipped_employee_count = ?, updated_at = now()
             WHERE r.id = ?
            """, processedBy, skipped, runId);

        log.info("Processed payroll run {} for {} employees ({} skipped, no structure)",
            runId, eligible.size(), skipped);
        return getRun(tenantId, runId);
    }

    @Transactional
    public RunDto lockRun(UUID tenantId, UUID runId, UUID lockedBy) {
        bindTenant(tenantId);
        RunRow run = loadRun(runId);
        if (!"PROCESSING".equals(run.status())) {
            throw new BusinessRuleException("Run must be processed before it can be locked", "RUN_NOT_PROCESSED");
        }
        jdbc.update("""
            UPDATE payroll.runs SET status = 'LOCKED', locked_at = now(), locked_by = ?, updated_at = now()
             WHERE id = ? AND status = 'PROCESSING'
            """, lockedBy, runId);
        return getRun(tenantId, runId);
    }

    @Transactional
    public void reopenRun(UUID tenantId, UUID runId) {
        bindTenant(tenantId);
        RunRow run = loadRun(runId);
        if ("LOCKED".equals(run.status()) || "PAID".equals(run.status())) {
            // Locked is final in Phase 1 — correction runs come in a later phase.
            throw new BusinessRuleException("Locked payroll runs cannot be reopened", "CANNOT_REOPEN_LOCKED");
        }
        throw new BusinessRuleException("Only a locked run could be reopened", "RUN_NOT_LOCKED");
    }

    // ── Payslips ────────────────────────────────────────────────────────────────

    @Transactional
    public PayslipDto getPayslip(UUID tenantId, UUID runId, UUID employeeId) {
        bindTenant(tenantId);
        return buildPayslip(runId, employeeId);
    }

    @Transactional
    public byte[] generatePayslipPdf(UUID tenantId, UUID runId, UUID employeeId) {
        bindTenant(tenantId);
        PayslipDto slip = buildPayslip(runId, employeeId);
        return pdfRenderer.render(renderPayslipHtml(slip));
    }

    @Transactional
    public List<MyPayslipDto> listMyPayslips(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        // Only LOCKED runs — an employee never sees draft/processing numbers.
        return jdbc.query("""
            SELECT r.id, r.period_month, r.period_year, r.status, r.locked_at,
                   coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')),0)
                 - coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'),0) AS net_pay
              FROM payroll.runs r
              JOIN payroll.payslip_lines l ON l.run_id = r.id AND l.employee_id = ?
             WHERE r.status = 'LOCKED'
             GROUP BY r.id, r.period_month, r.period_year, r.status, r.locked_at
             ORDER BY r.period_year DESC, r.period_month DESC
            """, (rs, i) -> new MyPayslipDto(
                rs.getObject("id", UUID.class), periodLabel(rs.getInt("period_month"), rs.getInt("period_year")),
                rs.getInt("period_month"), rs.getInt("period_year"), rs.getBigDecimal("net_pay"),
                rs.getString("status"), ts(rs.getTimestamp("locked_at"))), employeeId);
    }

    @Transactional
    public byte[] generateMyPayslipPdf(UUID tenantId, UUID employeeId, UUID runId) {
        bindTenant(tenantId);
        String status = jdbc.query("SELECT status FROM payroll.runs WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, runId);
        if (!"LOCKED".equals(status)) {
            throw new BusinessRuleException("Payslip is available only after the run is locked", "RUN_NOT_LOCKED");
        }
        Integer mine = jdbc.queryForObject(
            "SELECT count(*) FROM payroll.payslip_lines WHERE run_id = ? AND employee_id = ?",
            Integer.class, runId, employeeId);
        if (mine == null || mine == 0) throw new BusinessRuleException("No payslip for this period", "PAYSLIP_NOT_FOUND");
        return pdfRenderer.render(renderPayslipHtml(buildPayslip(runId, employeeId)));
    }

    // ── Per-employee computation ─────────────────────────────────────────────────

    private void processEmployee(UUID tenantId, UUID runId, UUID companyId, UUID employeeId,
                                 YearMonth ym, Map<String, CompMeta> components, Map<String, Object> settings) {
        // Structure (current) + employee dates.
        Map<String, Object> emp = jdbc.queryForMap("""
            SELECT date_of_joining, last_working_day FROM hrms.employees WHERE id = ?
            """, employeeId);
        Map<String, Object> structure;
        try {
            structure = jdbc.queryForMap("""
                SELECT id, ctc_monthly, pf_applicable, pf_status, esi_applicable, pt_state
                  FROM payroll.employee_salary_structures
                 WHERE employee_id = ? AND is_current IS TRUE
                """, employeeId);
        } catch (org.springframework.dao.EmptyResultDataAccessException ex) {
            log.warn("Skipping {} in run {} — no current salary structure", employeeId, runId);
            return;
        }
        UUID structureId = (UUID) structure.get("id");

        // Earning lines (fall back to a single BASIC = ctc_monthly when none defined).
        List<EarningLine> earnings = new ArrayList<>();
        List<Map<String, Object>> lineRows = jdbc.queryForList("""
            SELECT c.code, c.name, c.category, c.is_statutory, c.display_order, esc.monthly_amount
              FROM payroll.employee_structure_components esc
              JOIN payroll.salary_components c ON c.id = esc.component_id
             WHERE esc.structure_id = ?
             ORDER BY c.display_order
            """, structureId);
        if (lineRows.isEmpty()) {
            CompMeta basic = components.get("BASIC");
            if (basic == null) throw new BusinessRuleException("BASIC component missing; seed defaults", "COMPONENT_NOT_FOUND");
            earnings.add(new EarningLine(
                new ComponentDef("BASIC", basic.name(), "EARNING", false, basic.displayOrder()),
                (BigDecimal) structure.get("ctc_monthly")));
        } else {
            for (Map<String, Object> r : lineRows) {
                String cat = (String) r.get("category");
                // Only earning-style components carry an amount into the engine.
                if (!"EARNING".equals(cat) && !"REIMBURSEMENT".equals(cat)) continue;
                earnings.add(new EarningLine(
                    new ComponentDef((String) r.get("code"), (String) r.get("name"), cat,
                        Boolean.TRUE.equals(r.get("is_statutory")), ((Number) r.get("display_order")).intValue()),
                    (BigDecimal) r.get("monthly_amount")));
            }
        }

        // Day statuses → LOP.
        LocalDate joinDate = toLocalDate(emp.get("date_of_joining"));
        LocalDate exitDate = toLocalDate(emp.get("last_working_day"));
        List<DayStatus> days = buildDayStatuses(employeeId, companyId, ym);
        boolean sandwich = Boolean.TRUE.equals(settings.get("sandwich_rule_enabled"));
        Integer lateThreshold = (Integer) settings.get("late_mark_lop_threshold");
        LopResult lop = LopCalculator.calculate(new LopInput(
            days, sandwich, lateThreshold == null ? 0 : lateThreshold, 0, joinDate, exitDate, ym));

        // Statutory config.
        BigDecimal fullGross = earnings.stream()
            .filter(e -> "EARNING".equals(e.component().category()) || "REIMBURSEMENT".equals(e.component().category()))
            .map(EarningLine::monthlyAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        boolean ptEnabled = Boolean.TRUE.equals(settings.get("pt_enabled"));
        String ptState = structure.get("pt_state") != null
            ? (String) structure.get("pt_state") : (String) settings.get("pt_state_code");
        BigDecimal ptAmount = ptEnabled ? resolvePtAmount(ptState, fullGross) : null;

        StatutoryConfig statutory = new StatutoryConfig(
            Boolean.TRUE.equals(settings.get("pf_enabled")),
            (BigDecimal) settings.get("pf_employee_percent"), (BigDecimal) settings.get("pf_employer_percent"),
            (BigDecimal) settings.get("pf_wage_ceiling"), Boolean.TRUE.equals(settings.get("pf_apply_ceiling")),
            Boolean.TRUE.equals(settings.get("esi_enabled")),
            (BigDecimal) settings.get("esi_employee_percent"), (BigDecimal) settings.get("esi_employer_percent"),
            (BigDecimal) settings.get("esi_wage_ceiling"),
            ptEnabled, ptAmount);

        EmployeeStructureCfg empCfg = new EmployeeStructureCfg(
            (String) structure.get("pf_status"),
            Boolean.TRUE.equals(structure.get("pf_applicable")),
            Boolean.TRUE.equals(structure.get("esi_applicable")));

        PayrollResult result = PayrollEngine.compute(
            new PayrollEngineInput(earnings, lop, statutory, empCfg, ym));

        // Persist payslip lines (catalog is authoritative for id/name/category/order).
        for (PayrollEngine.PayslipLine line : result.lines()) {
            CompMeta meta = components.get(line.componentCode());
            if (meta == null) {
                throw new BusinessRuleException("Salary component " + line.componentCode()
                    + " not found; seed default components", "COMPONENT_NOT_FOUND");
            }
            jdbc.update("""
                INSERT INTO payroll.payslip_lines
                    (tenant_id, run_id, employee_id, component_id, component_code, component_name,
                     category, amount, display_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (run_id, employee_id, component_id)
                DO UPDATE SET amount = EXCLUDED.amount, component_name = EXCLUDED.component_name,
                              category = EXCLUDED.category, display_order = EXCLUDED.display_order
                """, tenantId, runId, employeeId, meta.id(), meta.code(), meta.name(),
                meta.category(), line.amount(), meta.displayOrder());
        }

        // Persist the LOP outcome + computation log.
        jdbc.update("""
            INSERT INTO payroll.run_lop_days
                (tenant_id, run_id, employee_id, paid_days, lop_days, total_calendar, computation_log)
            VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)
            ON CONFLICT (run_id, employee_id)
            DO UPDATE SET paid_days = EXCLUDED.paid_days, lop_days = EXCLUDED.lop_days,
                          total_calendar = EXCLUDED.total_calendar, computation_log = EXCLUDED.computation_log
            """, tenantId, runId, employeeId, lop.paidDays(), lop.lopDays(), lop.totalCalendar(),
            computationLogJson(lop, result));
    }

    // ── Day-status builder (exception-based) ─────────────────────────────────────

    private List<DayStatus> buildDayStatuses(UUID employeeId, UUID companyId, YearMonth ym) {
        LocalDate start = ym.atDay(1);
        LocalDate end = ym.atEndOfMonth();
        int total = ym.lengthOfMonth();

        Map<LocalDate, DayStatus> attendance = new HashMap<>();
        jdbc.query("""
            SELECT attendance_date, attendance_status::text AS st
              FROM attendance.records
             WHERE employee_id = ? AND attendance_date BETWEEN ? AND ?
            """, rs -> {
                LocalDate d = rs.getObject("attendance_date", LocalDate.class);
                DayStatus s = mapAttendance(rs.getString("st"));
                if (s != null) attendance.put(d, s);
            }, employeeId, start, end);

        Map<LocalDate, DayStatus> leave = new HashMap<>();
        jdbc.query("""
            SELECT lr.start_date, lr.end_date, lr.half_day, lt.is_paid_leave
              FROM leave_mgmt.leave_requests lr
              JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id
             WHERE lr.employee_id = ? AND lr.status::text = 'APPROVED'
               AND lr.start_date <= ? AND lr.end_date >= ?
            """, rs -> {
                LocalDate s = rs.getObject("start_date", LocalDate.class);
                LocalDate e = rs.getObject("end_date", LocalDate.class);
                boolean half = rs.getBoolean("half_day");
                boolean paid = rs.getBoolean("is_paid_leave");
                DayStatus st = half ? DayStatus.HALF_DAY_LEAVE : (paid ? DayStatus.PAID_LEAVE : DayStatus.LOP_LEAVE);
                LocalDate d = s.isBefore(start) ? start : s;
                LocalDate last = e.isAfter(end) ? end : e;
                while (!d.isAfter(last)) { leave.put(d, st); d = d.plusDays(1); }
            }, employeeId, end, start);

        Set<LocalDate> holidays = new HashSet<>();
        jdbc.query("""
            SELECT holiday_date FROM settings.holiday_calendar
             WHERE company_id = ? AND is_active = TRUE AND holiday_date BETWEEN ? AND ?
            """, rs -> { holidays.add(rs.getObject("holiday_date", LocalDate.class)); }, companyId, start, end);

        List<DayStatus> days = new ArrayList<>(total);
        for (int i = 0; i < total; i++) {
            LocalDate d = start.plusDays(i);
            DayStatus s = leave.get(d);
            if (s == null) s = attendance.get(d);
            if (s == null && holidays.contains(d)) s = DayStatus.HOLIDAY;
            if (s == null && isWeekend(d)) s = DayStatus.WEEKEND;
            if (s == null) s = DayStatus.PRESENT;   // exception-based default: assume present
            days.add(s);
        }
        return days;
    }

    private static DayStatus mapAttendance(String status) {
        if (status == null) return null;
        return switch (status) {
            case "PRESENT", "LATE", "PENDING_REGULARIZATION" -> DayStatus.PRESENT;
            case "ABSENT"   -> DayStatus.UNAUTHORIZED_ABSENT;
            case "HALF_DAY" -> DayStatus.HALF_DAY_LEAVE;
            case "HOLIDAY"  -> DayStatus.HOLIDAY;
            // ON_LEAVE → let the leave query decide; WEEKEND → let weekend logic decide.
            default -> null;
        };
    }

    private static boolean isWeekend(LocalDate d) {
        return d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private record RunRow(UUID id, UUID companyId, int periodMonth, int periodYear,
                          LocalDate periodStart, LocalDate periodEnd, String status) {}

    private record CompMeta(UUID id, String code, String name, String category, int displayOrder) {}

    private RunRow loadRun(UUID runId) {
        Map<String, Object> r;
        try {
            r = jdbc.queryForMap("""
                SELECT id, company_id, period_month, period_year, period_start, period_end, status
                  FROM payroll.runs WHERE id = ?
                """, runId);
        } catch (org.springframework.dao.EmptyResultDataAccessException ex) {
            throw new BusinessRuleException("Payroll run not found", "RUN_NOT_FOUND");
        }
        return new RunRow((UUID) r.get("id"), (UUID) r.get("company_id"),
            ((Number) r.get("period_month")).intValue(), ((Number) r.get("period_year")).intValue(),
            toLocalDate(r.get("period_start")), toLocalDate(r.get("period_end")), (String) r.get("status"));
    }

    private List<EligibleEmployeeDto> queryEligible(UUID companyId, LocalDate periodStart, LocalDate periodEnd) {
        return jdbc.query("""
            SELECT e.id, e.employee_code,
                   coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'') AS name,
                   s.ctc_monthly
              FROM hrms.employees e
              JOIN payroll.employee_salary_structures s
                    ON s.employee_id = e.id AND s.is_current IS TRUE
             WHERE e.company_id = ?
               AND e.is_active = TRUE
               AND e.employment_status::text NOT IN ('EXITED','TERMINATED')
               -- A missing join date is treated as "joined before this period" so
               -- active employees with a current structure are never silently dropped.
               AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
               AND (e.last_working_day IS NULL OR e.last_working_day >= ?)
             ORDER BY e.employee_code
            """, (rs, i) -> new EligibleEmployeeDto(
                rs.getObject("id", UUID.class), rs.getString("employee_code"),
                rs.getString("name").trim(), rs.getBigDecimal("ctc_monthly")),
            companyId, periodEnd, periodStart);
    }

    /** Count of base-eligible employees lacking a current structure (FIX P1-4). */
    private int countSkipped(UUID companyId, LocalDate periodStart, LocalDate periodEnd) {
        Integer n = jdbc.queryForObject("""
            SELECT count(*)
              FROM hrms.employees e
             WHERE e.company_id = ?
               AND e.is_active = TRUE
               AND e.employment_status::text NOT IN ('EXITED','TERMINATED')
               AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
               AND (e.last_working_day IS NULL OR e.last_working_day >= ?)
               AND NOT EXISTS (SELECT 1 FROM payroll.employee_salary_structures s
                                WHERE s.employee_id = e.id AND s.is_current IS TRUE)
            """, Integer.class, companyId, periodEnd, periodStart);
        return n == null ? 0 : n;
    }

    private Map<String, CompMeta> loadComponentsMeta() {
        Map<String, CompMeta> map = new HashMap<>();
        jdbc.query("SELECT id, code, name, category, display_order FROM payroll.salary_components", rs -> {
            map.put(rs.getString("code"), new CompMeta(
                rs.getObject("id", UUID.class), rs.getString("code"), rs.getString("name"),
                rs.getString("category"), rs.getInt("display_order")));
        });
        return map;
    }

    private Map<String, Object> loadSettings(UUID tenantId) {
        jdbc.update("INSERT INTO payroll.settings (tenant_id) VALUES (?) ON CONFLICT (tenant_id) DO NOTHING", tenantId);
        return jdbc.queryForMap("SELECT * FROM payroll.settings WHERE tenant_id = ?", tenantId);
    }

    private BigDecimal resolvePtAmount(String stateCode, BigDecimal gross) {
        if (stateCode == null) return null;
        return jdbc.query("""
            SELECT monthly_tax FROM payroll.pt_slabs
             WHERE state_code = ? AND min_salary <= ? AND (max_salary IS NULL OR max_salary >= ?)
             ORDER BY min_salary DESC LIMIT 1
            """, rs -> rs.next() ? rs.getBigDecimal(1) : null, stateCode, gross, gross);
    }

    private PayslipDto buildPayslip(UUID runId, UUID employeeId) {
        Map<String, Object> run;
        try {
            run = jdbc.queryForMap("SELECT period_month, period_year FROM payroll.runs WHERE id = ?", runId);
        } catch (org.springframework.dao.EmptyResultDataAccessException ex) {
            throw new BusinessRuleException("Payroll run not found", "RUN_NOT_FOUND");
        }
        Map<String, Object> emp;
        try {
            emp = jdbc.queryForMap("""
                SELECT e.employee_code, coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'') AS name,
                       e.pan_number, e.bank_account_number, d.title AS designation
                  FROM hrms.employees e
                  LEFT JOIN hrms.designations d ON d.id = e.designation_id
                 WHERE e.id = ?
                """, employeeId);
        } catch (org.springframework.dao.EmptyResultDataAccessException ex) {
            throw new BusinessRuleException("Employee not found", "EMPLOYEE_NOT_FOUND");
        }

        List<PayslipLineDto> earnings = new ArrayList<>();
        List<PayslipLineDto> deductions = new ArrayList<>();
        List<PayslipLineDto> employer = new ArrayList<>();
        jdbc.query("""
            SELECT component_code, component_name, category, amount
              FROM payroll.payslip_lines WHERE run_id = ? AND employee_id = ?
             ORDER BY display_order
            """, rs -> {
                PayslipLineDto l = new PayslipLineDto(
                    rs.getString("component_code"), rs.getString("component_name"), rs.getBigDecimal("amount"));
                switch (rs.getString("category")) {
                    case "DEDUCTION" -> deductions.add(l);
                    case "EMPLOYER_CONTRIBUTION" -> employer.add(l);
                    default -> earnings.add(l);
                }
            }, runId, employeeId);

        BigDecimal gross = earnings.stream().map(PayslipLineDto::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalDed = deductions.stream().map(PayslipLineDto::amount).reduce(BigDecimal.ZERO, BigDecimal::add);

        Map<String, Object> lopRow = jdbc.query("""
            SELECT paid_days, lop_days FROM payroll.run_lop_days WHERE run_id = ? AND employee_id = ?
            """, rs -> {
                if (!rs.next()) return Map.of();
                return Map.<String, Object>of("paid", rs.getBigDecimal("paid_days"), "lop", rs.getBigDecimal("lop_days"));
            }, runId, employeeId);

        return new PayslipDto(runId, employeeId, ((String) emp.get("name")).trim(),
            (String) emp.get("employee_code"), (String) emp.get("designation"),
            periodLabel(((Number) run.get("period_month")).intValue(), ((Number) run.get("period_year")).intValue()),
            maskPan((String) emp.get("pan_number")), maskBank((String) emp.get("bank_account_number")),
            lopRow.isEmpty() ? null : (BigDecimal) lopRow.get("paid"),
            lopRow.isEmpty() ? null : (BigDecimal) lopRow.get("lop"),
            earnings, deductions, employer, gross, totalDed, gross.subtract(totalDed));
    }

    private String computationLogJson(LopResult lop, PayrollResult result) {
        try {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("paidDays", lop.paidDays());
            m.put("lopDays", lop.lopDays());
            m.put("totalCalendar", lop.totalCalendar());
            m.put("warnings", result.warnings());
            List<Map<String, Object>> days = new ArrayList<>();
            for (LopCalculator.DayBreakdown b : lop.log()) {
                days.add(Map.of("day", b.dayOfMonth(), "status", b.status().name(), "resolution", b.resolution()));
            }
            m.put("days", days);
            return objectMapper.writeValueAsString(m);
        } catch (Exception e) {
            return "{}";
        }
    }

    private RunDto toRunDto(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new RunDto(
            rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class), rs.getString("company_name"),
            rs.getInt("period_month"), rs.getInt("period_year"),
            String.valueOf(rs.getObject("period_start")), String.valueOf(rs.getObject("period_end")),
            rs.getString("status"), rs.getInt("employee_count"),
            rs.getBigDecimal("total_gross"), rs.getBigDecimal("total_deductions"), rs.getBigDecimal("total_net"),
            ts(rs.getTimestamp("processed_at")), ts(rs.getTimestamp("locked_at")), ts(rs.getTimestamp("created_at")),
            rs.getInt("skipped_employee_count"));
    }

    private static String renderPayslipHtml(PayslipDto s) {
        StringBuilder b = new StringBuilder();
        b.append("<!DOCTYPE html><html><head><meta charset='UTF-8'/><style>")
         .append("body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:11pt;margin:32pt;}")
         .append("h1{font-size:18pt;margin:0 0 2pt;color:#0F6E56;} .sub{color:#555;font-size:10pt;margin:0 0 16pt;}")
         .append("table{width:100%;border-collapse:collapse;margin-top:10pt;} th,td{text-align:left;padding:5pt 8pt;}")
         .append("th{background:#f1f5f4;font-size:9pt;text-transform:uppercase;letter-spacing:.04em;color:#475569;}")
         .append(".amt{text-align:right;} .tot{font-weight:bold;border-top:1.5pt solid #0F6E56;}")
         .append(".net{font-size:14pt;font-weight:bold;color:#0F6E56;} .meta td{padding:2pt 8pt;font-size:10pt;}")
         .append("</style></head><body>");
        b.append("<h1>Payslip</h1><p class='sub'>").append(esc(s.period())).append("</p>");
        b.append("<table class='meta'>")
         .append(row2("Employee", esc(s.employeeName()), "Code", esc(s.employeeCode())))
         .append(row2("Designation", esc(nz(s.designation())), "PAN", esc(s.panMasked())))
         .append(row2("Paid days", s.paidDays() == null ? "—" : s.paidDays().toPlainString(),
                       "LOP days", s.lopDays() == null ? "—" : s.lopDays().toPlainString()))
         .append(row2("Bank A/C", esc(s.bankMasked()), "", ""))
         .append("</table>");

        b.append("<table><tr><th>Earnings</th><th class='amt'>Amount (₹)</th></tr>");
        for (PayslipLineDto l : s.earnings()) b.append(lineRow(l));
        b.append("<tr class='tot'><td>Gross earnings</td><td class='amt'>").append(money(s.gross())).append("</td></tr></table>");

        b.append("<table><tr><th>Deductions</th><th class='amt'>Amount (₹)</th></tr>");
        if (s.deductions().isEmpty()) b.append("<tr><td>None</td><td class='amt'>0.00</td></tr>");
        for (PayslipLineDto l : s.deductions()) b.append(lineRow(l));
        b.append("<tr class='tot'><td>Total deductions</td><td class='amt'>").append(money(s.totalDeductions())).append("</td></tr></table>");

        b.append("<table><tr><td class='net'>Net pay</td><td class='amt net'>₹ ").append(money(s.netPay())).append("</td></tr></table>");

        if (!s.employerContributions().isEmpty()) {
            b.append("<table><tr><th>Employer contributions (not deducted)</th><th class='amt'>Amount (₹)</th></tr>");
            for (PayslipLineDto l : s.employerContributions()) b.append(lineRow(l));
            b.append("</table>");
        }
        b.append("<p class='sub' style='margin-top:18pt'>This is a system-generated payslip.</p>");
        b.append("</body></html>");
        return b.toString();
    }

    private static String lineRow(PayslipLineDto l) {
        return "<tr><td>" + esc(l.name()) + "</td><td class='amt'>" + money(l.amount()) + "</td></tr>";
    }

    private static String row2(String k1, String v1, String k2, String v2) {
        return "<tr><td><b>" + esc(k1) + "</b></td><td>" + v1 + "</td><td><b>" + esc(k2) + "</b></td><td>" + v2 + "</td></tr>";
    }

    private static String money(BigDecimal v) {
        return v == null ? "0.00" : v.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString();
    }

    private static String maskPan(String pan) {
        if (pan == null || pan.isBlank()) return "—";
        return pan.length() <= 4 ? "XXXX" : "XXXXXX" + pan.substring(pan.length() - 4);
    }

    private static String maskBank(String acct) {
        if (acct == null || acct.isBlank()) return "—";
        return acct.length() <= 4 ? "XXXX" : "XXXX" + acct.substring(acct.length() - 4);
    }

    private static String periodLabel(int month, int year) {
        return java.time.Month.of(month).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + year;
    }

    private static String nz(String s) { return s == null ? "—" : s; }
    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String ts(java.sql.Timestamp t) { return t == null ? null : t.toInstant().toString(); }

    private static LocalDate toLocalDate(Object o) {
        if (o == null) return null;
        if (o instanceof LocalDate d) return d;
        if (o instanceof java.sql.Date d) return d.toLocalDate();
        return LocalDate.parse(o.toString());
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
