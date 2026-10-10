package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.RotationTemplate;
import com.hrms.api.roster.RosterContract.TemplateBody;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.RecordOwner;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Saved rotation patterns ("A A B B C C WO", design §1.1 tables 1–2, endpoints 1–4): a cycle of 1 to
 * 62 days, each exactly one shift of the company or a weekly off. Company-wide patterns
 * ({@code department_id} null) are made by HR/Admin; a department head makes and changes only the
 * patterns of the departments they head, and sees the company-wide ones read-only. A deleted pattern
 * is switched off ({@code is_active = false}); rosters keep their own copy in {@code config.pattern}.
 */
@Service
public class RotationTemplateService {

    static final int NAME_MAX = 80;
    static final int MAX_DAYS = 62;

    private final JdbcTemplate jdbc;
    private final RosterTables tables;
    private final PlannerScope scope;
    private final ShiftCatalog shifts;

    @Autowired(required = false)
    private CompanyAccessService companyAccess;

    public RotationTemplateService(JdbcTemplate jdbc, RosterTables tables, PlannerScope scope, ShiftCatalog shifts) {
        this.jdbc = jdbc;
        this.tables = tables;
        this.scope = scope;
        this.shifts = shifts;
    }

    @Transactional(readOnly = true)
    public List<RotationTemplate> list(Jwt jwt, UUID companyId) {
        tables.require();
        Actor a = scope.actor(jwt, companyId);
        UUID tenant = TenantContext.requireTenantId();
        List<Head> heads = heads(tenant, a.companyId());
        List<Head> visible = heads.stream()
                .filter(h -> a.companyWide() || h.departmentId() == null || a.headedDepartmentIds().contains(h.departmentId()))
                .toList();
        Map<UUID, List<PatternDay>> days = days(tenant, visible.stream().map(Head::id).toList());
        boolean plan = RosterAuth.has(jwt, RosterAuth.PLAN);
        return visible.stream().map(h -> view(h, days.getOrDefault(h.id(), List.of()), plan && PlannerScopeService.covers(a, h.departmentId())))
                .toList();
    }

    @Transactional
    public RotationTemplate create(Jwt jwt, UUID companyId, TemplateBody body) {
        tables.require();
        Actor a = scope.actor(jwt, companyId);
        UUID tenant = TenantContext.requireTenantId();
        Valid v = validate(tenant, a, body);
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO attendance.rotation_templates (id, tenant_id, company_id, department_id, name, repeats, cycle_length,
                           created_by_user_id, created_by_name, updated_by_user_id, updated_by_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, id, tenant, a.companyId(), v.departmentId(), v.name(), body.repeats(), v.days().size(),
                    a.userId(), a.name(), a.userId(), a.name());
        } catch (DuplicateKeyException e) {
            throw RosterErrors.templateNameTaken();
        }
        insertDays(tenant, id, v.days());
        return find(jwt, a, tenant, id);
    }

    @Transactional
    public RotationTemplate replace(Jwt jwt, UUID id, TemplateBody body) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Head h = head(tenant, id);
        Actor a = editor(jwt, h);
        Valid v = validate(tenant, a, body);
        try {
            jdbc.update("""
                    UPDATE attendance.rotation_templates
                       SET name = ?, department_id = ?, repeats = ?, cycle_length = ?,
                           updated_by_user_id = ?, updated_by_name = ?, updated_at = now()
                     WHERE tenant_id = ? AND id = ? AND is_active = TRUE
                    """, v.name(), v.departmentId(), body.repeats(), v.days().size(), a.userId(), a.name(), tenant, id);
        } catch (DuplicateKeyException e) {
            throw RosterErrors.templateNameTaken();
        }
        jdbc.update("DELETE FROM attendance.rotation_template_days WHERE tenant_id = ? AND template_id = ?", tenant, id);
        insertDays(tenant, id, v.days());
        return find(jwt, a, tenant, id);
    }

    @Transactional
    public void delete(Jwt jwt, UUID id) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Head h = head(tenant, id);
        Actor a = editor(jwt, h);
        jdbc.update("""
                UPDATE attendance.rotation_templates
                   SET is_active = FALSE, updated_by_user_id = ?, updated_by_name = ?, updated_at = now()
                 WHERE tenant_id = ? AND id = ? AND is_active = TRUE
                """, a.userId(), a.name(), tenant, id);
    }

    // ── rules ─────────────────────────────────────────────────────────────────

    record Valid(String name, UUID departmentId, List<PatternDay> days) {}

    /** The pattern's shape: a name, a department the caller may plan, 1–62 days each one shift of the company or WO. */
    Valid validate(UUID tenant, Actor a, TemplateBody body) {
        if (body == null) throw RosterErrors.templateInvalid("Give the pattern a name and at least one day.");
        String name = body.name() == null ? "" : body.name().replaceAll("\\s+", " ").trim();
        if (name.isEmpty() || name.length() > NAME_MAX) {
            throw RosterErrors.templateInvalid("Give the pattern a name of 1 to " + NAME_MAX + " characters.");
        }
        UUID dept = body.departmentId();
        if (dept == null && !a.companyWide()) {
            throw RosterErrors.templateInvalid("Choose the department this pattern is for.");
        }
        if (dept != null) {
            if (!PlannerScopeService.covers(a, dept)) {
                throw RosterErrors.scope("Only HR can make patterns for departments you don't head.");
            }
            if (!departmentKnown(tenant, a.companyId(), dept)) throw RosterErrors.templateInvalid("That department isn't in this company.");
        }
        List<PatternDay> days = body.days() == null ? List.of() : body.days();
        if (days.isEmpty() || days.size() > MAX_DAYS) {
            throw RosterErrors.templateInvalid("A pattern has 1 to " + MAX_DAYS + " days.");
        }
        Map<UUID, ShiftCatalog.Shift> company = shifts.ofCompany(tenant, a.companyId());
        List<PatternDay> clean = new ArrayList<>(days.size());
        for (int i = 0; i < days.size(); i++) {
            PatternDay d = days.get(i);
            if (d == null || (d.shiftPolicyId() == null) != d.weeklyOff()) {
                throw RosterErrors.templateInvalid("Day " + (i + 1) + " needs exactly one shift or WO.");
            }
            if (d.shiftPolicyId() != null) {
                ShiftCatalog.Shift s = company.get(d.shiftPolicyId());
                if (s == null || !s.active()) {
                    throw RosterErrors.templateInvalid("Day " + (i + 1) + " uses a shift that isn't an active shift of this company.");
                }
            }
            clean.add(new PatternDay(d.shiftPolicyId(), d.weeklyOff()));
        }
        return new Valid(name, dept, clean);
    }

    /** The pattern's planner: in its company, and allowed to change it (403 ROSTER_SCOPE otherwise). */
    private Actor editor(Jwt jwt, Head h) {
        if (companyAccess != null) companyAccess.checkRecord("Rotation pattern", h.id(), () -> RecordOwner.ofCompany(h.companyId()));
        Actor a = scope.actor(jwt, h.companyId());
        if (!RosterAuth.has(jwt, RosterAuth.PLAN) || !PlannerScopeService.covers(a, h.departmentId())) {
            throw RosterErrors.scope(h.departmentId() == null
                    ? "Only HR can change company-wide patterns." : "Only HR can change patterns of departments you don't head.");
        }
        return a;
    }

    // ── reads ─────────────────────────────────────────────────────────────────

    record Head(UUID id, UUID companyId, UUID departmentId, String name, boolean repeats, String updatedByName, Instant updatedAt) {}

    private static final String SELECT = "SELECT id, company_id, department_id, name, repeats, updated_by_name, updated_at "
            + "FROM attendance.rotation_templates";

    private static final org.springframework.jdbc.core.RowMapper<Head> HEAD = (rs, n) -> {
        Timestamp t = rs.getTimestamp("updated_at");
        return new Head(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                rs.getObject("department_id", UUID.class), rs.getString("name"), rs.getBoolean("repeats"),
                rs.getString("updated_by_name"), t == null ? null : t.toInstant());
    };

    List<Head> heads(UUID tenant, UUID companyId) {
        return jdbc.query(SELECT + " WHERE tenant_id = ? AND company_id = ? AND is_active = TRUE ORDER BY lower(name)", HEAD, tenant, companyId);
    }

    boolean departmentKnown(UUID tenant, UUID companyId, UUID departmentId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM hrms.departments WHERE id = ? AND tenant_id = ? AND company_id = ?)",
                Boolean.class, departmentId, tenant, companyId));
    }

    Head head(UUID tenant, UUID id) {
        List<Head> rows = jdbc.query(SELECT + " WHERE tenant_id = ? AND id = ? AND is_active = TRUE", HEAD, tenant, id);
        if (rows.isEmpty()) throw new ResourceNotFoundException("That pattern wasn't found.");
        return rows.get(0);
    }

    private RotationTemplate find(Jwt jwt, Actor a, UUID tenant, UUID id) {
        Head h = head(tenant, id);
        boolean plan = RosterAuth.has(jwt, RosterAuth.PLAN);
        return view(h, days(tenant, List.of(id)).getOrDefault(id, List.of()), plan && PlannerScopeService.covers(a, h.departmentId()));
    }

    Map<UUID, List<PatternDay>> days(UUID tenant, List<UUID> ids) {
        Map<UUID, List<PatternDay>> out = new LinkedHashMap<>();
        if (ids.isEmpty()) return out;
        jdbc.query("SELECT template_id, shift_policy_id, weekly_off FROM attendance.rotation_template_days "
                        + "WHERE tenant_id = ? AND template_id = ANY(CAST(? AS uuid[])) ORDER BY template_id, day_no",
                (RowCallbackHandler) rs -> out.computeIfAbsent(rs.getObject("template_id", UUID.class), k -> new ArrayList<>())
                        .add(new PatternDay(rs.getObject("shift_policy_id", UUID.class), rs.getBoolean("weekly_off"))),
                tenant, PlannerScopeService.uuidArray(ids));
        return out;
    }

    void insertDays(UUID tenant, UUID templateId, List<PatternDay> days) {
        List<Object[]> rows = new ArrayList<>(days.size());
        for (int i = 0; i < days.size(); i++) {
            rows.add(new Object[]{tenant, templateId, i + 1, days.get(i).shiftPolicyId(), days.get(i).weeklyOff()});
        }
        jdbc.batchUpdate("INSERT INTO attendance.rotation_template_days (tenant_id, template_id, day_no, shift_policy_id, weekly_off) "
                + "VALUES (?, ?, ?, ?, ?)", rows);
    }

    private static RotationTemplate view(Head h, List<PatternDay> days, boolean editable) {
        return new RotationTemplate(h.id(), h.companyId(), h.departmentId(), h.name(), h.repeats(), days,
                h.updatedByName(), h.updatedAt(), editable);
    }
}
