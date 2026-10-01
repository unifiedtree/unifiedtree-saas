package com.hrms.api.workforce;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The org chart (GET /v1/hrms/org-chart): the reporting lines of
 * {@code hrms.employees}, read with JDBC, tenant-scoped (and RLS).
 * <ul>
 *   <li>With {@code hrms.employee.read}: the whole tree of one company (the one
 *       asked for, else the caller's own, else the workspace's first).</li>
 *   <li>Everyone else: their own line only, from the top down to them, and
 *       everyone below them ({@link OrgChartScope#team}).</li>
 * </ul>
 * Active people only (not EXITED or TERMINATED, and not removed). Each card
 * carries public fields: name, designation, department, branch, photo and the
 * number of direct reports. The employment status is added only where the
 * viewer may already open that person's record (their own, everyone's with
 * hrms.employee.read, their direct reports' with hrms.employee.team.manage:
 * {@link WorkforceAccess#recordView}).
 */
@Service
public class OrgChartService {

    private static final Logger log = LoggerFactory.getLogger(OrgChartService.class);

    static final String EMPLOYEE_READ = "hrms.employee.read";
    static final String TEAM_MANAGE = "hrms.employee.team.manage";

    /** The chart: whose it is and the people on it, parents before their reports. */
    public record OrgChart(String scope, UUID companyId, String companyName, UUID viewerEmployeeId,
                           boolean truncated, List<Person> people) {
    }

    /**
     * One card. {@code parentId} is the person drawn above (null: top level);
     * {@code note} says why someone with a stored manager sits at the top level
     * (MANAGER_NOT_SHOWN, CYCLE). {@code status} is null where the viewer may
     * not see it; {@code canViewRecord} says whether the viewer may open the
     * person's employee record.
     */
    public record Person(UUID id, String name, String designation, String department, String location,
                         String photoUrl, String status, UUID parentId, int directReports, String relation,
                         String note, boolean canViewRecord) {
    }

    /** Card fields read for the people on the chart. */
    record Card(String name, String designation, String department, String location, String photoUrl, String status) {
    }

    private final JdbcTemplate jdbc;
    private final PermissionChecker perm;

    public OrgChartService(JdbcTemplate jdbc, @Autowired(required = false) PermissionChecker perm) {
        this.jdbc = jdbc;
        this.perm = perm;
    }

    @Transactional(readOnly = true)
    public OrgChart chart(UUID requestedCompanyId, Jwt jwt, Authentication auth) {
        UUID tenant = TenantContext.requireTenantId();
        UUID viewer = WorkforceAccess.employeeId(jwt);
        boolean wholeCompany = has(auth, EMPLOYEE_READ);
        boolean teamManage = has(auth, TEAM_MANAGE) || checks(TEAM_MANAGE);

        return FeatureNotReady.guard(() -> {
            List<OrgChartScope.Link> people = activePeople(tenant);
            Map<UUID, OrgChartScope.Link> byId = new HashMap<>();
            people.forEach(l -> byId.put(l.id(), l));

            OrgChartScope.Result placed;
            String scope;
            UUID companyId;
            String companyName;
            if (wholeCompany) {
                scope = "COMPANY";
                UUID mine = viewer != null && byId.containsKey(viewer) ? byId.get(viewer).companyId() : null;
                Map.Entry<UUID, String> company = company(tenant, requestedCompanyId, mine);
                companyId = company == null ? null : company.getKey();
                companyName = company == null ? null : company.getValue();
                placed = companyId == null ? new OrgChartScope.Result(List.of(), false) : OrgChartScope.company(people, companyId);
            } else {
                scope = "TEAM";
                placed = OrgChartScope.team(people, viewer);
                companyId = viewer != null && byId.containsKey(viewer) ? byId.get(viewer).companyId() : null;
                companyName = companyId == null ? null : companyName(tenant, companyId);
            }

            Map<UUID, Integer> reports = OrgChartScope.directReportCounts(people);
            Map<UUID, Card> cards = cards(tenant, placed.people().stream().map(OrgChartScope.Placed::id).toList());
            List<Person> out = new ArrayList<>(placed.people().size());
            for (OrgChartScope.Placed p : placed.people()) {
                Card c = cards.get(p.id());
                if (c == null) continue;   // removed between the two reads
                OrgChartScope.Link l = byId.get(p.id());
                boolean self = p.id().equals(viewer);
                boolean canView = self || WorkforceAccess.recordView(wholeCompany, teamManage, viewer, l == null ? null : l.managerId())
                        != WorkforceAccess.RecordView.DENIED;
                out.add(new Person(p.id(), c.name(), c.designation(), c.department(), c.location(), c.photoUrl(),
                        canView ? c.status() : null, p.parentId(), reports.getOrDefault(p.id(), 0),
                        p.relation() == null ? null : p.relation().name(), p.note() == null ? null : p.note().name(), canView));
            }
            return new OrgChart(scope, companyId, companyName, viewer, placed.truncated(), out);
        });
    }

    /** Everyone active in the workspace, with who they report to: the edges of the tree. */
    List<OrgChartScope.Link> activePeople(UUID tenant) {
        return jdbc.query("""
                SELECT e.id, e.reporting_manager_id, e.company_id, e.first_name, e.last_name
                  FROM hrms.employees e
                 WHERE e.tenant_id = ? AND e.is_active = TRUE
                   AND e.employment_status NOT IN ('EXITED', 'TERMINATED')
                """, (rs, i) -> new OrgChartScope.Link(
                        rs.getObject("id", UUID.class), rs.getObject("reporting_manager_id", UUID.class),
                        rs.getObject("company_id", UUID.class), fullName(rs.getString("first_name"), rs.getString("last_name"))),
                tenant);
    }

    /**
     * The company shown on the company view: the one asked for (refused when it
     * isn't in this workspace), else the caller's own, else the workspace's
     * first (active ones first). Null when the workspace has none.
     */
    Map.Entry<UUID, String> company(UUID tenant, UUID requested, UUID callersOwn) {
        if (requested != null) {
            String name = companyName(tenant, requested);
            if (name == null) throw new BusinessRuleException("That company isn’t in this workspace.", "ORG_CHART_COMPANY_NOT_FOUND");
            return Map.entry(requested, name);
        }
        if (callersOwn != null) {
            String name = companyName(tenant, callersOwn);
            if (name != null) return Map.entry(callersOwn, name);
        }
        List<Map.Entry<UUID, String>> first = jdbc.query("""
                SELECT c.id, c.name FROM org.companies c
                 WHERE c.tenant_id = ?
                 ORDER BY c.is_active DESC, c.created_at, c.name
                 LIMIT 1
                """, (rs, i) -> Map.entry(rs.getObject("id", UUID.class), nonBlank(rs.getString("name"), "Company")), tenant);
        return first.isEmpty() ? null : first.get(0);
    }

    /** The company's name; null when it isn't in this workspace. */
    String companyName(UUID tenant, UUID companyId) {
        List<String> names = jdbc.query("SELECT c.name FROM org.companies c WHERE c.tenant_id = ? AND c.id = ?",
                (rs, i) -> nonBlank(rs.getString("name"), "Company"), tenant, companyId);
        return names.isEmpty() ? null : names.get(0);
    }

    /** The card fields of these people (none of pay, bank, identity or contact details). */
    Map<UUID, Card> cards(UUID tenant, Collection<UUID> ids) {
        Map<UUID, Card> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        List<Map.Entry<UUID, Card>> rows = jdbc.query("""
                SELECT e.id, e.first_name, e.last_name, e.profile_photo_url, e.employment_status,
                       COALESCE(g.title, e.job_title) AS designation_name, d.name AS department_name,
                       COALESCE(b.name, e.work_location) AS location_name
                  FROM hrms.employees e
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id
                  LEFT JOIN hrms.departments  d ON d.id = e.department_id
                  LEFT JOIN org.branches      b ON b.id = e.branch_id
                 WHERE e.tenant_id = ? AND e.id = ANY(CAST(? AS uuid[]))
                """, (rs, i) -> Map.entry(rs.getObject("id", UUID.class), new Card(
                        fullName(rs.getString("first_name"), rs.getString("last_name")),
                        blankToNull(rs.getString("designation_name")), blankToNull(rs.getString("department_name")),
                        blankToNull(rs.getString("location_name")), photo(rs.getString("profile_photo_url")),
                        rs.getString("employment_status"))),
                tenant, uuidArray(ids));
        rows.forEach(r -> out.put(r.getKey(), r.getValue()));
        return out;
    }

    /** A Postgres uuid[] literal, bound as one parameter and cast in SQL. */
    static String uuidArray(Collection<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }

    /** First and last name, as the app shows people everywhere; "Employee" when both are blank. */
    static String fullName(String first, String last) {
        String n = ((first == null ? "" : first.trim()) + " " + (last == null ? "" : last.trim())).trim();
        return n.isEmpty() ? "Employee" : n;
    }

    /** A photo only when it is a web address; anything else shows initials. */
    static String photo(String url) {
        if (url == null) return null;
        String t = url.trim();
        return t.startsWith("https://") || t.startsWith("http://") ? t : null;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String nonBlank(String s, String fallback) {
        return s == null || s.isBlank() ? fallback : s.trim();
    }

    private static boolean has(Authentication auth, String authority) {
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    /** The permission from the database (@perm), as GET /v1/hrms/employees/{id} also accepts it; false when the lookup fails. */
    private boolean checks(String permission) {
        if (perm == null) return false;
        try {
            return perm.check(permission);
        } catch (RuntimeException e) {
            log.warn("Permission lookup for {} failed; treating it as not held: {}", permission, e.getMessage());
            return false;
        }
    }
}
