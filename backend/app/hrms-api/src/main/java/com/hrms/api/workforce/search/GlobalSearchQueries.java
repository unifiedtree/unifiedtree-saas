package com.hrms.api.workforce.search;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * The record lookups behind the top bar's search: one parameterised statement
 * per type, newest first, bounded by {@code LIMIT}.
 *
 * <p>Only named parameters are ever appended to the SQL (:w0 … :w3, :people);
 * the words the person typed are bound, never concatenated. Each statement
 * names the tenant explicitly on top of the RLS fence the tenant-aware data
 * source already sets on the connection. Who may see which rows is decided by
 * the caller ({@link GlobalSearchService}) and arrives here as a {@link Scope}.
 */
@Component
public class GlobalSearchQueries {

    /**
     * Whose records a statement may return: {@code people == null} means anyone
     * in the tenant (the caller holds the "read everyone" permission); otherwise
     * only these employees (their own record, or their team and themselves).
     */
    public record Scope(Collection<UUID> people) {
        public static final Scope EVERYONE = new Scope(null);
        public static Scope only(Collection<UUID> people) { return new Scope(List.copyOf(people)); }
        boolean limited() { return people != null; }
        boolean nobody() { return people != null && people.isEmpty(); }
    }

    public record LeaveRow(UUID id, UUID employeeId, String employeeName, String employeeCode, String typeName,
                           LocalDate start, LocalDate end, Double days, String status) {}
    public record ExpenseRow(UUID id, UUID employeeId, String employeeName, String employeeCode, String title,
                             String status, LocalDate on) {}
    public record PayslipRow(UUID runId, UUID employeeId, String employeeName, String employeeCode,
                             int month, int year, String status) {}
    public record DocumentRow(UUID id, UUID employeeId, String employeeName, String employeeCode, String title,
                              String typeName, String category, String verification) {}
    public record LetterRow(UUID id, UUID employeeId, String employeeName, String employeeCode, String subject,
                            String type, String status, LocalDate on) {}
    public record CandidateRow(UUID id, UUID requisitionId, String name, String jobTitle, String stage) {}
    public record OfferRow(UUID id, String candidateName, String roleTitle, String status) {}
    public record JobRow(UUID id, String title, String location, String status, Integer openings, String departmentName) {}
    public record PolicyRow(UUID id, String title, String category, String version, String status, LocalDate effective) {}

    // What each type's words are matched against (fixed SQL, no user input).
    static final String LEAVE_TEXT = "concat_ws(' ', e.first_name, e.last_name, e.employee_code, lt.name, lr.status)";
    static final String EXPENSE_TEXT = "concat_ws(' ', c.title, c.status, e.first_name, e.last_name, e.employee_code)";
    static final String PERIOD_TEXT = "concat_ws(' ', to_char(make_date(r.period_year, r.period_month, 1), 'FMMonth YYYY'), "
            + "to_char(make_date(r.period_year, r.period_month, 1), 'Mon'))";
    static final String PAYSLIP_TEXT = "concat_ws(' ', e.first_name, e.last_name, e.employee_code, " + PERIOD_TEXT + ")";
    static final String DOCUMENT_TEXT = "concat_ws(' ', d.title, t.display_name, replace(d.category, '_', ' '), d.original_filename, "
            + "e.first_name, e.last_name, e.employee_code)";
    static final String LETTER_TEXT = "concat_ws(' ', g.subject, replace(g.type, '_', ' '), e.first_name, e.last_name, e.employee_code)";
    static final String CANDIDATE_TEXT = "concat_ws(' ', c.full_name, c.email, j.title, c.stage)";
    static final String OFFER_TEXT = "concat_ws(' ', o.candidate_name, o.role_title, o.status)";
    static final String JOB_TEXT = "concat_ws(' ', j.title, j.location, j.status, d.name)";
    static final String POLICY_TEXT = "concat_ws(' ', p.title, replace(p.category, '_', ' '))";

    private final NamedParameterJdbcTemplate jdbc;

    public GlobalSearchQueries(JdbcTemplate jdbc) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbc);
    }

    /** " AND lower(<text>) LIKE :w0 … AND … :wN" — one clause per word, parameters only. */
    static String wordClauses(String text, int count) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < count; i++) sb.append("\n   AND lower(").append(text).append(") LIKE :w").append(i).append(" ESCAPE '\\'");
        return sb.toString();
    }

    static MapSqlParameterSource params(UUID tenant, List<String> words, int limit) {
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("tenant", tenant).addValue("limit", limit);
        for (int i = 0; i < words.size(); i++) p.addValue("w" + i, SearchText.contains(words.get(i)));
        return p;
    }

    private static String people(String column, Scope scope, MapSqlParameterSource p) {
        if (!scope.limited()) return "";
        p.addValue("people", scope.people());
        return "\n   AND " + column + " IN (:people)";
    }

    static String name(String first, String last) {
        return ((first == null ? "" : first.trim()) + " " + (last == null ? "" : last.trim())).trim();
    }

    private static LocalDate date(ResultSet rs, String column) throws SQLException {
        Date d = rs.getDate(column);
        return d == null ? null : d.toLocalDate();
    }

    public List<LeaveRow> leave(UUID tenant, Scope scope, List<String> words, int limit) {
        if (scope.nobody()) return List.of();
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT lr.id, lr.employee_id, lr.start_date, lr.end_date, lr.total_days, lr.status,
                   e.first_name, e.last_name, e.employee_code, lt.name AS type_name
              FROM leave_mgmt.leave_requests lr
              JOIN hrms.employees e ON e.id = lr.employee_id
              LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id
             WHERE lr.tenant_id = :tenant""" + people("lr.employee_id", scope, p) + wordClauses(LEAVE_TEXT, words.size()) + """

             ORDER BY lr.created_at DESC, lr.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new LeaveRow(
                rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                name(rs.getString("first_name"), rs.getString("last_name")), rs.getString("employee_code"),
                rs.getString("type_name"), date(rs, "start_date"), date(rs, "end_date"),
                rs.getObject("total_days") == null ? null : rs.getDouble("total_days"), rs.getString("status")));
    }

    public List<ExpenseRow> expenses(UUID tenant, Scope scope, List<String> words, int limit) {
        if (scope.nobody()) return List.of();
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT c.id, c.employee_id, c.title, c.status, (coalesce(c.submitted_at, c.created_at) AT TIME ZONE 'Asia/Kolkata')::date AS on_date,
                   e.first_name, e.last_name, e.employee_code
              FROM expense_mgmt.expense_claims c
              JOIN hrms.employees e ON e.id = c.employee_id
             WHERE c.tenant_id = :tenant""" + people("c.employee_id", scope, p) + wordClauses(EXPENSE_TEXT, words.size()) + """

             ORDER BY c.created_at DESC, c.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new ExpenseRow(
                rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                name(rs.getString("first_name"), rs.getString("last_name")), rs.getString("employee_code"),
                rs.getString("title"), rs.getString("status"), date(rs, "on_date")));
    }

    /**
     * A payslip is an employee's lines in a run. Everyone: every run that isn't
     * cancelled (the run pages list them). Own: locked and paid runs only, as
     * GET /v1/payroll/payslips/me — an employee never sees draft numbers.
     */
    public List<PayslipRow> payslips(UUID tenant, Scope scope, List<String> words, int limit) {
        if (scope.nobody()) return List.of();
        MapSqlParameterSource p = params(tenant, words, limit);
        String status = scope.limited() ? "r.status IN ('LOCKED', 'PAID')" : "r.status <> 'CANCELLED'";
        String sql = """
            SELECT r.id AS run_id, r.period_month, r.period_year, r.status,
                   e.id AS employee_id, e.first_name, e.last_name, e.employee_code
              FROM payroll.runs r
              JOIN hrms.employees e ON e.tenant_id = r.tenant_id
             WHERE r.tenant_id = :tenant
               AND\s""" + status + people("e.id", scope, p) + """

               AND EXISTS (SELECT 1 FROM payroll.payslip_lines l WHERE l.run_id = r.id AND l.employee_id = e.id)""" + wordClauses(PAYSLIP_TEXT, words.size()) + """

             ORDER BY r.period_year DESC, r.period_month DESC, e.employee_code, e.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new PayslipRow(
                rs.getObject("run_id", UUID.class), rs.getObject("employee_id", UUID.class),
                name(rs.getString("first_name"), rs.getString("last_name")), rs.getString("employee_code"),
                rs.getInt("period_month"), rs.getInt("period_year"), rs.getString("status")));
    }

    public List<DocumentRow> documents(UUID tenant, Scope scope, List<String> words, int limit) {
        if (scope.nobody()) return List.of();
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT d.id, d.employee_id, d.title, d.category, d.verification_status, t.display_name AS type_name,
                   e.first_name, e.last_name, e.employee_code
              FROM document_mgmt.employee_documents d
              JOIN hrms.employees e ON e.id = d.employee_id
              LEFT JOIN document_mgmt.document_types t ON t.id = d.document_type_id
             WHERE d.tenant_id = :tenant""" + people("d.employee_id", scope, p) + wordClauses(DOCUMENT_TEXT, words.size()) + """

             ORDER BY d.created_at DESC, d.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new DocumentRow(
                rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                name(rs.getString("first_name"), rs.getString("last_name")), rs.getString("employee_code"),
                rs.getString("title"), rs.getString("type_name"), rs.getString("category"), rs.getString("verification_status")));
    }

    public List<LetterRow> letters(UUID tenant, Scope scope, List<String> words, int limit) {
        if (scope.nobody()) return List.of();
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT g.id, g.employee_id, g.subject, g.type, g.status, (g.created_at AT TIME ZONE 'Asia/Kolkata')::date AS on_date,
                   e.first_name, e.last_name, e.employee_code
              FROM letters.generated g
              LEFT JOIN hrms.employees e ON e.id = g.employee_id
             WHERE g.tenant_id = :tenant
               AND g.deleted_at IS NULL""" + people("g.employee_id", scope, p) + wordClauses(LETTER_TEXT, words.size()) + """

             ORDER BY g.created_at DESC, g.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new LetterRow(
                rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                name(rs.getString("first_name"), rs.getString("last_name")), rs.getString("employee_code"),
                rs.getString("subject"), rs.getString("type"), rs.getString("status"), date(rs, "on_date")));
    }

    public List<CandidateRow> candidates(UUID tenant, List<String> words, int limit) {
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT c.id, c.requisition_id, c.full_name, c.stage, j.title AS job_title
              FROM hiring_mgmt.candidates c
              LEFT JOIN hiring_mgmt.job_requisitions j ON j.id = c.requisition_id
             WHERE c.tenant_id = :tenant""" + wordClauses(CANDIDATE_TEXT, words.size()) + """

             ORDER BY c.created_at DESC, c.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new CandidateRow(
                rs.getObject("id", UUID.class), rs.getObject("requisition_id", UUID.class),
                rs.getString("full_name"), rs.getString("job_title"), rs.getString("stage")));
    }

    public List<OfferRow> offers(UUID tenant, List<String> words, int limit) {
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT o.id, o.candidate_name, o.role_title, o.status
              FROM hiring_mgmt.offers o
             WHERE o.tenant_id = :tenant""" + wordClauses(OFFER_TEXT, words.size()) + """

             ORDER BY o.created_at DESC, o.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new OfferRow(
                rs.getObject("id", UUID.class), rs.getString("candidate_name"), rs.getString("role_title"), rs.getString("status")));
    }

    public List<JobRow> jobs(UUID tenant, List<String> words, int limit) {
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT j.id, j.title, j.location, j.status, j.openings, d.name AS department_name
              FROM hiring_mgmt.job_requisitions j
              LEFT JOIN hrms.departments d ON d.id = j.department_id
             WHERE j.tenant_id = :tenant""" + wordClauses(JOB_TEXT, words.size()) + """

             ORDER BY j.created_at DESC, j.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new JobRow(
                rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("location"), rs.getString("status"),
                (Integer) rs.getObject("openings"), rs.getString("department_name")));
    }

    /** @param publishedOnly readers see live (ACTIVE) policies only; authors see drafts and archived ones too. */
    public List<PolicyRow> policies(UUID tenant, boolean publishedOnly, List<String> words, int limit) {
        MapSqlParameterSource p = params(tenant, words, limit);
        String sql = """
            SELECT p.id, p.title, p.category, p.policy_version, p.status, p.effective_date
              FROM policy_mgmt.hr_policies p
             WHERE p.tenant_id = :tenant""" + (publishedOnly ? "\n   AND p.status = 'ACTIVE'" : "") + wordClauses(POLICY_TEXT, words.size()) + """

             ORDER BY CASE WHEN p.status = 'ACTIVE' THEN 0 ELSE 1 END, p.effective_date DESC NULLS LAST, p.created_at DESC, p.id
             LIMIT :limit""";
        return jdbc.query(sql, p, (rs, i) -> new PolicyRow(
                rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("category"),
                rs.getString("policy_version"), rs.getString("status"), date(rs, "effective_date")));
    }
}
