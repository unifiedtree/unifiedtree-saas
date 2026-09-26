package com.hrms.api.workforce.search;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.api.workforce.search.GlobalSearchAccess.Reach;
import com.hrms.api.workforce.search.GlobalSearchDtos.GlobalSearchResponse;
import com.hrms.api.workforce.search.GlobalSearchDtos.SearchGroup;
import com.hrms.api.workforce.search.GlobalSearchDtos.SearchHit;
import com.hrms.api.workforce.search.GlobalSearchQueries.Scope;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchHit;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.Month;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The top bar's search: people, and the HR records the caller may open, each
 * linking to the page that shows it.
 *
 * <p>Permissions are decided here, on the server, per type ({@link GlobalSearchAccess});
 * the client only renders what comes back. Each type runs in its own read-only
 * transaction, so one failing lookup is reported in {@code unavailable} and the
 * rest still answer. Types whose workspace module is off are skipped, like their
 * endpoints ({@code TenantModuleGuard}).
 *
 * <p>Links: a record goes to the page that lists it with that page's search
 * already filled in where the page has one (people → Workforce Directory with
 * the query; payslips → the run's Employees tab searched by code; policies →
 * the policy list searched by title). Where the list has no search box the link
 * is the record's own page: an employee's leave, claims and documents open on
 * their workspace tab, a letter on its detail page, a candidate on their role's
 * pipeline. The caller's own records open their self-service page.
 */
@Service
public class GlobalSearchService {

    private static final Logger log = LoggerFactory.getLogger(GlobalSearchService.class);

    public static final int DEFAULT_LIMIT = 5;
    public static final int MAX_LIMIT = 10;
    /** The platform operator's own tenant: no workspace modules to check (TenantModuleGuard skips it too). */
    private static final UUID PLATFORM_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000000");

    private final GlobalSearchQueries queries;
    private final WorkforceEmployeeService employees;
    private final TeamEmployeeScope teamScope;
    private final TenantModuleLookup modules;
    private final TransactionTemplate tx;

    public GlobalSearchService(GlobalSearchQueries queries, WorkforceEmployeeService employees,
                               TeamEmployeeScope teamScope, TenantModuleLookup modules,
                               PlatformTransactionManager txManager) {
        this.queries = queries;
        this.employees = employees;
        this.teamScope = teamScope;
        this.modules = modules;
        this.tx = new TransactionTemplate(txManager);
        this.tx.setReadOnly(true);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** What the caller is: their permissions, their employee record (may be null) and their tenant. */
    record Caller(Set<String> perms, UUID employeeId, UUID tenantId, Jwt jwt) {
        boolean has(String code) { return perms.contains(code); }
        /** The employee workspace route opens for directory readers and managers (App.tsx /hrms/employees/:id). */
        boolean opensWorkspace() { return has("hrms.employee.read") || has("attendance.team.read"); }
    }

    public GlobalSearchResponse search(String rawQuery, int requestedLimit, Jwt jwt, Authentication auth, UUID tenantId) {
        SearchText text = SearchText.of(rawQuery);
        if (text.tooShort()) {
            throw new IllegalArgumentException("q must be at least " + SearchText.MIN_QUERY_CHARS + " characters");
        }
        int limit = Math.max(1, Math.min(requestedLimit, MAX_LIMIT));
        if (tenantId == null) return new GlobalSearchResponse(text.normalized(), List.of(), List.of());
        Caller caller = new Caller(authorities(auth), employeeId(jwt), tenantId, jwt);

        Map<String, Boolean> moduleOn = new HashMap<>();
        Team team = new Team(caller);
        List<SearchGroup> groups = new ArrayList<>();
        List<String> unavailable = new ArrayList<>();
        for (SearchType type : SearchType.values()) {
            Reach reach = GlobalSearchAccess.reach(type, caller.perms(), caller.employeeId() != null);
            if (reach == Reach.NONE) continue;
            // Asking for the type by name alone ("payslips") on a tenant-wide scope would list
            // the whole company's latest records; the page for it is offered instead.
            if (type == SearchType.PAYSLIP && reach == Reach.ALL && text.wordsFor(type).isEmpty()) continue;
            try {
                if (!moduleOn.computeIfAbsent(type.module, m -> moduleActive(caller.tenantId(), m))) continue;
                List<SearchHit> hits = tx.execute(status -> find(type, reach, text, limit, caller, team));
                if (hits != null && !hits.isEmpty()) groups.add(new SearchGroup(type.key, type.label, hits));
            } catch (RuntimeException e) {
                log.warn("Global search: {} lookup failed for tenant {}: {}", type.key, caller.tenantId(), e.toString());
                unavailable.add(type.key);
            }
        }
        return new GlobalSearchResponse(text.normalized(), groups, unavailable);
    }

    private boolean moduleActive(UUID tenantId, String module) {
        return PLATFORM_TENANT_ID.equals(tenantId) || modules.hasActiveModule(tenantId, module);
    }

    /** The caller's team, resolved once and only if a type needs it (the same scope as the employee workspace). */
    private final class Team {
        private final Caller caller;
        private Set<UUID> ids;
        Team(Caller caller) { this.caller = caller; }
        /** Their team plus themselves: EmployeeRecordAccess lets a manager read both. */
        Set<UUID> withSelf() {
            if (ids == null) {
                Set<UUID> s = new LinkedHashSet<>();
                try {
                    teamScope.resolve(caller.jwt(), null).stream().map(Employee::getId).filter(Objects::nonNull).forEach(s::add);
                } catch (IllegalArgumentException noEmployeeRecord) {
                    // No employee row behind the login: only their own id below, which matches nothing.
                }
                if (caller.employeeId() != null) s.add(caller.employeeId());
                ids = s;
            }
            return ids;
        }
    }

    private Scope scope(Reach reach, Caller caller, Team team) {
        return switch (reach) {
            case ALL, PUBLISHED -> Scope.EVERYONE;
            case TEAM -> Scope.only(team.withSelf());
            case OWN -> Scope.only(caller.employeeId() == null ? List.of() : List.of(caller.employeeId()));
            case NONE -> Scope.only(List.of());
        };
    }

    private List<SearchHit> find(SearchType type, Reach reach, SearchText text, int limit, Caller c, Team team) {
        List<String> words = text.wordsFor(type);
        UUID tenant = c.tenantId();
        return switch (type) {
            case EMPLOYEE -> people(text, limit);
            case LEAVE -> queries.leave(tenant, scope(reach, c, team), words, limit).stream().map(r -> leaveHit(r, c)).toList();
            case EXPENSE -> queries.expenses(tenant, scope(reach, c, team), words, limit).stream().map(r -> expenseHit(r, c)).toList();
            case PAYSLIP -> queries.payslips(tenant, scope(reach, c, team), words, limit).stream().map(r -> payslipHit(r, reach)).toList();
            case DOCUMENT -> queries.documents(tenant, scope(reach, c, team), words, limit).stream().map(r -> documentHit(r, c)).toList();
            case LETTER -> queries.letters(tenant, scope(reach, c, team), words, limit).stream().map(r -> letterHit(r, c)).toList();
            case CANDIDATE -> queries.candidates(tenant, words, limit).stream().map(GlobalSearchService::candidateHit).toList();
            case OFFER -> queries.offers(tenant, words, limit).stream().map(GlobalSearchService::offerHit).toList();
            case JOB -> queries.jobs(tenant, words, limit).stream().map(GlobalSearchService::jobHit).toList();
            case POLICY -> queries.policies(tenant, reach != Reach.ALL, words, limit).stream().map(r -> policyHit(r, reach)).toList();
        };
    }

    // ── people ──────────────────────────────────────────────────────────────

    /** The directory's own search (same gate, same scope); the link opens the directory filtered. */
    private List<SearchHit> people(SearchText text, int limit) {
        return employees.search(text.normalized(), limit).employees().stream().map(e -> personHit(e, text)).toList();
    }

    static SearchHit personHit(EmployeeSearchHit e, SearchText text) {
        String sub = joinNonBlank(" · ", e.employeeCode(), e.departmentName(), e.jobTitle());
        return new SearchHit(SearchType.EMPLOYEE.key, e.id().toString(), e.displayName(), sub,
                "/hrms/employees?q=" + enc(directoryQuery(e, text)), null);
    }

    /**
     * The Workforce Directory filters on name, code, email and designation as one
     * piece of text. Keep what was typed when the directory will find this person
     * with it; otherwise (a word-by-word match like "rah ver") use their code.
     */
    static String directoryQuery(EmployeeSearchHit e, SearchText text) {
        String q = text.normalized();
        String shown = (Objects.toString(e.displayName(), "") + " " + Objects.toString(e.employeeCode(), "") + " "
                + Objects.toString(e.jobTitle(), "")).toLowerCase(Locale.ROOT);
        if (q.contains("@") || shown.contains(q) || e.employeeCode() == null || e.employeeCode().isBlank()) return q;
        return e.employeeCode();
    }

    // ── records ─────────────────────────────────────────────────────────────

    private static final Map<String, String> LEAVE_STATUS = Map.of("PENDING", "Pending", "PENDING_L2", "Awaiting HR",
            "APPROVED", "Approved", "REJECTED", "Rejected", "CANCELLED", "Cancelled");

    static SearchHit leaveHit(GlobalSearchQueries.LeaveRow r, Caller c) {
        boolean mine = r.employeeId().equals(c.employeeId());
        String type = r.typeName() == null || r.typeName().isBlank() ? "Leave" : r.typeName();
        String when = joinNonBlank(" · ", range(r.start(), r.end()), days(r.days()));
        String url = mine ? "/hrms/leave?tab=my" : workspaceOr(c, r.employeeId(), "leave", "/hrms/leave?tab=history");
        return new SearchHit(SearchType.LEAVE.key, r.id().toString(),
                mine ? type : r.employeeName() + " · " + type,
                mine ? when : joinNonBlank(" · ", when, r.employeeCode()),
                url, LEAVE_STATUS.getOrDefault(r.status(), pretty(r.status())));
    }

    static SearchHit expenseHit(GlobalSearchQueries.ExpenseRow r, Caller c) {
        boolean mine = r.employeeId().equals(c.employeeId());
        String title = r.title() == null || r.title().isBlank() ? "Expense claim" : r.title();
        String url = mine ? "/hrms/expenses?tab=my" : workspaceOr(c, r.employeeId(), "expenses", "/hrms/expenses");
        return new SearchHit(SearchType.EXPENSE.key, r.id().toString(), title,
                mine ? day(r.on()) : joinNonBlank(" · ", r.employeeName(), r.employeeCode(), day(r.on())),
                url, pretty(r.status()));
    }

    static SearchHit payslipHit(GlobalSearchQueries.PayslipRow r, Reach reach) {
        String period = Month.of(r.month()).getDisplayName(TextStyle.FULL, Locale.ENGLISH) + " " + r.year();
        if (reach != Reach.ALL) {
            return new SearchHit(SearchType.PAYSLIP.key, r.runId() + ":" + r.employeeId(), "Payslip · " + period,
                    "Your payslip", "/me/payslips", null);
        }
        String code = r.employeeCode() == null ? r.employeeName() : r.employeeCode();
        return new SearchHit(SearchType.PAYSLIP.key, r.runId() + ":" + r.employeeId(), "Payslip · " + period,
                joinNonBlank(" · ", r.employeeName(), r.employeeCode()),
                "/hrms/payroll/runs/" + r.runId() + "?tab=employees&q=" + enc(code), pretty(r.status()));
    }

    private static final Map<String, String> VERIFICATION = Map.of("VERIFIED", "Verified", "PENDING", "Waiting for review", "REJECTED", "Rejected");

    static SearchHit documentHit(GlobalSearchQueries.DocumentRow r, Caller c) {
        boolean mine = r.employeeId().equals(c.employeeId());
        String kind = r.typeName() != null && !r.typeName().isBlank() ? r.typeName() : pretty(r.category());
        String url = mine ? "/hrms/documents?view=my" : workspaceOr(c, r.employeeId(), "documents", "/hrms/documents?view=all");
        return new SearchHit(SearchType.DOCUMENT.key, r.id().toString(), r.title(),
                mine ? kind : joinNonBlank(" · ", kind, r.employeeName(), r.employeeCode()),
                url, r.verification() == null ? null : VERIFICATION.getOrDefault(r.verification(), pretty(r.verification())));
    }

    static SearchHit letterHit(GlobalSearchQueries.LetterRow r, Caller c) {
        boolean mine = r.employeeId() != null && r.employeeId().equals(c.employeeId());
        String kind = pretty(r.type()) + " letter";
        return new SearchHit(SearchType.LETTER.key, r.id().toString(), r.subject() == null ? kind : r.subject(),
                mine ? joinNonBlank(" · ", kind, day(r.on())) : joinNonBlank(" · ", kind, r.employeeName(), r.employeeCode(), day(r.on())),
                "/hrms/letters/generated/" + r.id(), pretty(r.status()));
    }

    static SearchHit candidateHit(GlobalSearchQueries.CandidateRow r) {
        String url = r.requisitionId() == null ? "/hrms/hiring?tab=pipeline" : "/hrms/hiring?tab=pipeline&role=" + r.requisitionId();
        return new SearchHit(SearchType.CANDIDATE.key, r.id().toString(), r.name(), r.jobTitle(), url, pretty(r.stage()));
    }

    static SearchHit offerHit(GlobalSearchQueries.OfferRow r) {
        return new SearchHit(SearchType.OFFER.key, r.id().toString(), r.candidateName(), r.roleTitle(), "/hrms/hiring?tab=offers", pretty(r.status()));
    }

    static SearchHit jobHit(GlobalSearchQueries.JobRow r) {
        String openings = r.openings() == null ? null : r.openings() + (r.openings() == 1 ? " opening" : " openings");
        return new SearchHit(SearchType.JOB.key, r.id().toString(), r.title(),
                joinNonBlank(" · ", r.departmentName(), r.location(), openings),
                "/hrms/hiring?tab=pipeline&role=" + r.id(), pretty(r.status()));
    }

    static SearchHit policyHit(GlobalSearchQueries.PolicyRow r, Reach reach) {
        String tab = r.status() == null ? "Active" : switch (r.status()) {
            case "DRAFT" -> "Draft";
            case "ARCHIVED" -> "Archived";
            default -> "Active";
        };
        String url = "/hrms/policies?q=" + enc(r.title() == null ? "" : r.title()) + "&status=" + tab + "&policy=" + r.id();
        String sub = joinNonBlank(" · ", pretty(r.category()), r.version() == null ? null : "v" + r.version(),
                r.effective() == null ? null : "effective " + day(r.effective()));
        return new SearchHit(SearchType.POLICY.key, r.id().toString(), r.title(), sub, url,
                reach == Reach.ALL && !"ACTIVE".equals(r.status()) ? tab : null);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** Someone else's record: their employee workspace tab, or the list page when the caller can't open workspaces. */
    private static String workspaceOr(Caller c, UUID employeeId, String tab, String fallback) {
        return c.opensWorkspace() ? "/hrms/employees/" + employeeId + "?tab=" + tab : fallback;
    }

    static Set<String> authorities(Authentication auth) {
        if (auth == null) return Set.of();
        return auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).filter(Objects::nonNull).collect(Collectors.toUnmodifiableSet());
    }

    static UUID employeeId(Jwt jwt) {
        if (jwt == null) return null;
        String raw = jwt.getClaimAsString("employee_id");
        if (raw == null || raw.isBlank()) return null;
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException malformed) {
            return null;
        }
    }

    static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /** "ID_PROOF" → "Id proof"; null stays null. */
    static String pretty(String code) {
        if (code == null || code.isBlank()) return null;
        String s = code.replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    static String day(LocalDate d) {
        return d == null ? null : d.getDayOfMonth() + " " + Month.of(d.getMonthValue()).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + d.getYear();
    }

    static String range(LocalDate a, LocalDate b) {
        if (a == null) return null;
        if (b == null || b.equals(a)) return day(a);
        String end = day(b);
        if (a.getYear() != b.getYear()) return day(a) + " – " + end;
        return a.getDayOfMonth() + " " + Month.of(a.getMonthValue()).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " – " + end;
    }

    static String days(Double n) {
        if (n == null) return null;
        String v = n == Math.rint(n) ? String.valueOf(n.longValue()) : String.valueOf(n);
        return v + (n == 1.0 ? " day" : " days");
    }

    static String joinNonBlank(String sep, String... parts) {
        String s = java.util.Arrays.stream(parts).filter(p -> p != null && !p.isBlank()).collect(Collectors.joining(sep));
        return s.isEmpty() ? null : s;
    }
}
