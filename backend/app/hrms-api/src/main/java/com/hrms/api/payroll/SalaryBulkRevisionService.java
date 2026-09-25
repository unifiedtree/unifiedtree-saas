package com.hrms.api.payroll;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.payroll.SalaryRevisionPlanner.Candidate;
import com.hrms.api.payroll.SalaryRevisionPlanner.Line;
import com.hrms.api.payroll.SalaryRevisionPlanner.Mode;
import com.hrms.api.payroll.SalaryRevisionPlanner.Plan;
import com.hrms.api.payroll.SalaryRevisionPlanner.PlannedRow;
import com.hrms.api.payroll.SalaryRevisionPlanner.RunInfo;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.notifications.events.SalaryStructureRevisedEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Bulk CTC revision (Salary Structure → "Bulk revise CTC").
 *
 * <p>Preview and apply run the same selection and the same plan
 * ({@link SalaryRevisionPlanner}); apply refuses unless the plan still matches
 * the preview the person saw ({@code previewKey}), and writes everything in one
 * transaction: a {@code payroll.salary_revision_batches} row, then for each
 * person the current structure is closed the day before the effective date and
 * a new current structure (same PF / ESI / PT / tax settings, scaled lines) is
 * inserted. Each employee is notified after the commit.
 *
 * <p>Raw RLS-scoped JdbcTemplate, like {@link PayrollService}. Payroll run
 * calculation is not touched.
 */
@Service
public class SalaryBulkRevisionService {

    private static final Logger log = LoggerFactory.getLogger(SalaryBulkRevisionService.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;
    private final ObjectMapper json = new ObjectMapper();

    public SalaryBulkRevisionService(JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public record BulkReviseRequest(
            UUID companyId, UUID departmentId, UUID designationId, String grade, List<UUID> employeeIds,
            String mode, BigDecimal value, String effectiveFrom, String reason, String previewKey) {}

    public record RowDto(UUID employeeId, String employeeCode, String name, String company, String department,
                         String designation, String grade, String currentEffectiveFrom,
                         BigDecimal oldCtc, BigDecimal newCtc, BigDecimal difference,
                         BigDecimal oldMonthlyGross, BigDecimal newMonthlyGross, boolean derivedFromCtc) {}

    public record SkippedDto(UUID employeeId, String employeeCode, String name, String reason, String detail) {}

    public record PreviewDto(List<RowDto> rows, List<SkippedDto> skipped, int employees,
                             BigDecimal totalOldCtc, BigDecimal totalNewCtc, BigDecimal totalDifference,
                             String effectiveFrom, String change, List<String> blockers, String previewKey) {}

    public record AppliedDto(UUID employeeId, String employeeCode, String name, UUID structureId,
                             BigDecimal oldCtc, BigDecimal newCtc) {}

    public record ApplyResultDto(UUID batchId, int applied, String effectiveFrom, String change,
                                 BigDecimal totalOldCtc, BigDecimal totalNewCtc, List<AppliedDto> structures,
                                 List<SkippedDto> skipped) {}

    public record OptionDto(String id, String label, int people) {}

    public record PersonDto(UUID id, String employeeCode, String name, String department, BigDecimal ctcAnnual) {}

    /** What "Who" can be: only people who have a salary structure are counted and listed. */
    public record OptionsDto(List<OptionDto> companies, List<OptionDto> departments, List<OptionDto> designations,
                             List<OptionDto> grades, List<PersonDto> people, int withoutStructure) {}

    // ── Options ─────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public OptionsDto options(UUID tenantId) {
        bindTenant(tenantId);
        List<Candidate> all = loadCandidates(tenantId, new BulkReviseRequest(null, null, null, null, null, null, null, null, null, null), false);
        List<Candidate> withStructure = all.stream().filter(c -> c.structureId() != null).toList();
        Map<String, String[]> companies = new HashMap<>(), departments = new HashMap<>(), designations = new HashMap<>(), grades = new HashMap<>();
        Map<String, Integer> counts = new HashMap<>();
        for (Candidate c : withStructure) {
            add(companies, counts, "co:", c.companyId(), c.companyName());
            add(departments, counts, "dept:", c.departmentId(), c.department());
            add(designations, counts, "desig:", c.designationId(), c.designation());
            if (c.grade() != null && !c.grade().isBlank()) {
                String g = c.grade().trim();
                grades.putIfAbsent("grade:" + g, new String[]{g, g});
                counts.merge("grade:" + g, 1, Integer::sum);
            }
        }
        List<PersonDto> people = withStructure.stream()
                .map(c -> new PersonDto(c.employeeId(), c.employeeCode(), c.name(), c.department(), c.ctcAnnual()))
                .toList();
        return new OptionsDto(opts(companies, counts), opts(departments, counts), opts(designations, counts), opts(grades, counts),
                people, all.size() - withStructure.size());
    }

    private static void add(Map<String, String[]> into, Map<String, Integer> counts, String prefix, UUID id, String label) {
        if (id == null) return;
        String key = prefix + id;
        into.putIfAbsent(key, new String[]{id.toString(), label == null || label.isBlank() ? "Unnamed" : label});
        counts.merge(key, 1, Integer::sum);
    }

    private static List<OptionDto> opts(Map<String, String[]> m, Map<String, Integer> counts) {
        return m.entrySet().stream()
                .map(e -> new OptionDto(e.getValue()[0], e.getValue()[1], counts.getOrDefault(e.getKey(), 0)))
                .sorted(Comparator.comparing(OptionDto::label, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    // ── Preview / apply ─────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public PreviewDto preview(UUID tenantId, BulkReviseRequest req) {
        bindTenant(tenantId);
        Prepared p = prepare(tenantId, req, false);
        return toPreview(p);
    }

    @Transactional
    public ApplyResultDto apply(UUID tenantId, BulkReviseRequest req, UUID actorUserId, UUID actorEmployeeId) {
        bindTenant(tenantId);
        if (req.previewKey() == null || req.previewKey().isBlank()) {
            throw new BusinessRuleException("Preview the revision before applying it.", "REVISION_PREVIEW_REQUIRED");
        }
        Prepared p = prepare(tenantId, req, true);
        if (p.plan.rows().isEmpty()) {
            throw new BusinessRuleException("No one in this selection can be revised.", "REVISION_NOBODY");
        }
        if (!p.blockers.isEmpty()) {
            throw new BusinessRuleException(p.blockers.get(0), "REVISION_BLOCKED_BY_PAYROLL");
        }
        if (!p.plan.previewKey().equals(req.previewKey().trim())) {
            throw new BusinessRuleException("Salary structures changed since your preview. Review the new preview and apply again.",
                    "REVISION_PREVIEW_OUT_OF_DATE");
        }

        String note = "Bulk revision " + SalaryRevisionPlanner.describe(p.mode, req.value()) + ": " + req.reason().trim();
        UUID batchId = jdbc.queryForObject("""
                INSERT INTO payroll.salary_revision_batches
                    (tenant_id, mode, value, effective_from, reason, filters, employee_count,
                     total_old_ctc, total_new_ctc, applied_by_user_id, applied_by_employee_id)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?)
                RETURNING id
                """, UUID.class,
                tenantId, p.mode.name(), req.value(), Date.valueOf(p.effectiveFrom), req.reason().trim(), filtersJson(req),
                p.plan.rows().size(), p.plan.totalOldCtc(), p.plan.totalNewCtc(), actorUserId, actorEmployeeId);

        Date closeOn = Date.valueOf(p.effectiveFrom.minusDays(1));
        List<AppliedDto> applied = new ArrayList<>();
        for (PlannedRow r : p.plan.rows()) {
            Candidate c = r.candidate();
            int closed = jdbc.update("""
                    UPDATE payroll.employee_salary_structures
                       SET is_current = NULL, effective_to = ?, updated_at = now()
                     WHERE id = ? AND employee_id = ? AND is_current IS TRUE
                    """, closeOn, c.structureId(), c.employeeId());
            if (closed != 1) {
                // Someone saved this person's structure between the check and now.
                throw new BusinessRuleException("Salary structures changed since your preview. Review the new preview and apply again.",
                        "REVISION_PREVIEW_OUT_OF_DATE");
            }
            UUID newId = jdbc.queryForObject("""
                    INSERT INTO payroll.employee_salary_structures
                        (tenant_id, employee_id, ctc_annual, ctc_monthly, pf_applicable, pf_status, esi_applicable,
                         pt_state, tax_regime, revision_note, effective_from, is_current, revision_batch_id)
                    SELECT tenant_id, employee_id, ?, ?, pf_applicable, pf_status, esi_applicable,
                           pt_state, tax_regime, ?, ?, TRUE, ?
                      FROM payroll.employee_salary_structures
                     WHERE id = ?
                    RETURNING id
                    """, UUID.class,
                    r.newCtc(), r.newCtcMonthly(), note, Date.valueOf(p.effectiveFrom), batchId, c.structureId());
            for (Line l : r.newLines()) {
                jdbc.update("""
                        INSERT INTO payroll.employee_structure_components (structure_id, component_id, monthly_amount)
                        VALUES (?, ?, ?)
                        ON CONFLICT (structure_id, component_id) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount
                        """, newId, l.componentId(), l.monthlyAmount());
            }
            applied.add(new AppliedDto(c.employeeId(), c.employeeCode(), c.name(), newId, r.oldCtc(), r.newCtc()));
            events.publishEvent(new SalaryStructureRevisedEvent(tenantId, c.employeeId(), newId, p.effectiveFrom));
        }
        log.info("Bulk salary revision batch={} tenant={} people={} {} from {}", batchId, tenantId, applied.size(),
                SalaryRevisionPlanner.describe(p.mode, req.value()), p.effectiveFrom);
        return new ApplyResultDto(batchId, applied.size(), p.effectiveFrom.toString(), SalaryRevisionPlanner.describe(p.mode, req.value()),
                p.plan.totalOldCtc(), p.plan.totalNewCtc(), applied, toPreview(p).skipped());
    }

    // ── internals ───────────────────────────────────────────────────────────

    private record Prepared(Mode mode, BigDecimal value, LocalDate effectiveFrom, Plan plan, List<String> blockers) {}

    private Prepared prepare(UUID tenantId, BulkReviseRequest req, boolean applying) {
        Mode mode = SalaryRevisionPlanner.mode(req.mode());
        int explicit = req.employeeIds() == null ? 0 : req.employeeIds().size();
        LocalDate eff = SalaryRevisionPlanner.validate(mode, req.value(), req.effectiveFrom(), req.reason(), explicit,
                LocalDate.now(IST), applying);
        List<Candidate> candidates = loadCandidates(tenantId, req, true);
        if (candidates.isEmpty()) {
            throw new BusinessRuleException("No active employees match this selection.", "REVISION_NOBODY");
        }
        Plan plan = SalaryRevisionPlanner.plan(candidates, mode, req.value(), eff);
        Set<UUID> companies = plan.rows().stream().map(r -> r.candidate().companyId()).filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        List<String> blockers = SalaryRevisionPlanner.runBlockers(loadRuns(companies), eff);
        return new Prepared(mode, req.value(), eff, plan, blockers);
    }

    private PreviewDto toPreview(Prepared p) {
        List<RowDto> rows = p.plan.rows().stream().map(r -> {
            Candidate c = r.candidate();
            return new RowDto(c.employeeId(), c.employeeCode(), c.name(), c.companyName(), c.department(), c.designation(),
                    c.grade(), c.currentEffectiveFrom() == null ? null : c.currentEffectiveFrom().toString(),
                    r.oldCtc(), r.newCtc(), r.difference(), r.oldGross(), r.newGross(), r.derivedFromCtc());
        }).toList();
        List<SkippedDto> skipped = p.plan.skipped().stream()
                .map(s -> new SkippedDto(s.employeeId(), s.employeeCode(), s.name(), s.reason(), s.detail())).toList();
        return new PreviewDto(rows, skipped, rows.size(), p.plan.totalOldCtc(), p.plan.totalNewCtc(), p.plan.totalDifference(),
                p.effectiveFrom.toString(), SalaryRevisionPlanner.describe(p.mode, p.value),
                p.blockers, p.plan.previewKey());
    }

    /** Active employees matching the selection, with their current structure (if any) and its configured lines. */
    List<Candidate> loadCandidates(UUID tenantId, BulkReviseRequest req, boolean withLines) {
        StringBuilder sql = new StringBuilder("""
                SELECT e.id, e.employee_code, trim(concat_ws(' ', e.first_name, e.last_name)) AS name,
                       e.company_id, c.name AS company_name, e.department_id, d.name AS department_name,
                       e.designation_id, g.title AS designation, NULLIF(trim(g.grade), '') AS grade,
                       s.id AS structure_id, s.ctc_annual, s.ctc_monthly, s.effective_from
                  FROM hrms.employees e
                  LEFT JOIN org.companies c ON c.id = e.company_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id
                  LEFT JOIN payroll.employee_salary_structures s ON s.employee_id = e.id AND s.is_current IS TRUE
                 WHERE e.tenant_id = ? AND e.is_active = TRUE
                   AND e.employment_status::text NOT IN ('EXITED','TERMINATED')
                """);
        List<Object> args = new ArrayList<>();
        args.add(tenantId);
        if (req.companyId() != null) { sql.append(" AND e.company_id = ?"); args.add(req.companyId()); }
        if (req.departmentId() != null) { sql.append(" AND e.department_id = ?"); args.add(req.departmentId()); }
        if (req.designationId() != null) { sql.append(" AND e.designation_id = ?"); args.add(req.designationId()); }
        if (req.grade() != null && !req.grade().isBlank()) { sql.append(" AND trim(g.grade) = ?"); args.add(req.grade().trim()); }
        if (req.employeeIds() != null && !req.employeeIds().isEmpty()) {
            sql.append(" AND e.id = ANY (CAST(? AS uuid[]))");
            args.add(uuidArray(req.employeeIds()));
        }
        sql.append(" ORDER BY e.employee_code");
        List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), args.toArray());

        Map<UUID, List<Line>> lines = new HashMap<>();
        List<UUID> structureIds = rows.stream().map(r -> (UUID) r.get("structure_id")).filter(Objects::nonNull).toList();
        if (withLines && !structureIds.isEmpty()) {
            jdbc.query("""
                    SELECT esc.structure_id, esc.component_id, esc.monthly_amount, c.code, c.name, c.category
                      FROM payroll.employee_structure_components esc
                      JOIN payroll.salary_components c ON c.id = esc.component_id
                     WHERE esc.structure_id = ANY (CAST(? AS uuid[]))
                     ORDER BY c.display_order, c.code
                    """, rs -> {
                lines.computeIfAbsent(rs.getObject("structure_id", UUID.class), k -> new ArrayList<>())
                        .add(new Line(rs.getObject("component_id", UUID.class), rs.getString("code"), rs.getString("name"),
                                rs.getString("category"), rs.getBigDecimal("monthly_amount")));
            }, uuidArray(structureIds));
        }
        List<Candidate> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            UUID sid = (UUID) r.get("structure_id");
            Object eff = r.get("effective_from");
            out.add(new Candidate((UUID) r.get("id"), (String) r.get("employee_code"), (String) r.get("name"),
                    (UUID) r.get("company_id"), (String) r.get("company_name"),
                    (UUID) r.get("department_id"), (String) r.get("department_name"),
                    (UUID) r.get("designation_id"), (String) r.get("designation"), (String) r.get("grade"), sid,
                    (BigDecimal) r.get("ctc_annual"), (BigDecimal) r.get("ctc_monthly"),
                    eff == null ? null : LocalDate.parse(eff.toString()),
                    sid == null ? List.of() : lines.getOrDefault(sid, List.of())));
        }
        return out;
    }

    private List<RunInfo> loadRuns(Collection<UUID> companyIds) {
        if (companyIds.isEmpty()) return List.of();
        return jdbc.query("""
                SELECT r.company_id, c.name AS company_name, r.period_year, r.period_month,
                       r.period_start, r.period_end, r.status
                  FROM payroll.runs r
                  LEFT JOIN org.companies c ON c.id = r.company_id
                 WHERE r.company_id = ANY (CAST(? AS uuid[]))
                   AND r.status IN ('DRAFT','PROCESSING','LOCKED','PAID')
                """, (rs, i) -> new RunInfo(rs.getObject("company_id", UUID.class), rs.getString("company_name"),
                rs.getInt("period_year"), rs.getInt("period_month"),
                rs.getDate("period_start").toLocalDate(), rs.getDate("period_end").toLocalDate(), rs.getString("status")),
                uuidArray(companyIds));
    }

    private String filtersJson(BulkReviseRequest req) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (req.companyId() != null) m.put("companyId", req.companyId().toString());
        if (req.departmentId() != null) m.put("departmentId", req.departmentId().toString());
        if (req.designationId() != null) m.put("designationId", req.designationId().toString());
        if (req.grade() != null && !req.grade().isBlank()) m.put("grade", req.grade().trim());
        if (req.employeeIds() != null && !req.employeeIds().isEmpty()) m.put("employeeIds", req.employeeIds().stream().map(UUID::toString).toList());
        try {
            return json.writeValueAsString(m);
        } catch (Exception ex) {
            return "{}";
        }
    }

    static String uuidArray(Collection<UUID> ids) {
        return ids.stream().filter(Objects::nonNull).map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
