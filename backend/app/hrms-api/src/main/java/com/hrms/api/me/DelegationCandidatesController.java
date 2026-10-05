package com.hrms.api.me;

import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchHit;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchResponse;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * {@code GET /v1/approvals/delegation/candidates?q=&limit=} — the colleague
 * picker of approval delegation (Profile › Preferences on the website, the
 * Approval delegation screen in the app).
 *
 * <p>Why it exists: the picker used the directory search ({@code /v1/search},
 * {@code hrms.employee.read}), which most managers do not hold, so they could
 * not choose anyone and could not delegate. The owner agreed (5 Oct 2026) that
 * people may look colleagues up for this one purpose.
 *
 * <p>Who may call it: approvers, i.e. anyone holding at least one of
 * {@link #APPROVER_PERMISSIONS} (the owner agreed to this for managers; someone
 * who approves nothing has nothing to delegate). Everyone else gets 403 — even
 * with {@code hrms.employee.read}, who keeps the directory search for this. Setting
 * a delegation ({@link ApprovalDelegationController#create}) is unchanged.
 * No new permission code.
 *
 * <p>Who comes back: the people {@code create} accepts as a delegate, narrowed
 * to those who can act on it. Same workspace only (explicit {@code tenant_id}
 * on every table, and RLS underneath); not the caller; not removed
 * ({@code is_active}); not left or suspended (EXITED, TERMINATED, SUSPENDED —
 * the statuses {@code create} refuses — plus RESIGNED and RETIRED); and only
 * people with an active login, since a delegate who cannot sign in cannot
 * approve. The delegation has no company or approval-permission rule, so
 * neither has this.
 *
 * <p>What comes back: {@link EmployeeSearchHit} — id, name, employee code,
 * department, designation, photo. The record cannot carry anything else
 * (salary, bank, phone, birth date...), and the statement selects nothing else.
 */
@RestController
@RequestMapping("/v1/approvals/delegation")
@SecurityRequirement(name = "bearerAuth")
public class DelegationCandidatesController {

    /** Shorter queries are refused with 400 (as {@code /v1/search} does). */
    public static final int MIN_QUERY_CHARS = 2;
    public static final int DEFAULT_LIMIT = 10;
    public static final int MAX_LIMIT = 20;
    /** Longer than any name, code or email; the rest is noise. */
    static final int MAX_QUERY_CHARS = 100;
    /** At most this many words are matched one by one. */
    static final int MAX_TOKENS = 4;

    /**
     * The approval permissions: the codes that guard the approve / decide endpoints. Holding any
     * one makes someone an approver, who may look colleagues up to choose a delegate. Keep in step
     * with every approve / decide guard (DelegationCandidatesControllerTest scans them), and with
     * the website's and the app's copies (delegateSearch.ts, utils/delegation.ts).
     */
    public static final List<String> APPROVER_PERMISSIONS = List.of(
            "hrms.leave.approve.l1",             // leave, first level (and the Approvals inbox)
            "hrms.leave.approve.l2",             // leave, second level
            "hrms.leave.encash.approve",         // leave encashment
            "wfh.approve",                       // work from home
            "attendance.regularization.approve", // attendance corrections, shift-change requests
            "attendance.overtime.approve",       // overtime
            "hrms.expense.claim.approve",        // expense claims
            "hrms.advance.approve",              // salary advances
            "hrms.timesheet.approve",            // timesheet weeks
            "hrms.probation.team.decide",        // confirm or extend a report's probation
            "hrms.fnf.approve",                  // full and final settlements
            "hrms.learning.skill.approve");      // skill assessments

    /** {@link #APPROVER_PERMISSIONS} as the guard (an annotation needs a constant; the test checks they agree). */
    static final String APPROVER_GUARD = "@perm.hasAny('hrms.leave.approve.l1', 'hrms.leave.approve.l2', "
            + "'hrms.leave.encash.approve', 'wfh.approve', 'attendance.regularization.approve', "
            + "'attendance.overtime.approve', 'hrms.expense.claim.approve', 'hrms.advance.approve', "
            + "'hrms.timesheet.approve', 'hrms.probation.team.decide', 'hrms.fnf.approve', "
            + "'hrms.learning.skill.approve')";

    /** Statuses of people who are no longer working here (or may not act for now). */
    static final List<String> EXCLUDED_STATUSES =
            List.of("EXITED", "TERMINATED", "SUSPENDED", "RESIGNED", "RETIRED");

    private final JdbcTemplate jdbc;

    public DelegationCandidatesController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Operation(summary = "Colleagues an approver can choose as their approval delegate (name, code or email prefix)")
    @GetMapping("/candidates")
    @PreAuthorize(APPROVER_GUARD)
    @Transactional(readOnly = true)
    public EmployeeSearchResponse candidates(@RequestParam String q,
                                             @RequestParam(defaultValue = "" + DEFAULT_LIMIT) int limit,
                                             @AuthenticationPrincipal Jwt jwt) {
        String query = normalize(q);
        if (query.length() < MIN_QUERY_CHARS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "q must be at least " + MIN_QUERY_CHARS + " characters");
        }
        UUID tenant = TenantContext.requireTenantId();
        UUID self = ApprovalDelegationController.actorEmployeeId(jwt);
        int size = Math.max(1, Math.min(limit, MAX_LIMIT));
        List<String> tokens = tokens(query);

        List<EmployeeSearchHit> rows = jdbc.query(sql(tokens.size()), ROW,
                args(tenant, self, query, tokens, size + 1).toArray());
        boolean truncated = rows.size() > size;
        return new EmployeeSearchResponse(truncated ? rows.subList(0, size) : rows, size, truncated);
    }

    // -- the statement -----------------------------------------------------

    /**
     * Only the six picker fields are selected. Every table is fenced by the
     * caller's tenant, with the parameters in this order: tenant (employees),
     * tenant (departments), tenant (designations), tenant (login), self, the
     * excluded statuses, then the matching (see {@link #args}).
     */
    static String sql(int tokenCount) {
        int n = Math.max(0, Math.min(tokenCount, MAX_TOKENS));
        String statuses = String.join(", ", EXCLUDED_STATUSES.stream().map(s -> "?").toList());
        StringBuilder words = new StringBuilder();
        for (int i = 0; i < n; i++) {
            words.append(i == 0 ? "" : " AND ")
                 .append("(lower(e.first_name) LIKE ? ESCAPE '\\' OR lower(coalesce(e.last_name, '')) LIKE ? ESCAPE '\\')");
        }
        String whole = """
                lower(e.first_name) LIKE ? ESCAPE '\\'
                   OR lower(coalesce(e.last_name, '')) LIKE ? ESCAPE '\\'
                   OR lower(concat_ws(' ', e.first_name, e.last_name)) LIKE ? ESCAPE '\\'
                   OR lower(e.employee_code) LIKE ? ESCAPE '\\'
                   OR lower(coalesce(e.email, '')) LIKE ? ESCAPE '\\'
                   OR EXISTS (SELECT 1 FROM auth.user_credentials m
                               WHERE m.tenant_id = e.tenant_id AND m.employee_id = e.id
                                 AND m.is_active = TRUE AND lower(m.email) LIKE ? ESCAPE '\\')""";
        String match = n == 0 ? "(" + whole + ")" : "((" + whole + ") OR (" + words + "))";
        return """
                SELECT e.id, e.first_name, e.last_name, e.employee_code, e.profile_photo_url,
                       d.name  AS department_name,
                       g.title AS job_title
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments  d ON d.id = e.department_id  AND d.tenant_id = ?
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id AND g.tenant_id = ?
                 WHERE e.tenant_id = ?
                   AND EXISTS (SELECT 1 FROM auth.user_credentials u
                                WHERE u.tenant_id = e.tenant_id AND u.employee_id = e.id AND u.is_active = TRUE
                                  AND u.tenant_id = ?)
                   AND e.is_active = TRUE
                   AND e.id <> ?
                   AND e.employment_status NOT IN (%s)
                   AND %s
                 ORDER BY
                   CASE WHEN lower(concat_ws(' ', e.first_name, e.last_name)) = ?
                          OR lower(e.employee_code) = ? THEN 0 ELSE 1 END,
                   lower(e.first_name), lower(coalesce(e.last_name, '')), e.employee_code, e.id
                 LIMIT ?
                """.formatted(statuses, match);
    }

    /** The parameters of {@link #sql}, in its order. */
    static List<Object> args(UUID tenant, UUID self, String query, List<String> tokens, int fetch) {
        String prefix = escapeLike(query) + "%";
        List<Object> a = new ArrayList<>();
        // The selected columns' joins, then the employee and login fences.
        a.add(tenant);
        a.add(tenant);
        a.add(tenant);
        a.add(tenant);
        a.add(self);
        a.addAll(EXCLUDED_STATUSES);
        // Whole query as a prefix: first, last, full name, code, work email, login email.
        for (int i = 0; i < 6; i++) a.add(prefix);
        // Each word as a prefix of the first or last name ("rah ver" finds Rahul Verma).
        int n = Math.min(tokens.size(), MAX_TOKENS);
        for (int i = 0; i < n; i++) {
            String t = escapeLike(tokens.get(i)) + "%";
            a.add(t);
            a.add(t);
        }
        a.add(query);
        a.add(query);
        a.add(fetch);
        return a;
    }

    static final RowMapper<EmployeeSearchHit> ROW = (rs, i) -> new EmployeeSearchHit(
            rs.getObject("id", UUID.class),
            displayName(rs.getString("first_name"), rs.getString("last_name")),
            rs.getString("employee_code"),
            rs.getString("department_name"),
            rs.getString("job_title"),
            rs.getString("profile_photo_url"));

    // -- helpers -----------------------------------------------------------

    /** Trim, fold inner spaces, lower-case, cap the length. */
    static String normalize(String raw) {
        if (raw == null) return "";
        String q = raw.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        return q.length() > MAX_QUERY_CHARS ? q.substring(0, MAX_QUERY_CHARS) : q;
    }

    /** The distinct words of a normalised query, at most {@value #MAX_TOKENS}; one word gives none. */
    static List<String> tokens(String normalized) {
        List<String> words = Arrays.stream(normalized.split(" ")).filter(s -> !s.isBlank()).distinct()
                .limit(MAX_TOKENS).toList();
        return words.size() < 2 ? List.of() : words;
    }

    /** A typed "%" or "_" is matched as itself, not as a wildcard. */
    static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static String displayName(String first, String last) {
        String f = first == null ? "" : first.trim();
        String l = last == null ? "" : last.trim();
        return (f + " " + l).trim();
    }
}
