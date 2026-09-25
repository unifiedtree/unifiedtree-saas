package com.hrms.api.audit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Turns an audit event's (entity type, entity id) into something a person can
 * read: the record's name ("Rahul Verma", "Sep 2026 payroll", "Engineering")
 * and, where the record has its own page, a link to it. The dashboard's
 * activity feed and the audit log export use it.
 *
 * <p>Entity types are written by many modules in different spellings
 * ("Employee", "EMPLOYEE", "leave_request"), so they are matched ignoring case
 * and separators. Lookups run under the caller's tenant (RLS) in one query per
 * type; a type we don't know, a deleted record or a failed lookup simply has
 * no name, and callers fall back to the type.
 */
@Component
public class AuditRecordNames {

    private static final Logger log = LoggerFactory.getLogger(AuditRecordNames.class);

    /** A record's display name and, when it has one, the app route that opens it. */
    public record Named(String name, String path) {}

    /** A (type, id) pair to resolve. */
    public record Ref(String type, UUID id) {}

    private record Source(String sql, String path) {}

    private static final String PERSON = "NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), '')";

    private static final Map<String, Source> SOURCES = Map.ofEntries(
            Map.entry("employee", new Source("SELECT e.id, " + PERSON + " FROM hrms.employees e WHERE e.id IN (%s)", "/hrms/employees/{id}")),
            Map.entry("department", new Source("SELECT d.id, d.name FROM hrms.departments d WHERE d.id IN (%s)", "/hrms/master/departments")),
            Map.entry("designation", new Source("SELECT d.id, d.title FROM hrms.designations d WHERE d.id IN (%s)", "/hrms/master/designations")),
            Map.entry("company", new Source("SELECT c.id, c.name FROM org.companies c WHERE c.id IN (%s)", "/hrms/companies")),
            Map.entry("branch", new Source("SELECT b.id, b.name FROM org.branches b WHERE b.id IN (%s)", "/hrms/companies")),
            Map.entry("user", new Source("SELECT c.id, COALESCE(NULLIF(btrim(c.display_name), ''), " + PERSON + ", c.email) "
                    + "FROM auth.user_credentials c LEFT JOIN hrms.employees e ON e.id = c.employee_id WHERE c.id IN (%s)", "/users")),
            Map.entry("role", new Source("SELECT r.id, r.display_name FROM rbac.roles r WHERE r.id IN (%s)", "/roles")),
            Map.entry("leaverequest", new Source("SELECT r.id, " + PERSON + " FROM leave_mgmt.leave_requests r JOIN hrms.employees e ON e.id = r.employee_id WHERE r.id IN (%s)", "/hrms/leave")),
            Map.entry("expenseclaim", new Source("SELECT x.id, concat_ws(' · ', NULLIF(btrim(x.title), ''), " + PERSON + ") FROM expense_mgmt.expense_claims x "
                    + "JOIN hrms.employees e ON e.id = x.employee_id WHERE x.id IN (%s)", "/hrms/expenses")),
            Map.entry("payrollrun", new Source("SELECT r.id, to_char(make_date(r.period_year, r.period_month, 1), 'Mon YYYY') || ' payroll' FROM payroll.runs r WHERE r.id IN (%s)",
                    "/hrms/payroll/runs/{id}")),
            Map.entry("document", new Source("SELECT d.id, concat_ws(' · ', NULLIF(btrim(d.title), ''), " + PERSON + ") FROM document_mgmt.employee_documents d "
                    + "JOIN hrms.employees e ON e.id = d.employee_id WHERE d.id IN (%s)", "/hrms/documents")),
            Map.entry("policy", new Source("SELECT p.id, p.title FROM policy_mgmt.hr_policies p WHERE p.id IN (%s)", "/hrms/policies")),
            Map.entry("distributionjob", new Source("SELECT j.id, j.title FROM letters.distribution_jobs j WHERE j.id IN (%s)", "/hrms/letters/distributions")),
            Map.entry("distributionrecipient", new Source("SELECT r.id, " + PERSON + " FROM letters.distribution_recipients r JOIN hrms.employees e ON e.id = r.employee_id WHERE r.id IN (%s)",
                    "/hrms/letters/distributions")),
            Map.entry("reportschedule", new Source("SELECT s.id, initcap(lower(s.frequency)) || ' ' || replace(s.report, '-', ' ') || ' email' FROM hrms.report_schedules s WHERE s.id IN (%s)",
                    "/hrms/reports")));

    private final JdbcTemplate jdbc;

    public AuditRecordNames(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** "Leave_Request", "leave-request", "LEAVE REQUEST" all become "leaverequest". */
    static String normalize(String type) {
        return type == null ? "" : type.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    /** True when the type is one we can name. */
    public static boolean knows(String type) {
        return SOURCES.containsKey(normalize(type));
    }

    /**
     * Names for every ref we can resolve, keyed by "normalizedType:id". Must run
     * with the tenant bound (a request thread, or inside a transaction).
     */
    public Map<String, Named> resolve(Collection<Ref> refs) {
        Map<String, Set<UUID>> byType = new LinkedHashMap<>();
        for (Ref r : refs) {
            if (r == null || r.id() == null) continue;
            String t = normalize(r.type());
            if (SOURCES.containsKey(t)) byType.computeIfAbsent(t, k -> new LinkedHashSet<>()).add(r.id());
        }
        Map<String, Named> out = new HashMap<>();
        for (Map.Entry<String, Set<UUID>> e : byType.entrySet()) {
            Source src = SOURCES.get(e.getKey());
            List<UUID> ids = new ArrayList<>(e.getValue());
            try {
                String sql = src.sql().formatted(String.join(",", Collections.nCopies(ids.size(), "?")));
                jdbc.query(sql, rs -> {
                    UUID id = rs.getObject(1, UUID.class);
                    String name = rs.getString(2);
                    if (id != null && name != null && !name.isBlank()) {
                        out.put(key(e.getKey(), id), new Named(name.trim(), src.path().replace("{id}", id.toString())));
                    }
                }, ids.toArray());
            } catch (RuntimeException ex) {
                log.warn("Audit record names for {} not resolved: {}", e.getKey(), ex.getMessage());
            }
        }
        return out;
    }

    public static String key(String type, UUID id) {
        return normalize(type) + ":" + id;
    }

    /**
     * The "who" filter: blank means everyone; a user id is used as it is; an
     * email address is looked up (ignoring case) in this workspace. An email
     * that matches nobody matches no events, instead of being ignored.
     */
    public record ActorFilter(boolean any, UUID userId) {
        public boolean matchesNothing() { return !any && userId == null; }
    }

    public ActorFilter actor(String text) {
        if (text == null || text.isBlank()) return new ActorFilter(true, null);
        String t = text.trim();
        try {
            return new ActorFilter(false, UUID.fromString(t));
        } catch (IllegalArgumentException notAnId) {
            try {
                List<UUID> ids = jdbc.queryForList("SELECT id FROM auth.user_credentials WHERE lower(email) = lower(?)", UUID.class, t);
                return new ActorFilter(false, ids.isEmpty() ? null : ids.get(0));
            } catch (RuntimeException e) {
                log.warn("Audit actor lookup failed: {}", e.getMessage());
                return new ActorFilter(false, null);
            }
        }
    }
}
