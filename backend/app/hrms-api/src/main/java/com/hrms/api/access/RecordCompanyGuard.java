package com.hrms.api.access;

import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.RecordOwner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Company access for records a request addresses by id
 * (docs/redesign/COMPANY_ACCESS.md, "Records addressed by id"): reads whose a
 * record is and hands it to {@link CompanyAccessService#checkRecord}, the one
 * shared check. A company-scoped person gets 404 for a record in a company they
 * can't access, and 403 COMPANY_ACCESS_DENIED for one in a company they can
 * access but are not working in; everyone else is not checked (and nothing is
 * read).
 *
 * <p>Controllers hold it as an optional field and call the static
 * {@link #check(RecordCompanyGuard, Kind, UUID)}, so controllers built by hand in
 * unit tests (without it) behave exactly as before.
 */
@Component
public class RecordCompanyGuard {

    /**
     * The kinds of record checked, each with the table it lives in. {@code owned}:
     * the record belongs to one person ({@code employee_id}); they, their manager
     * and (with {@code routed}) the {@code approver_id} it was sent to are always
     * allowed.
     */
    public enum Kind {
        EMPLOYEE("Employee", "hrms.employees", false),
        DEPARTMENT("Department", "hrms.departments", false),
        DESIGNATION("Designation", "hrms.designations", false),
        BRANCH("Branch", "org.branches", false),
        SHIFT("Shift", "org.shifts", false),
        GRADE("Grade", "org.grades", false),
        EMPLOYMENT_TYPE("Employment type", "org.employment_types", false),
        CLASSIFICATION("Classification rule", "hrms.classification_rules", false),
        CONTRACTOR("Contractor", "hrms.contractors", false),
        LEAVE_TYPE("LeaveType", "leave_mgmt.leave_types", false),
        HOLIDAY("Holiday", "settings.holiday_calendar", false),
        PAYROLL_RUN("Payroll run", "payroll.runs", false),
        EXPENSE_POLICY("Expense policy", "expense_mgmt.expense_policies", false),
        PLI_TARGET("PLI target", "pli_mgmt.pli_targets", false),
        EXPENSE_CLAIM("Expense claim", "expense_mgmt.expense_claims", true, true),
        ADVANCE("Advance request", "advance_mgmt.advance_requests", true, true),
        FNF_SETTLEMENT("F&F settlement", "fnf_mgmt.fnf_settlements", true, true),
        PLI_AWARD("PLI award", "pli_mgmt.pli_awards", true),
        DOCUMENT("Document", "document_mgmt.employee_documents", true);

        public final String resource;
        final String table;
        final boolean owned;
        final boolean routed;

        Kind(String resource, String table, boolean owned) {
            this(resource, table, owned, false);
        }

        Kind(String resource, String table, boolean owned, boolean routed) {
            this.resource = resource;
            this.table = table;
            this.owned = owned;
            this.routed = routed;
        }

        /** Company, person, their manager and approver of one row; the table names are this enum's own constants. */
        String ownerSql() {
            if (this == EMPLOYEE) {
                return "SELECT company_id, id, reporting_manager_id, NULL::uuid FROM hrms.employees WHERE id = ?";
            }
            if (owned) {
                return "SELECT COALESCE(r.company_id, e.company_id), r.employee_id, e.reporting_manager_id, "
                        + (routed ? "r.approver_id" : "NULL::uuid") + " FROM "
                        + table + " r LEFT JOIN hrms.employees e ON e.id = r.employee_id WHERE r.id = ?";
            }
            return "SELECT company_id, NULL::uuid, NULL::uuid, NULL::uuid FROM " + table + " WHERE id = ?";
        }
    }

    private final JdbcTemplate jdbc;
    private final CompanyAccessService access;

    public RecordCompanyGuard(JdbcTemplate jdbc, CompanyAccessService access) {
        this.jdbc = jdbc;
        this.access = access;
    }

    /** Refuses the request when the caller may not act on this record (see the class note). */
    public void check(Kind kind, UUID id) {
        if (id == null) return;
        access.checkRecord(kind.resource, id, () -> owner(kind, id));
    }

    /**
     * Refuses the request when the caller may not act for this person: the
     * "for employee X" endpoints (their claims, their documents, an F&amp;F for
     * them), which work in the person's company.
     */
    public void checkEmployee(UUID employeeId) {
        check(Kind.EMPLOYEE, employeeId);
    }

    /** {@link #check(Kind, UUID)} through an optional field: nothing without the bean. */
    public static void check(RecordCompanyGuard guard, Kind kind, UUID id) {
        if (guard != null) guard.check(kind, id);
    }

    /** {@link #checkEmployee(UUID)} through an optional field: nothing without the bean. */
    public static void checkEmployee(RecordCompanyGuard guard, UUID employeeId) {
        if (guard != null) guard.checkEmployee(employeeId);
    }

    /** Whose the record is, or null when the id is unknown here (RLS keeps other workspaces out). */
    RecordOwner owner(Kind kind, UUID id) {
        return jdbc.query(kind.ownerSql(), rs -> rs.next()
                ? new RecordOwner(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getObject(3, UUID.class),
                        rs.getObject(4, UUID.class))
                : null, id);
    }
}
