package com.hrms.api.document;

import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.UUID;

/**
 * Document counts for the vault and the review queue (redesign BW-77), worked
 * out by the database over every document, not the page on screen.
 *
 * <ul>
 *   <li>"Expired": the expiry date has passed (India time). "Expiring soon":
 *       it expires today or within the next {@value #SOON_DAYS} days. Rejected
 *       documents are not counted in either: they need a new copy anyway.</li>
 *   <li>"This week" starts on Monday, India time.</li>
 * </ul>
 * Reads existing columns only (no migration).
 */
@RestController
@RequestMapping("/v1/document")
@Tag(name = "Document", description = "Employee document vault — upload, browse, and self-service access")
@SecurityRequirement(name = "bearerAuth")
public class DocumentSummaryController {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final int SOON_DAYS = 30;
    /** How many document names a summary lists (the design names the expired ones). */
    static final int NAMES = 5;

    /**
     * Counts for a set of documents. {@code people}: how many people have
     * documents on file (workspace only). {@code waitingForReview}: only for
     * people who review documents (null otherwise). The title lists name the
     * soonest-expiring and the expired documents, at most five each.
     * {@code departmentName}: the person's department (one person's summary only).
     */
    public record Summary(long onFile, long expiringSoon, long expired, Long people, Long waitingForReview,
                          long waitingForHr, long rejected, List<String> expiringTitles, List<String> expiredTitles,
                          String departmentName) {}

    /** The review queue's counts. */
    public record ReviewSummary(long waiting, long verifiedThisWeek, long rejectedThisWeek) {}

    private final JdbcTemplate jdbc;

    public DocumentSummaryController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Operation(summary = "Counts across every employee's documents (on file, expiring, expired, people)")
    @GetMapping("/summary")
    @PreAuthorize("hasAuthority('hrms.document.read')")
    @Transactional(readOnly = true)
    public Summary workspace(@AuthenticationPrincipal Jwt jwt) {
        UUID tenant = TenantContext.requireTenantId();
        Summary s = summarise(tenant, null);
        Long people = jdbc.queryForObject("SELECT count(DISTINCT employee_id) FROM document_mgmt.employee_documents WHERE tenant_id = ?",
                Long.class, tenant);
        Long waiting = has(jwt, "hrms.document.verify") ? s.waitingForHr() : null;
        return new Summary(s.onFile(), s.expiringSoon(), s.expired(), people, waiting, s.waitingForHr(), s.rejected(),
                s.expiringTitles(), s.expiredTitles(), null);
    }

    @Operation(summary = "Counts across my own documents")
    @GetMapping("/my/summary")
    @PreAuthorize("hasAuthority('hrms.document.read.self')")
    @Transactional(readOnly = true)
    public Summary mine(@AuthenticationPrincipal Jwt jwt) {
        UUID me = employeeId(jwt);
        if (me == null) return new Summary(0, 0, 0, null, null, 0, 0, List.of(), List.of(), null);
        return summarise(TenantContext.requireTenantId(), me);
    }

    @Operation(summary = "Counts across one employee's documents")
    @GetMapping("/employee/{employeeId}/summary")
    @PreAuthorize("hasAuthority('hrms.document.read')")
    @Transactional(readOnly = true)
    public Summary employee(@PathVariable UUID employeeId) {
        UUID tenant = TenantContext.requireTenantId();
        Summary s = summarise(tenant, employeeId);
        List<String> dept = jdbc.queryForList("""
                SELECT d.name FROM hrms.employees e
                  JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.id = ?""", String.class, tenant, employeeId);
        return new Summary(s.onFile(), s.expiringSoon(), s.expired(), null, null, s.waitingForHr(), s.rejected(),
                s.expiringTitles(), s.expiredTitles(), dept.isEmpty() ? null : dept.get(0));
    }

    @Operation(summary = "The review queue: waiting, verified this week, rejected this week")
    @GetMapping("/pending/summary")
    @PreAuthorize("hasAuthority('hrms.document.verify')")
    @Transactional(readOnly = true)
    public ReviewSummary review() {
        UUID tenant = TenantContext.requireTenantId();
        return jdbc.queryForObject("""
                SELECT count(*) FILTER (WHERE verification_status = 'PENDING') AS waiting,
                       count(*) FILTER (WHERE verification_status = 'VERIFIED' AND verified_at >= ?) AS verified,
                       count(*) FILTER (WHERE verification_status = 'REJECTED' AND verified_at >= ?) AS rejected
                  FROM document_mgmt.employee_documents
                 WHERE tenant_id = ?
                """, (rs, n) -> new ReviewSummary(rs.getLong("waiting"), rs.getLong("verified"), rs.getLong("rejected")),
                weekStart(ZonedDateTime.now(IST)), weekStart(ZonedDateTime.now(IST)), tenant);
    }

    /** Monday 00:00, India time, of the week {@code now} is in. */
    static java.sql.Timestamp weekStart(ZonedDateTime now) {
        ZonedDateTime monday = now.withZoneSameInstant(IST).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).atStartOfDay(IST);
        return java.sql.Timestamp.from(monday.toInstant());
    }

    private Summary summarise(UUID tenant, UUID employeeId) {
        LocalDate today = LocalDate.now(IST);
        LocalDate soon = today.plusDays(SOON_DAYS);
        String who = employeeId == null ? "" : " AND employee_id = ?";
        Object[] args = employeeId == null
                ? new Object[]{soon, today, today, tenant}
                : new Object[]{soon, today, today, tenant, employeeId};
        long[] c = jdbc.queryForObject("""
                SELECT count(*) AS on_file,
                       count(*) FILTER (WHERE expiry_date IS NOT NULL AND coalesce(verification_status, '') <> 'REJECTED'
                                          AND expiry_date <= ? AND expiry_date >= ?) AS soon,
                       count(*) FILTER (WHERE expiry_date IS NOT NULL AND coalesce(verification_status, '') <> 'REJECTED'
                                          AND expiry_date < ?) AS expired,
                       count(*) FILTER (WHERE verification_status = 'PENDING') AS waiting,
                       count(*) FILTER (WHERE verification_status = 'REJECTED') AS rejected
                  FROM document_mgmt.employee_documents
                 WHERE tenant_id = ?""" + who,
                (rs, n) -> new long[]{rs.getLong("on_file"), rs.getLong("soon"), rs.getLong("expired"),
                        rs.getLong("waiting"), rs.getLong("rejected")}, args);
        Object[] nameArgs = employeeId == null ? new Object[]{tenant} : new Object[]{tenant, employeeId};
        List<String> expiring = c[1] == 0 ? List.of() : jdbc.queryForList("""
                SELECT title FROM document_mgmt.employee_documents
                 WHERE tenant_id = ?""" + who + """
                   AND expiry_date IS NOT NULL AND coalesce(verification_status, '') <> 'REJECTED'
                   AND expiry_date >= ? AND expiry_date <= ?
                 ORDER BY expiry_date, title LIMIT ?""", String.class, concat(nameArgs, today, soon, NAMES));
        List<String> expired = c[2] == 0 ? List.of() : jdbc.queryForList("""
                SELECT title FROM document_mgmt.employee_documents
                 WHERE tenant_id = ?""" + who + """
                   AND expiry_date IS NOT NULL AND coalesce(verification_status, '') <> 'REJECTED'
                   AND expiry_date < ?
                 ORDER BY expiry_date DESC, title LIMIT ?""", String.class, concat(nameArgs, today, NAMES));
        return new Summary(c[0], c[1], c[2], null, null, c[3], c[4], expiring, expired, null);
    }

    private static Object[] concat(Object[] a, Object... b) {
        Object[] out = java.util.Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static boolean has(Jwt jwt, String permission) {
        List<String> perms = jwt == null ? null : jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains(permission);
    }

    private static UUID employeeId(Jwt jwt) {
        String claim = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try {
            return UUID.fromString(claim);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
