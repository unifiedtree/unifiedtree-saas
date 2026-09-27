package com.hrms.api.onboarding;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.OnboardingAsset;
import com.hrms.employee.service.OnboardingService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Asset confirmations and problem reports (redesign BW-70), and the extra
 * fields on HR's asset list (BW-69, BW-70).
 *
 * <ul>
 *   <li>An employee confirms they received an asset, or reports a problem with
 *       it (lost, damaged, not working, other). Only the person the asset is
 *       with now can do either.</li>
 *   <li>A report notifies the people who manage assets
 *       ({@code hrms.onboarding.asset.write}) with {@code assets.issue_reported},
 *       after it commits, and stays open until one of them resolves it.</li>
 *   <li>Holder names on the asset list are for callers who may read employee
 *       records ({@code hrms.employee.read}) only.</li>
 * </ul>
 * hrms.asset_confirmations and hrms.asset_issue_reports (V143.59) are JDBC-only.
 * Until they exist, the reads leave the new fields empty and the actions answer
 * FEATURE_NOT_READY; the tables are looked up first, so the caller's
 * transaction is never aborted by a missing table.
 */
@Service
public class AssetCareService {

    private static final Logger log = LoggerFactory.getLogger(AssetCareService.class);

    static final String CONFIRMATIONS = "hrms.asset_confirmations";
    static final String ISSUES = "hrms.asset_issue_reports";
    static final Set<String> KINDS = Set.of("LOST", "DAMAGED", "NOT_WORKING", "OTHER");
    static final int NOTE_MAX = 1000;
    /** At most this many people are notified about one report. */
    static final int MAX_RECIPIENTS = 25;
    static final String MANAGE_PERMISSION = "hrms.onboarding.asset.write";

    private final JdbcTemplate jdbc;
    private final OnboardingService onboarding;
    private final ApplicationEventPublisher events;
    private final AuditService audit;

    public AssetCareService(JdbcTemplate jdbc, OnboardingService onboarding, ApplicationEventPublisher events, AuditService audit) {
        this.jdbc = jdbc;
        this.onboarding = onboarding;
        this.events = events;
        this.audit = audit;
    }

    /** A problem report as HR's list and the employee see it. {@code employeeName} only with employee read. */
    public record Issue(UUID id, UUID assetId, String assetTag, String assetName, String assetType, UUID companyId,
                        UUID employeeId, String employeeName, String kind, String note, String status,
                        Instant reportedAt, Instant resolvedAt, String resolvedByName, String resolutionNote) {}

    /** What confirming or reporting knows about the asset the caller holds. */
    record Held(UUID assetId, String assetTag, String assetName, UUID allocationId) {}

    // ── HR: the asset list ───────────────────────────────────────────────────

    /**
     * Today's asset list plus holder names (only when {@code withNames}),
     * confirmation and open problem. Names are never read without permission.
     */
    @Transactional(readOnly = true)
    public List<OnboardingViews.AssetView> listAssets(UUID companyId, boolean withNames) {
        List<OnboardingAsset> assets = onboarding.listAssets(companyId);
        if (assets.isEmpty()) return List.of();
        UUID tenant = TenantContext.requireTenantId();

        Map<UUID, String> names = withNames
                ? employeeNames(tenant, assets.stream().map(OnboardingAsset::getEmployeeId).filter(Objects::nonNull).distinct().toList())
                : Map.of();

        boolean confirmations = present(CONFIRMATIONS);
        Map<UUID, Object[]> openHandOver = new HashMap<>(); // asset -> {confirmedAt, source}
        if (confirmations) {
            jdbc.query("""
                    SELECT al.asset_id, c.confirmed_at, c.source
                      FROM hrms.asset_allocations al
                      LEFT JOIN hrms.asset_confirmations c ON c.allocation_id = al.id AND c.tenant_id = al.tenant_id
                     WHERE al.tenant_id = ? AND al.returned_at IS NULL
                    """, (RowCallbackHandler) rs -> openHandOver.put(rs.getObject("asset_id", UUID.class),
                    new Object[]{instant(rs.getTimestamp("confirmed_at")), rs.getString("source")}), tenant);
        }
        Map<UUID, OnboardingViews.IssueBrief> open = openIssues(tenant, null);

        List<OnboardingViews.AssetView> out = new ArrayList<>(assets.size());
        for (OnboardingAsset a : assets) {
            boolean assigned = "ASSIGNED".equals(a.getStatus());
            String person = a.getEmployeeId() == null ? null : names.get(a.getEmployeeId());
            Instant confirmedAt = null;
            String source = null;
            Boolean pending = null;
            if (confirmations && assigned) {
                Object[] handOver = openHandOver.get(a.getId());
                if (handOver != null) {
                    confirmedAt = (Instant) handOver[0];
                    source = (String) handOver[1];
                    pending = confirmedAt == null;
                } else {
                    pending = false; // handed over before hand-overs were recorded: nothing to confirm
                }
            }
            out.add(new OnboardingViews.AssetView(a, assigned ? person : null, assigned ? null : person,
                    confirmedAt, source, pending, open.get(a.getId())));
        }
        return out;
    }

    // ── HR: problem reports ──────────────────────────────────────────────────

    /** Reports by status (OPEN by default, RESOLVED, or ALL), newest first, at most 500. */
    @Transactional(readOnly = true)
    public List<Issue> issues(String status, UUID companyId, boolean withNames) {
        String s = status == null || status.isBlank() ? "OPEN" : status.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("OPEN", "RESOLVED", "ALL").contains(s))
            throw new BusinessRuleException("Status must be OPEN, RESOLVED or ALL", "ASSET_ISSUE_STATUS_INVALID");
        UUID tenant = TenantContext.requireTenantId();
        requirePresent(ISSUES);
        List<Object> args = new ArrayList<>();
        args.add(withNames);
        args.add(tenant);
        StringBuilder where = new StringBuilder(" WHERE r.tenant_id = ?");
        if (!"ALL".equals(s)) { where.append(" AND r.status = ?"); args.add(s); }
        if (companyId != null) { where.append(" AND a.company_id = ?"); args.add(companyId); }
        return FeatureNotReady.guard(() -> jdbc.query(ISSUE_SELECT + where + " ORDER BY r.reported_at DESC LIMIT 500",
                ISSUE_ROW, args.toArray()));
    }

    /** HR marks a report resolved, with an optional note. */
    @Transactional
    public Issue resolve(UUID issueId, String note, String resolvedByName, boolean withNames) {
        UUID tenant = TenantContext.requireTenantId();
        requirePresent(ISSUES);
        String clean = cleanNote(note);
        return FeatureNotReady.guard(() -> {
            List<String> status = jdbc.queryForList(
                    "SELECT status FROM hrms.asset_issue_reports WHERE tenant_id = ? AND id = ? FOR UPDATE",
                    String.class, tenant, issueId);
            if (status.isEmpty()) throw new com.hrms.core.exception.ResourceNotFoundException("AssetIssueReport", issueId);
            if (!"OPEN".equals(status.get(0)))
                throw new HrmsException("This problem is already resolved.", HttpStatus.CONFLICT, "ASSET_ISSUE_ALREADY_RESOLVED");
            jdbc.update("""
                    UPDATE hrms.asset_issue_reports
                       SET status = 'RESOLVED', resolved_at = now(), resolved_by_user_id = ?, resolved_by_name = ?,
                           resolution_note = ?
                     WHERE tenant_id = ? AND id = ?
                    """, TenantContext.getUserId(), truncate(resolvedByName, 200), clean, tenant, issueId);
            Issue issue = jdbc.query(ISSUE_SELECT + " WHERE r.tenant_id = ? AND r.id = ?", ISSUE_ROW, withNames, tenant, issueId).get(0);
            record("ASSET_ISSUE_RESOLVED", issue.assetId(), "Resolved the " + describe(issue.kind()) + " report on "
                    + label(issue.assetName(), issue.assetTag()));
            return issue;
        });
    }

    // ── Employee: confirm and report ─────────────────────────────────────────

    /**
     * The holder confirms they received the asset. Confirming again changes
     * nothing. Refused for someone the asset is not with, and for a hand-over
     * recorded before hand-overs were tracked (it needs no confirmation).
     */
    @Transactional
    public void confirm(UUID employeeId, UUID assetId) {
        UUID tenant = TenantContext.requireTenantId();
        requirePresent(CONFIRMATIONS);
        Held held = heldBy(tenant, employeeId, assetId);
        if (held.allocationId() == null)
            throw new HrmsException("This asset was handed over before confirmations started, so there is nothing to confirm.",
                    HttpStatus.CONFLICT, "ASSET_NOTHING_TO_CONFIRM");
        FeatureNotReady.run(() -> jdbc.update("""
                INSERT INTO hrms.asset_confirmations (tenant_id, allocation_id, asset_id, employee_id, confirmed_at, source)
                VALUES (?, ?, ?, ?, now(), 'EMPLOYEE')
                ON CONFLICT (allocation_id) DO NOTHING
                """, tenant, held.allocationId(), assetId, employeeId));
    }

    /**
     * The holder reports a problem. One open report per asset: a second one is
     * refused until HR resolves the first. The people who manage assets are
     * notified once the report is saved.
     */
    @Transactional
    public Issue report(UUID employeeId, UUID assetId, String kind, String note) {
        String k = kind == null ? "" : kind.trim().toUpperCase(Locale.ROOT);
        if (!KINDS.contains(k))
            throw new BusinessRuleException("Choose what is wrong: lost, damaged, not working or something else", "ASSET_ISSUE_KIND_INVALID");
        String clean = cleanNote(note);
        UUID tenant = TenantContext.requireTenantId();
        requirePresent(ISSUES);
        Held held = heldBy(tenant, employeeId, assetId);
        return FeatureNotReady.guard(() -> {
            Integer open = jdbc.queryForObject(
                    "SELECT count(*) FROM hrms.asset_issue_reports WHERE tenant_id = ? AND asset_id = ? AND status = 'OPEN'",
                    Integer.class, tenant, assetId);
            if (open != null && open > 0)
                throw new HrmsException("A problem with this asset is already reported and waiting for HR.",
                        HttpStatus.CONFLICT, "ASSET_ISSUE_ALREADY_OPEN");
            UUID id = jdbc.queryForObject("""
                    INSERT INTO hrms.asset_issue_reports
                        (tenant_id, asset_id, allocation_id, employee_id, kind, note, status, reported_at, reported_by_user_id)
                    VALUES (?, ?, ?, ?, ?, ?, 'OPEN', now(), ?)
                    RETURNING id
                    """, UUID.class, tenant, assetId, held.allocationId(), employeeId, k, clean, TenantContext.getUserId());
            Issue issue = jdbc.query(ISSUE_SELECT + " WHERE r.tenant_id = ? AND r.id = ?", ISSUE_ROW, true, tenant, id).get(0);
            List<UUID> recipients = assetManagers(tenant, employeeId);
            events.publishEvent(new AssetIssueReportedEvent(tenant, issue.id(), assetId, employeeId,
                    issue.employeeName() == null ? "An employee" : issue.employeeName(),
                    label(held.assetName(), held.assetTag()), k, clean, recipients));
            record("ASSET_ISSUE_REPORTED", assetId, "Reported the asset " + label(held.assetName(), held.assetTag())
                    + " as " + describe(k));
            return issue;
        });
    }

    // ── Employee: fields on My assets ────────────────────────────────────────

    /** Confirmation of the caller's open hand-overs, by allocation id; empty while V143.59 is not applied. */
    @Transactional(readOnly = true)
    public Map<UUID, Instant> confirmationsOf(UUID employeeId) {
        Map<UUID, Instant> out = new HashMap<>();
        if (employeeId == null || !present(CONFIRMATIONS)) return out;
        jdbc.query("SELECT allocation_id, confirmed_at FROM hrms.asset_confirmations WHERE tenant_id = ? AND employee_id = ?",
                (RowCallbackHandler) rs -> out.put(rs.getObject("allocation_id", UUID.class), instant(rs.getTimestamp("confirmed_at"))),
                TenantContext.requireTenantId(), employeeId);
        return out;
    }

    /** Open reports on these assets (all assets when null), by asset id; empty while V143.59 is not applied. */
    @Transactional(readOnly = true)
    public Map<UUID, OnboardingViews.IssueBrief> openIssues(UUID tenant, Collection<UUID> assetIds) {
        Map<UUID, OnboardingViews.IssueBrief> out = new HashMap<>();
        if (!present(ISSUES) || (assetIds != null && assetIds.isEmpty())) return out;
        List<Object> args = new ArrayList<>();
        args.add(tenant);
        String in = "";
        if (assetIds != null) {
            in = " AND asset_id IN (" + String.join(",", Collections.nCopies(assetIds.size(), "?")) + ")";
            args.addAll(assetIds);
        }
        jdbc.query("SELECT id, asset_id, kind, note, reported_at FROM hrms.asset_issue_reports WHERE tenant_id = ? AND status = 'OPEN'" + in,
                (RowCallbackHandler) rs -> out.put(rs.getObject("asset_id", UUID.class), new OnboardingViews.IssueBrief(
                        rs.getObject("id", UUID.class), rs.getString("kind"), rs.getString("note"), instant(rs.getTimestamp("reported_at")))),
                args.toArray());
        return out;
    }

    /** The signed-in person's name for "resolved by": their employee name, else their sign-in email. */
    @Transactional(readOnly = true)
    public String actorName(UUID employeeId, String email) {
        if (employeeId != null) {
            List<String> names = jdbc.queryForList(
                    "SELECT concat_ws(' ', first_name, last_name) FROM hrms.employees WHERE tenant_id = ? AND id = ?",
                    String.class, TenantContext.requireTenantId(), employeeId);
            if (!names.isEmpty() && names.get(0) != null && !names.get(0).isBlank()) return names.get(0);
        }
        return email;
    }

    /** True when V143.59's confirmation table exists (My assets shows "Confirm" only then). */
    public boolean confirmationsReady() {
        return present(CONFIRMATIONS);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * The asset, locked, when it is with {@code employeeId} now, and its open
     * hand-over (null for one recorded before hand-overs were tracked).
     */
    private Held heldBy(UUID tenant, UUID employeeId, UUID assetId) {
        if (employeeId == null)
            throw new HrmsException("This asset isn’t with you.", HttpStatus.NOT_FOUND, "ASSET_NOT_WITH_YOU");
        List<Held> rows = jdbc.query("""
                SELECT a.id, a.asset_tag, a.asset_name,
                       (SELECT al.id FROM hrms.asset_allocations al
                         WHERE al.tenant_id = a.tenant_id AND al.asset_id = a.id AND al.employee_id = a.employee_id
                           AND al.returned_at IS NULL
                         ORDER BY al.created_at DESC LIMIT 1) AS allocation_id
                  FROM hrms.onboarding_assets a
                 WHERE a.tenant_id = ? AND a.id = ? AND a.status = 'ASSIGNED' AND a.employee_id = ?
                   FOR UPDATE OF a
                """, (rs, n) -> new Held(rs.getObject("id", UUID.class), rs.getString("asset_tag"),
                rs.getString("asset_name"), rs.getObject("allocation_id", UUID.class)), tenant, assetId, employeeId);
        if (rows.isEmpty())
            throw new HrmsException("This asset isn’t with you.", HttpStatus.NOT_FOUND, "ASSET_NOT_WITH_YOU");
        return rows.get(0);
    }

    /** Active people who manage assets, by permission (roles, plus per-person grants, minus denials); not the reporter. */
    List<UUID> assetManagers(UUID tenant, UUID except) {
        try {
            List<UUID> ids = jdbc.queryForList("""
                    SELECT uc.employee_id
                      FROM auth.user_credentials uc
                      JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = uc.tenant_id
                     WHERE uc.tenant_id = ? AND uc.is_active = TRUE AND uc.employee_id IS NOT NULL
                       AND e.employment_status NOT IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')
                       AND (EXISTS (SELECT 1 FROM rbac.user_roles ur
                                      JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                                     WHERE ur.tenant_id = uc.tenant_id AND ur.user_id = uc.id AND rp.permission_code = ?)
                            OR EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                        WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = ?
                                          AND o.effect = 'GRANT' AND (o.expires_at IS NULL OR o.expires_at > now())))
                       AND NOT EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                        WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = ?
                                          AND o.effect = 'DENY' AND (o.expires_at IS NULL OR o.expires_at > now()))
                     GROUP BY uc.employee_id
                     ORDER BY min(uc.created_at)
                     LIMIT ?
                    """, UUID.class, tenant, MANAGE_PERMISSION, MANAGE_PERMISSION, MANAGE_PERMISSION, MAX_RECIPIENTS + 1);
            List<UUID> out = new ArrayList<>(ids);
            out.remove(except);
            return out.size() > MAX_RECIPIENTS ? out.subList(0, MAX_RECIPIENTS) : out;
        } catch (RuntimeException e) {
            // Who to tell is best effort; the report itself must still be saved.
            log.warn("Could not find who manages assets for a problem report: {}", e.getMessage());
            return List.of();
        }
    }

    private Map<UUID, String> employeeNames(UUID tenant, List<UUID> ids) {
        Map<UUID, String> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        List<Object> args = new ArrayList<>();
        args.add(tenant);
        args.addAll(ids);
        jdbc.query("SELECT id, concat_ws(' ', first_name, last_name) AS name FROM hrms.employees WHERE tenant_id = ? AND id IN ("
                        + String.join(",", Collections.nCopies(ids.size(), "?")) + ")",
                (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class), rs.getString("name")), args.toArray());
        return out;
    }

    private static final String ISSUE_SELECT = """
            SELECT r.id, r.asset_id, a.asset_tag, a.asset_name, a.asset_type, a.company_id, r.employee_id,
                   CASE WHEN ? THEN concat_ws(' ', e.first_name, e.last_name) END AS employee_name,
                   r.kind, r.note, r.status, r.reported_at, r.resolved_at, r.resolved_by_name, r.resolution_note
              FROM hrms.asset_issue_reports r
              JOIN hrms.onboarding_assets a ON a.id = r.asset_id AND a.tenant_id = r.tenant_id
              LEFT JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
            """;

    private static final RowMapper<Issue> ISSUE_ROW = (rs, n) -> new Issue(
            rs.getObject("id", UUID.class), rs.getObject("asset_id", UUID.class), rs.getString("asset_tag"),
            rs.getString("asset_name"), rs.getString("asset_type"), rs.getObject("company_id", UUID.class),
            rs.getObject("employee_id", UUID.class), rs.getString("employee_name"), rs.getString("kind"),
            rs.getString("note"), rs.getString("status"), instant(rs.getTimestamp("reported_at")),
            instant(rs.getTimestamp("resolved_at")), rs.getString("resolved_by_name"), rs.getString("resolution_note"));

    private boolean present(String table) {
        Boolean present = jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, table);
        return Boolean.TRUE.equals(present);
    }

    private void requirePresent(String table) {
        if (!present(table)) throw new FeatureNotReady();
    }

    private void record(String action, UUID assetId, String summary) {
        try {
            audit.record("onboarding", action, "asset", assetId, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for {}: {}", action, e.getMessage());
        }
    }

    static String cleanNote(String note) {
        if (note == null || note.isBlank()) return null;
        String t = note.trim();
        if (t.length() > NOTE_MAX)
            throw new BusinessRuleException("Keep the note to " + NOTE_MAX + " characters", "ASSET_ISSUE_NOTE_TOO_LONG");
        return t;
    }

    /** "lost", "damaged", "not working" or "something else": the notification's {{problem}}. */
    static String describe(String kind) {
        return switch (kind == null ? "" : kind) {
            case "LOST" -> "lost";
            case "DAMAGED" -> "damaged";
            case "NOT_WORKING" -> "not working";
            default -> "something else";
        };
    }

    static String label(String name, String tag) {
        if (name == null || name.isBlank()) return tag == null ? "an asset" : tag;
        return tag == null || tag.isBlank() ? name : name + " (" + tag + ")";
    }

    private static String truncate(String s, int max) {
        return s == null ? null : s.length() <= max ? s : s.substring(0, max);
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
