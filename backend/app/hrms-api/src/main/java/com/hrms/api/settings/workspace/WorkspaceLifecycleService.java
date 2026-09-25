package com.hrms.api.settings.workspace;

import com.hrms.api.mail.EmailMessage;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Workspace reset and deletion, done safely (Settings -> Danger zone).
 *
 * <p>The app NEVER deletes anything itself. An owner schedules a request by
 * typing the workspace name; it waits {@value #COOLING_OFF_DAYS} days, during
 * which any owner or super admin can cancel it, and every owner and admin is
 * emailed when it is scheduled, cancelled and when the wait ends. When the
 * wait ends the request becomes DUE and the platform operator is emailed; they
 * take a backup and carry it out, then mark it COMPLETED. Exactly what each
 * one removes and keeps is {@link #RESET_REMOVES}, {@link #RESET_KEEPS} and
 * {@link #DELETE_REMOVES}; the page shows these same lists.
 */
@Service
public class WorkspaceLifecycleService {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceLifecycleService.class);

    public static final int COOLING_OFF_DAYS = 7;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH);

    /** What a reset removes: every record, for everyone in the workspace. */
    public static final List<String> RESET_REMOVES = List.of(
            "Employee records: profiles, personal and identity details, bank accounts, education, experience and family",
            "Attendance: punches, daily records, regularisation, work-from-home and overtime requests, shift assignments and face enrolments",
            "Leave requests, balances and adjustments",
            "Payroll runs, payslips, salary structures, bank payment files and statutory filings",
            "Expense claims, salary advances, exits and full & final settlements",
            "Hiring candidates and offers, onboarding checklists and asset allocations",
            "Performance reviews and KPIs, learning enrolments and incentive (PLI) awards",
            "Uploaded documents and issued letters",
            "In-app notifications",
            "Sign-in accounts of everyone except the workspace owners");

    /** What a reset keeps, so the workspace is ready to use again. */
    public static final List<String> RESET_KEEPS = List.of(
            "The workspace itself: its name, web address, profile, plan, billing and branding",
            "Owner sign-in accounts, roles and permissions",
            "Companies, branches, departments, designations, grades, shifts and shift rules",
            "Leave types, holiday calendars, salary components and payroll settings",
            "Policies, letter and notification templates, document types and HR configuration",
            "The audit trail");

    /** What a deletion removes: everything. */
    public static final List<String> DELETE_REMOVES = List.of(
            "Everything a reset removes",
            "Everything a reset keeps, including the setup, all sign-in accounts, roles, branding and the audit trail",
            "The workspace web address stops working and nobody can sign in",
            "Autopay is cancelled, so nothing more is charged");

    public record RequestView(UUID id, String kind, String status, String requestedByEmail, OffsetDateTime createdAt,
                              OffsetDateTime scheduledFor, String reason, String cancelledByEmail,
                              OffsetDateTime cancelledAt, OffsetDateTime dueNotifiedAt, OffsetDateTime completedAt) {}

    public record Overview(String workspaceName, boolean youAreOwner, int coolingOffDays, List<RequestView> requests,
                           List<String> resetRemoves, List<String> resetKeeps, List<String> deleteRemoves) {}

    private final JdbcTemplate jdbc;
    private final WorkspaceMailer mailer;
    private final AuditService audit;
    private final String opsEmail;

    public WorkspaceLifecycleService(JdbcTemplate jdbc, WorkspaceMailer mailer, AuditService audit,
                                     @Value("${unifiedtree.ops.notify-email:unifiedtree@gmail.com}") String opsEmail) {
        this.jdbc = jdbc;
        this.mailer = mailer;
        this.audit = audit;
        this.opsEmail = opsEmail;
    }

    @Transactional(readOnly = true)
    public Overview overview(UUID tenantId, UUID userId) {
        return new Overview(mailer.workspaceName(tenantId), isOwner(tenantId, userId), COOLING_OFF_DAYS,
                jdbc.query(SELECT + " WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10", this::map, tenantId),
                RESET_REMOVES, RESET_KEEPS, DELETE_REMOVES);
    }

    @Transactional
    public RequestView request(UUID tenantId, UUID userId, String email, String kindRaw, String confirmName, String reason) {
        if (!isOwner(tenantId, userId)) {
            throw new HrmsException("Only a workspace owner can schedule a reset or deletion.", HttpStatus.FORBIDDEN, "OWNER_ONLY");
        }
        String kind = kindRaw == null ? "" : kindRaw.trim().toUpperCase(Locale.ROOT);
        if (!kind.equals("RESET") && !kind.equals("DELETE")) {
            throw new BusinessRuleException("Choose reset or delete.", "LIFECYCLE_KIND_INVALID");
        }
        String name = mailer.workspaceName(tenantId);
        if (!nameMatches(confirmName, name)) {
            throw new BusinessRuleException("Type the workspace name exactly as shown: " + name, "CONFIRM_NAME_MISMATCH");
        }
        List<RequestView> open = jdbc.query(SELECT + " WHERE tenant_id = ? AND status IN ('SCHEDULED', 'DUE')", this::map, tenantId);
        if (!open.isEmpty()) {
            RequestView o = open.get(0);
            throw new HrmsException("A workspace " + ("DELETE".equals(o.kind()) ? "deletion" : "reset")
                    + " is already scheduled. Cancel it first if you want to change it.", HttpStatus.CONFLICT, "LIFECYCLE_ALREADY_SCHEDULED");
        }
        String why = reason == null || reason.isBlank() ? null : reason.trim();
        if (why != null && why.length() > 500) why = why.substring(0, 500);
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO platform.workspace_lifecycle_requests
                           (id, tenant_id, kind, status, requested_by, requested_by_email, confirm_name, reason, scheduled_for)
                    VALUES (?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, now() + make_interval(days => ?))
                    """, id, tenantId, kind, userId, email, name, why, COOLING_OFF_DAYS);
        } catch (org.springframework.dao.DuplicateKeyException race) {
            // Two owners (or a double click) scheduling at the same moment: the
            // one-open-request index lets exactly one through.
            throw new HrmsException("A workspace " + ("DELETE".equals(kind) ? "deletion" : "reset")
                    + " is already scheduled. Cancel it first if you want to change it.", HttpStatus.CONFLICT, "LIFECYCLE_ALREADY_SCHEDULED");
        }
        RequestView v = find(tenantId, id);
        audit.record("settings", "WORKSPACE_" + kind + "_SCHEDULED", "workspace", tenantId,
                label(kind) + " scheduled for " + fmt(v.scheduledFor()) + " IST");

        String what = "DELETE".equals(kind) ? "permanently delete" : "reset (clear all records of)";
        List<String> paras = new ArrayList<>();
        paras.add(WorkspaceMailer.esc(email == null ? "A workspace owner" : email) + " asked to " + what + " "
                + WorkspaceMailer.esc(name) + ".");
        paras.add("Nothing happens before <b>" + fmt(v.scheduledFor()) + " IST</b>. Until then any owner can cancel it from "
                + "Settings, Danger zone.");
        if (why != null) paras.add("Reason given: " + WorkspaceMailer.esc(why));
        paras.add("If you didn't expect this, cancel it and talk to your team straight away.");
        notifyOwnersAndAdmins(tenantId, name + ": workspace " + ("DELETE".equals(kind) ? "deletion" : "reset") + " scheduled for "
                + fmtDate(v.scheduledFor()), label(kind) + " scheduled", paras);
        return v;
    }

    @Transactional
    public RequestView cancel(UUID tenantId, String email, UUID id) {
        RequestView v = find(tenantId, id);
        if (!"SCHEDULED".equals(v.status()) && !"DUE".equals(v.status())) {
            throw new HrmsException("This request is no longer waiting, so it can't be cancelled.", HttpStatus.CONFLICT, "LIFECYCLE_NOT_OPEN");
        }
        jdbc.update("""
                UPDATE platform.workspace_lifecycle_requests
                   SET status = 'CANCELLED', cancelled_by = ?, cancelled_by_email = ?, cancelled_at = now(), updated_at = now()
                 WHERE id = ? AND tenant_id = ? AND status IN ('SCHEDULED', 'DUE')
                """, com.unifiedtree.security.tenant.TenantContext.getUserId(), email, id, tenantId);
        RequestView after = find(tenantId, id);
        audit.record("settings", "WORKSPACE_" + v.kind() + "_CANCELLED", "workspace", tenantId, label(v.kind()) + " cancelled");
        String name = mailer.workspaceName(tenantId);
        notifyOwnersAndAdmins(tenantId, name + ": workspace " + ("DELETE".equals(v.kind()) ? "deletion" : "reset") + " cancelled",
                label(v.kind()) + " cancelled",
                List.of(WorkspaceMailer.esc(email == null ? "An owner" : email) + " cancelled the scheduled "
                                + ("DELETE".equals(v.kind()) ? "deletion" : "reset") + " of " + WorkspaceMailer.esc(name) + ".",
                        "Nothing was removed. The workspace carries on as before."));
        if ("DUE".equals(v.status())) {
            mailer.sendAfterCommit(List.of(EmailMessage.simple(opsEmail,
                    "CANCELLED: workspace " + v.kind().toLowerCase(Locale.ROOT) + " for " + name + " (" + tenantId + ")",
                    "<p>The " + v.kind().toLowerCase(Locale.ROOT) + " request " + id + " for workspace " + WorkspaceMailer.esc(name)
                            + " (" + tenantId + ") was cancelled by " + WorkspaceMailer.esc(email) + ". Do not carry it out.</p>")));
        }
        return after;
    }

    /** Hourly job: requests whose wait has ended become DUE; owners, admins and the operator are told. */
    @Transactional
    public int markDue(UUID tenantId) {
        List<RequestView> due = jdbc.query("""
                UPDATE platform.workspace_lifecycle_requests
                   SET status = 'DUE', due_notified_at = now(), updated_at = now()
                 WHERE tenant_id = ? AND status = 'SCHEDULED' AND scheduled_for <= now()
                RETURNING id, kind, status, requested_by_email, created_at, scheduled_for, reason, cancelled_by_email,
                          cancelled_at, due_notified_at, completed_at
                """, this::map, tenantId);
        if (due.isEmpty()) return 0;
        String name = mailer.workspaceName(tenantId);
        for (RequestView v : due) {
            String noun = "DELETE".equals(v.kind()) ? "deletion" : "reset";
            notifyOwnersAndAdmins(tenantId, name + ": the 7-day wait for the workspace " + noun + " has ended",
                    "The " + noun + " will be carried out soon",
                    List.of("The 7-day wait for the " + noun + " of " + WorkspaceMailer.esc(name) + " requested by "
                                    + WorkspaceMailer.esc(v.requestedByEmail()) + " has ended.",
                            "It will be carried out shortly, after a final backup is taken. You can still cancel it from "
                                    + "Settings, Danger zone until then."));
            mailer.sendAfterCommit(List.of(EmailMessage.simple(opsEmail,
                    "DUE: workspace " + noun + " for " + name + " (" + tenantId + ")",
                    "<p>Workspace <b>" + WorkspaceMailer.esc(name) + "</b> (tenant " + tenantId + ") has a " + noun
                            + " request " + v.id() + " whose 7-day wait ended " + fmt(v.scheduledFor()) + " IST.</p>"
                            + "<p>Requested by " + WorkspaceMailer.esc(v.requestedByEmail()) + " on " + fmt(v.createdAt())
                            + " IST.</p><p>Take a backup first, carry it out as documented in "
                            + "WorkspaceLifecycleService, then set the request status to COMPLETED. "
                            + "If the owners cancel it before you start, do nothing.</p>")));
            log.warn("Workspace {} request {} for tenant {} is DUE for operator action", v.kind(), v.id(), tenantId);
        }
        return due.size();
    }

    /** Holds the built-in OWNER role (checked in the database, not from the token). */
    public boolean isOwner(UUID tenantId, UUID userId) {
        if (userId == null) return false;
        Boolean b = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id
                                WHERE ur.tenant_id = ? AND ur.user_id = ? AND r.code = 'OWNER' AND r.tenant_id IS NULL)
                """, Boolean.class, tenantId, userId);
        return Boolean.TRUE.equals(b);
    }

    /** Case-insensitive, extra spaces ignored; nothing else is forgiven. */
    static boolean nameMatches(String typed, String name) {
        if (typed == null || name == null) return false;
        String a = typed.trim().replaceAll("\\s+", " ");
        String b = name.trim().replaceAll("\\s+", " ");
        return !a.isEmpty() && a.equalsIgnoreCase(b);
    }

    private void notifyOwnersAndAdmins(UUID tenantId, String subject, String heading, List<String> paragraphs) {
        String name = mailer.workspaceName(tenantId);
        String html = WorkspaceMailer.html(name, heading, paragraphs, "Open the danger zone", mailer.link(tenantId, "/settings/danger"));
        List<EmailMessage> msgs = new ArrayList<>();
        for (String to : mailer.ownerAndAdminEmails(tenantId)) msgs.add(new EmailMessage(to, null, subject, html, null, List.of()).withFromName(name));
        mailer.sendAfterCommit(msgs);
    }

    private static String label(String kind) {
        return "DELETE".equals(kind) ? "Workspace deletion" : "Workspace reset";
    }

    private static String fmt(OffsetDateTime t) {
        return t == null ? "" : t.atZoneSameInstant(IST).format(WHEN);
    }

    private static String fmtDate(OffsetDateTime t) {
        return t == null ? "" : t.atZoneSameInstant(IST).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH));
    }

    private static final String SELECT = """
            SELECT id, kind, status, requested_by_email, created_at, scheduled_for, reason, cancelled_by_email,
                   cancelled_at, due_notified_at, completed_at
              FROM platform.workspace_lifecycle_requests
            """;

    private RequestView find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT + " WHERE id = ? AND tenant_id = ?", this::map, id, tenantId).stream().findFirst()
                .orElseThrow(() -> new HrmsException("That request doesn't exist.", HttpStatus.NOT_FOUND, "LIFECYCLE_NOT_FOUND"));
    }

    private RequestView map(ResultSet rs, int n) throws SQLException {
        return new RequestView(rs.getObject("id", UUID.class), rs.getString("kind"), rs.getString("status"),
                rs.getString("requested_by_email"), ts(rs.getTimestamp("created_at")), ts(rs.getTimestamp("scheduled_for")),
                rs.getString("reason"), rs.getString("cancelled_by_email"), ts(rs.getTimestamp("cancelled_at")),
                ts(rs.getTimestamp("due_notified_at")), ts(rs.getTimestamp("completed_at")));
    }

    private static OffsetDateTime ts(Timestamp t) {
        return t == null ? null : t.toInstant().atOffset(ZoneOffset.UTC);
    }
}
