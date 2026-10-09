package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDepartmentRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DepartmentResponse;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.core.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service("workforceDepartmentService")
@Transactional
public class DepartmentService {

    private final WorkforceDepartmentRepository repository;
    private final LiveHeadcount headcount;
    private final JdbcTemplate jdbc;

    public DepartmentService(WorkforceDepartmentRepository repository, LiveHeadcount headcount, JdbcTemplate jdbc) {
        this.repository = repository;
        this.headcount = headcount;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public List<DepartmentResponse> listForCompany(UUID companyId) {
        Map<UUID, Integer> counts = headcount.byColumn("department_id");
        Map<UUID, List<UUID>> branches = new HashMap<>();
        jdbc.query("""
                SELECT db.department_id, db.branch_id FROM hrms.department_branches db
                  JOIN hrms.departments d ON d.id = db.department_id
                 WHERE d.company_id = ?""",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> branches
                        .computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(rs.getObject(2, UUID.class)),
                companyId);
        Map<UUID, String> costCentres = costCentresOf(companyId);
        Map<UUID, String> heads = headNamesOf(companyId);
        return repository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId)
                .stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0), branches.getOrDefault(x.getId(), List.of()),
                        costCentres.get(x.getId()), x.getDepartmentHeadEmployeeId() == null ? null : heads.get(x.getDepartmentHeadEmployeeId()))).toList();
    }

    /**
     * Create a department, REVIVING a previously archived one of the same name
     * rather than rejecting it.
     *
     * <p>Why the revive branch exists: {@link #archive(UUID)} is a SOFT delete
     * (sets active=false, the row stays), and {@code listForCompany} filters on
     * activeTrue — so after archiving, the user sees the department gone. The
     * old duplicate check called {@code existsByCompanyIdAndNameIgnoreCase},
     * which has NO active filter, so it still saw the hidden row and threw
     * DUPLICATE_DEPARTMENT (HTTP 422). Net effect reported by the client on
     * 2026-08-30: "add a department, delete it, add the same one again -> 422",
     * with nothing on screen to explain why.
     *
     * <p>Simply adding {@code AndActiveTrue} to the check would be WORSE: the
     * unique index {@code uq_dept_tenant_name (tenant_id, company_id, name)} is
     * NOT partial, so a second row with the same name would pass validation and
     * then fail at the database with a constraint violation — a 500 instead of
     * a 422.
     *
     * <p>Reviving is also the semantically right answer: employees and other
     * rows may still carry this department's id as an FK, so re-using the row
     * keeps those references intact instead of orphaning them.
     */
    public DepartmentResponse create(CreateDepartmentRequest req) {
        String costCentre = cleanCostCentre(req.costCentre());
        // Checked before anything is saved, so a missing table refuses the whole create.
        if (costCentre != null) requireCostCentreTable();
        Department existing = repository
                .findByCompanyIdAndNameIgnoreCase(req.companyId(), req.name())
                .orElse(null);

        if (existing != null && existing.isActive()) {
            // A genuinely live department with this name — real duplicate.
            throw new BusinessRuleException("Department '" + req.name() + "' already exists", "DUPLICATE_DEPARTMENT");
        }

        // Either revive the archived row (keeps its id, and therefore every FK
        // pointing at it) or start a fresh one.
        Department d = existing != null ? existing : new Department();
        UUID oldHead = d.getDepartmentHeadEmployeeId();
        d.setCompanyId(req.companyId());
        d.setName(req.name());
        d.setCode(req.code());
        if (req.parentDepartmentId() != null) checkParent(d, req.parentDepartmentId());
        d.setParentDepartmentId(req.parentDepartmentId());
        d.setDepartmentHeadEmployeeId(req.departmentHeadEmployeeId());
        d.setDescription(req.description());
        // 2026-09-10: persist the colour + icon the admin picked instead of
        // storing them per-browser (see V118). Nullable, so a caller that omits
        // them keeps the current row's value on revive and starts with NULL on
        // a fresh insert (SPA falls back to a default palette).
        if (req.colorHex() != null) d.setColorHex(req.colorHex());
        if (req.iconKey()  != null) d.setIconKey(req.iconKey());
        d.setActive(true);
        // Flushed now: the branch links below are inserted over JDBC and reference this row.
        Department saved = repository.saveAndFlush(d);
        DepartmentHeadChange.moveReports(jdbc, saved.getId(), oldHead, saved.getDepartmentHeadEmployeeId());
        // 2026-09-25: branchIds used to be accepted and silently dropped.
        if (req.branchIds() != null) replaceBranches(saved, req.branchIds());
        if (costCentre != null) writeCostCentre(saved, costCentre);
        return toResponse(saved);
    }

    /**
     * Move a department under another one, or to the top level ({@code parentId}
     * null). The new parent must be an active department of the same company,
     * and not the department itself or one of its own sub-teams (that would
     * make a loop that no tree can draw).
     */
    public DepartmentResponse moveUnder(UUID id, UUID parentId) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (parentId != null) checkParent(d, parentId);
        d.setParentDepartmentId(parentId);
        return toResponse(repository.save(d));
    }

    /** Replace the branches a department works in; an empty list means it isn't limited to any. */
    public DepartmentResponse setBranches(UUID id, List<UUID> branchIds) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        replaceBranches(d, branchIds == null ? List.of() : branchIds);
        return toResponse(d);
    }

    /** Throws when {@code parentId} can't be the parent of {@code d}. */
    void checkParent(Department d, UUID parentId) {
        if (parentId.equals(d.getId())) {
            throw new BusinessRuleException("A department can't be its own parent", "DEPARTMENT_CYCLE");
        }
        Department parent = repository.findById(parentId)
                .orElseThrow(() -> new BusinessRuleException("The parent department doesn't exist", "PARENT_NOT_FOUND"));
        if (!parent.getCompanyId().equals(d.getCompanyId())) {
            throw new BusinessRuleException("The parent department belongs to another company", "PARENT_OTHER_COMPANY");
        }
        if (!parent.isActive()) {
            throw new BusinessRuleException(parent.getName() + " is archived; pick an active department", "PARENT_INACTIVE");
        }
        if (d.getId() == null) return;   // a new department has no sub-teams yet
        // Walk up from the new parent: reaching d means d would sit under itself.
        Set<UUID> seen = new HashSet<>();
        UUID cur = parent.getParentDepartmentId();
        while (cur != null && seen.add(cur)) {
            if (cur.equals(d.getId())) {
                throw new BusinessRuleException(parent.getName() + " is inside " + d.getName()
                        + ", so " + d.getName() + " can't move under it", "DEPARTMENT_CYCLE");
            }
            cur = repository.findById(cur).map(Department::getParentDepartmentId).orElse(null);
        }
    }

    void replaceBranches(Department d, List<UUID> branchIds) {
        List<UUID> ids = new ArrayList<>(new LinkedHashSet<>(branchIds.stream().filter(java.util.Objects::nonNull).toList()));
        if (!ids.isEmpty()) {
            String marks = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
            List<Object> args = new ArrayList<>(ids);
            args.add(d.getCompanyId());
            Integer found = jdbc.queryForObject(
                    "SELECT count(*) FROM org.branches WHERE id IN (" + marks + ") AND company_id = ?", Integer.class, args.toArray());
            if (found == null || found != ids.size()) {
                throw new BusinessRuleException("Pick branches of the department's own company", "BRANCH_OTHER_COMPANY");
            }
        }
        jdbc.update("DELETE FROM hrms.department_branches WHERE department_id = ?", d.getId());
        UUID tenant = d.getTenantId() != null ? d.getTenantId() : TenantContext.getTenantId();
        for (UUID b : ids) {
            jdbc.update("INSERT INTO hrms.department_branches (tenant_id, department_id, branch_id) VALUES (?, ?, ?)", tenant, d.getId(), b);
        }
    }

    private List<UUID> branchesOf(UUID departmentId) {
        return jdbc.query("SELECT branch_id FROM hrms.department_branches WHERE department_id = ?",
                (rs, i) -> rs.getObject(1, UUID.class), departmentId);
    }

    /**
     * Update the cosmetic settings on an existing department. Kept separate
     * from rename() and setHead() because those are their own PATCH endpoints
     * already, and this one takes both fields together so a save can't blank
     * one by omission. Null means "leave alone".
     */
    public DepartmentResponse updateAppearance(UUID id, String colorHex, String iconKey) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (colorHex != null) d.setColorHex(colorHex);
        if (iconKey  != null) d.setIconKey(iconKey);
        return toResponse(repository.save(d));
    }

    public DepartmentResponse rename(UUID id, String newName) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (!d.getName().equalsIgnoreCase(newName)
                && repository.existsByCompanyIdAndNameIgnoreCase(d.getCompanyId(), newName)) {
            throw new BusinessRuleException("Department '" + newName + "' already exists", "DUPLICATE_DEPARTMENT");
        }
        d.setName(newName);
        return toResponse(repository.save(d));
    }

    /**
     * Edit a department's code and/or description.
     *
     * Both are settable at create time and neither could be changed afterwards
     * — there was no route for them at all, so a typo in a department code was
     * permanent short of archiving and recreating the department (which orphans
     * every employee pointing at it).
     *
     * Null means "leave unchanged" so callers can send only what they touched.
     * Blank clears the field, which matters for description; code is uppercased
     * and uniqueness-checked within the company, same as create.
     */
    public DepartmentResponse updateDetails(UUID id, String code, String description) {
        return updateDetails(id, code, description, null);
    }

    /**
     * {@link #updateDetails(UUID, String, String)} plus the cost centre
     * (redesign BW-95): null leaves it, blank clears it. Answers
     * FEATURE_NOT_READY, before changing anything, when a cost centre is sent
     * and V143_52 isn't applied.
     */
    public DepartmentResponse updateDetails(UUID id, String code, String description, String costCentre) {
        String cleanCostCentre = costCentre == null ? null : cleanCostCentre(costCentre);
        if (costCentre != null) requireCostCentreTable();
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (code != null) {
            String next = code.isBlank() ? null : code.trim().toUpperCase();
            if (next != null && !next.equalsIgnoreCase(d.getCode())
                    && repository.existsByCompanyIdAndCodeIgnoreCase(d.getCompanyId(), next)) {
                throw new BusinessRuleException(
                        "Department code '" + next + "' is already used", "DUPLICATE_DEPARTMENT_CODE");
            }
            d.setCode(next);
        }
        if (description != null) {
            d.setDescription(description.isBlank() ? null : description.trim());
        }
        Department saved = repository.save(d);
        if (costCentre != null) writeCostCentre(saved, cleanCostCentre);
        return toResponse(saved);
    }

    public DepartmentResponse setHead(UUID id, UUID employeeId) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        UUID oldHead = d.getDepartmentHeadEmployeeId();
        d.setDepartmentHeadEmployeeId(employeeId);   // null clears the head
        Department saved = repository.save(d);
        DepartmentHeadChange.moveReports(jdbc, id, oldHead, employeeId);
        return toResponse(saved);
    }

    public void archive(UUID id) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        d.setActive(false);
        repository.save(d);
    }

    private DepartmentResponse toResponse(Department d) {
        return toResponse(d, headcount.countFor("department_id", d.getId()), branchesOf(d.getId()),
                costCentreOf(d.getId()), headNameOf(d.getDepartmentHeadEmployeeId()));
    }

    /** {@code employees}: people working there now (see LiveHeadcount), not the never-updated cached column. */
    private DepartmentResponse toResponse(Department d, int employees, List<UUID> branchIds, String costCentre, String headName) {
        return new DepartmentResponse(
                d.getId(), d.getCompanyId(), d.getName(), d.getCode(),
                d.getParentDepartmentId(), d.getDepartmentHeadEmployeeId(),
                d.getDescription(), d.getColorHex(), d.getIconKey(),
                employees, d.isActive(), List.copyOf(branchIds), costCentre, headName);
    }

    // -- Cost centre and head name (redesign BW-95) --------------------------
    // The cost centre lives in hrms.department_cost_centres (V143_52, JDBC only;
    // hrms.departments is JPA-mapped). Reads check to_regclass first and leave
    // it null when the table isn't there, so department lists keep working
    // before the migration is applied; writes answer FEATURE_NOT_READY.

    /** Longest cost centre kept (the column is VARCHAR(50)). */
    static final int COST_CENTRE_MAX = 50;

    /** Trimmed; blank = none (null). Longer than {@value #COST_CENTRE_MAX} characters is refused. */
    static String cleanCostCentre(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String t = raw.trim();
        if (t.length() > COST_CENTRE_MAX) {
            throw new BusinessRuleException("A cost centre can be at most " + COST_CENTRE_MAX + " characters", "COST_CENTRE_TOO_LONG");
        }
        return t;
    }

    boolean costCentreTableExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT to_regclass('hrms.department_cost_centres') IS NOT NULL", Boolean.class));
    }

    private void requireCostCentreTable() {
        if (!costCentreTableExists()) throw new com.hrms.core.exception.FeatureNotReady();
    }

    /** Sets ({@code costCentre} non-null) or clears (null) the department's cost centre. */
    private void writeCostCentre(Department d, String costCentre) {
        UUID tenant = d.getTenantId() != null ? d.getTenantId() : TenantContext.getTenantId();
        com.hrms.core.exception.FeatureNotReady.run(() -> {
            if (costCentre == null) {
                jdbc.update("DELETE FROM hrms.department_cost_centres WHERE tenant_id = ? AND department_id = ?", tenant, d.getId());
            } else {
                jdbc.update("""
                        INSERT INTO hrms.department_cost_centres (tenant_id, department_id, cost_centre)
                        VALUES (?, ?, ?)
                        ON CONFLICT (tenant_id, department_id) DO UPDATE SET cost_centre = EXCLUDED.cost_centre, updated_at = now()
                        """, tenant, d.getId(), costCentre);
            }
        });
    }

    private Map<UUID, String> costCentresOf(UUID companyId) {
        Map<UUID, String> out = new HashMap<>();
        if (!costCentreTableExists()) return out;
        jdbc.query("""
                SELECT c.department_id, c.cost_centre FROM hrms.department_cost_centres c
                  JOIN hrms.departments d ON d.id = c.department_id
                 WHERE d.company_id = ? AND c.tenant_id = d.tenant_id""",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject(1, UUID.class), rs.getString(2)),
                companyId);
        return out;
    }

    private String costCentreOf(UUID departmentId) {
        if (departmentId == null || !costCentreTableExists()) return null;
        List<String> rows = jdbc.queryForList(
                "SELECT cost_centre FROM hrms.department_cost_centres WHERE department_id = ?", String.class, departmentId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Head names for the company's departments, by the head's employee id. */
    private Map<UUID, String> headNamesOf(UUID companyId) {
        Map<UUID, String> out = new HashMap<>();
        jdbc.query("""
                SELECT e.id, e.first_name, e.last_name FROM hrms.employees e
                  JOIN hrms.departments d ON d.department_head_employee_id = e.id
                 WHERE d.company_id = ?""",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject(1, UUID.class), fullName(rs.getString(2), rs.getString(3))),
                companyId);
        return out;
    }

    private String headNameOf(UUID employeeId) {
        if (employeeId == null) return null;
        List<String> rows = jdbc.query("SELECT first_name, last_name FROM hrms.employees WHERE id = ?",
                (rs, i) -> fullName(rs.getString(1), rs.getString(2)), employeeId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    static String fullName(String first, String last) {
        String n = ((first == null ? "" : first.trim()) + " " + (last == null ? "" : last.trim())).trim();
        return n.isEmpty() ? null : n;
    }
}
