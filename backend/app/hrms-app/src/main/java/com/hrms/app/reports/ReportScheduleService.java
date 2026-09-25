package com.hrms.app.reports;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Array;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Weekly and monthly report emails (hrms.report_schedules).
 *
 * <p>Rules, checked when a schedule is saved AND again every time it sends:
 * <ul>
 *   <li>The person setting it up must be able to open the report.</li>
 *   <li>Recipients are workspace members (never free-typed addresses) who can
 *       open that report themselves; anyone who has lost access by send time is
 *       left out, and the email goes to the rest.</li>
 *   <li>If the person who set it up no longer may schedule emails or open the
 *       report, the schedule is paused instead of sending.</li>
 * </ul>
 * Each send claims the schedule first (moving next_run_on on in one UPDATE),
 * so two app instances can never send the same email twice. Every email is
 * recorded in the export log.
 */
@Service
public class ReportScheduleService {

    private static final Logger log = LoggerFactory.getLogger(ReportScheduleService.class);
    static final String MANAGE = "hrms.report.schedule.manage";
    static final int MAX_RECIPIENTS = 25;

    private final JdbcTemplate jdbc;
    private final ReportPdfService pdfs;
    private final ReportExportLog exportLog;
    private final MailService mail;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public ReportScheduleService(JdbcTemplate jdbc, ReportPdfService pdfs, ReportExportLog exportLog, MailService mail,
                                 AuditService audit, PlatformTransactionManager txm) {
        this.jdbc = jdbc;
        this.pdfs = pdfs;
        this.exportLog = exportLog;
        this.mail = mail;
        this.audit = audit;
        this.tx = new TransactionTemplate(txm);
    }

    public record Request(String report, UUID companyId, String frequency, Integer dayOfWeek, Integer dayOfMonth,
                          List<UUID> recipientIds, Boolean active) {}

    public record Recipient(UUID id, String name, String email, Set<String> permissions) {}

    public record SendResult(String status, int sent, int failed, int skipped, String message) {}

    // ── reads ────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> list() {
        return tx.execute(s -> {
            List<Map<String, Object>> rows = normalized(jdbc.queryForList("""
                    SELECT r.id, r.report, r.company_id, co.name AS company_name, r.frequency, r.day_of_week, r.day_of_month,
                           r.recipient_user_ids, r.active, r.next_run_on, r.last_run_at, r.last_status, r.last_message,
                           r.created_by, r.created_at,
                           COALESCE(NULLIF(btrim(c.display_name), ''), NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), c.email) AS created_by_name
                      FROM hrms.report_schedules r
                      LEFT JOIN org.companies co ON co.id = r.company_id
                      LEFT JOIN auth.user_credentials c ON c.id = r.created_by
                      LEFT JOIN hrms.employees e ON e.id = c.employee_id
                     ORDER BY r.created_at DESC
                    """));
            Set<UUID> ids = new LinkedHashSet<>();
            for (Map<String, Object> r : rows) ids.addAll(uuids(r.get("recipient_user_ids")));
            Map<UUID, Recipient> people = people(ids, List.of());
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                ReportKind kind = ReportKind.fromKey((String) r.get("report")).orElse(null);
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", r.get("id"));
                m.put("report", r.get("report"));
                m.put("reportLabel", kind == null ? r.get("report") : kind.label());
                m.put("companyId", r.get("company_id"));
                m.put("companyName", r.get("company_name"));
                m.put("frequency", r.get("frequency"));
                m.put("dayOfWeek", r.get("day_of_week"));
                m.put("dayOfMonth", r.get("day_of_month"));
                m.put("recipients", uuids(r.get("recipient_user_ids")).stream().map(id -> {
                    Recipient p = people.get(id);
                    Map<String, Object> x = new LinkedHashMap<>();
                    x.put("id", id);
                    x.put("name", p == null ? null : p.name());
                    x.put("email", p == null ? null : p.email());
                    x.put("active", p != null);
                    return x;
                }).toList());
                m.put("active", r.get("active"));
                m.put("nextRunOn", String.valueOf(r.get("next_run_on")));
                m.put("lastRunAt", r.get("last_run_at") instanceof Timestamp t ? t.toInstant().toString() : null);
                m.put("lastStatus", r.get("last_status"));
                m.put("lastMessage", r.get("last_message"));
                m.put("createdBy", r.get("created_by"));
                m.put("createdByName", r.get("created_by_name"));
                out.add(m);
            }
            return out;
        });
    }

    /** Workspace members who may receive this report: active, and able to open it. */
    public List<Recipient> eligibleRecipients(ReportKind kind) {
        return tx.execute(s -> {
            String in = String.join(",", Collections.nCopies(kind.permissions().size(), "?"));
            List<UUID> ids = jdbc.queryForList("""
                    SELECT DISTINCT c.id FROM auth.user_credentials c
                      JOIN rbac.user_roles ur ON ur.user_id = c.id
                      JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                     WHERE c.is_active AND rp.permission_code IN (""" + in + ")", UUID.class, kind.permissions().toArray());
            return people(new LinkedHashSet<>(ids), kind.permissions()).values().stream()
                    .filter(p -> kind.openableWith(p.permissions()))
                    .sorted((a, b) -> String.valueOf(a.name()).compareToIgnoreCase(String.valueOf(b.name())))
                    .toList();
        });
    }

    // ── writes ───────────────────────────────────────────────────────────────

    public Map<String, Object> create(Request req, Set<String> held) {
        Checked c = check(req, held);
        UUID id = UUID.randomUUID();
        LocalDate next = ReportPeriods.nextRun(c.frequency(), c.dayOfWeek(), c.dayOfMonth(), LocalDate.now(ReportPdfService.IST));
        tx.executeWithoutResult(s -> jdbc.update("""
                INSERT INTO hrms.report_schedules (id, tenant_id, company_id, report, frequency, day_of_week, day_of_month,
                                                   recipient_user_ids, active, next_run_on, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?::uuid[], ?, ?, ?)
                """, id, TenantContext.requireTenantId(), req.companyId(), c.kind().key(), c.frequency().name(), c.dayOfWeek(), c.dayOfMonth(),
                pgArray(c.recipients()), req.active() == null || req.active(), next, TenantContext.getUserId()));
        audit.record("reports", "CREATE", "report_schedule", id, describe(c) + " created");
        return one(id);
    }

    public Map<String, Object> update(UUID id, Request req, Set<String> held) {
        Map<String, Object> cur = row(id);
        Checked c = check(req, held);
        boolean active = req.active() == null ? Boolean.TRUE.equals(cur.get("active")) : req.active();
        boolean sameTiming = c.frequency().name().equals(cur.get("frequency"))
                && java.util.Objects.equals(c.dayOfWeek(), num(cur.get("day_of_week")))
                && java.util.Objects.equals(c.dayOfMonth(), num(cur.get("day_of_month")));
        LocalDate today = LocalDate.now(ReportPdfService.IST);
        LocalDate curNext = LocalDate.parse(String.valueOf(cur.get("next_run_on")));
        LocalDate next = sameTiming && !curNext.isBefore(today) ? curNext : ReportPeriods.nextRun(c.frequency(), c.dayOfWeek(), c.dayOfMonth(), today);
        tx.executeWithoutResult(s -> jdbc.update("""
                UPDATE hrms.report_schedules
                   SET company_id = ?, report = ?, frequency = ?, day_of_week = ?, day_of_month = ?, recipient_user_ids = ?::uuid[],
                       active = ?, next_run_on = ?, updated_at = now()
                 WHERE id = ?
                """, req.companyId(), c.kind().key(), c.frequency().name(), c.dayOfWeek(), c.dayOfMonth(), pgArray(c.recipients()),
                active, next, id));
        audit.record("reports", "UPDATE", "report_schedule", id, describe(c) + (active ? " updated" : " paused"));
        return one(id);
    }

    public void delete(UUID id, Set<String> held) {
        Map<String, Object> cur = row(id);
        ReportKind kind = ReportKind.fromKey((String) cur.get("report")).orElse(null);
        if (kind != null && !kind.openableWith(held)) {
            throw new AccessDeniedException("You can't open the " + kind.label().toLowerCase() + ", so you can't delete its email");
        }
        tx.executeWithoutResult(s -> jdbc.update("DELETE FROM hrms.report_schedules WHERE id = ?", id));
        audit.record("reports", "DELETE", "report_schedule", id,
                (kind == null ? "Report" : kind.label()) + " email deleted");
    }

    /** Sends one schedule now, for the period an email sent today would cover. Doesn't move the next date. */
    public SendResult sendNow(UUID id, Set<String> held) {
        Map<String, Object> cur = row(id);
        ReportKind kind = ReportKind.fromKey((String) cur.get("report")).orElseThrow();
        if (!kind.openableWith(held)) {
            throw new AccessDeniedException("You can't open the " + kind.label().toLowerCase() + ", so you can't send it");
        }
        return send(cur, LocalDate.now(ReportPdfService.IST), "Sent now");
    }

    // ── the job ──────────────────────────────────────────────────────────────

    /** Sends every due schedule of the bound tenant. Returns how many were sent (fully or partly). */
    public int sendDue(LocalDate today) {
        List<Map<String, Object>> due = tx.execute(s -> normalized(jdbc.queryForList(
                "SELECT * FROM hrms.report_schedules WHERE active AND next_run_on <= ? ORDER BY next_run_on, created_at", today)));
        int sent = 0;
        for (Map<String, Object> r : due == null ? List.<Map<String, Object>>of() : due) {
            UUID id = (UUID) r.get("id");
            LocalDate dueOn = LocalDate.parse(String.valueOf(r.get("next_run_on")));
            ReportPeriods.Frequency f = ReportPeriods.Frequency.valueOf((String) r.get("frequency"));
            LocalDate next = ReportPeriods.nextRun(f, num(r.get("day_of_week")), num(r.get("day_of_month")), today);
            // Claim it: only the instance whose UPDATE moves the date on sends.
            Integer claimed = tx.execute(s -> jdbc.update(
                    "UPDATE hrms.report_schedules SET next_run_on = ?, updated_at = now() WHERE id = ? AND active AND next_run_on = ?",
                    next, id, dueOn));
            if (claimed == null || claimed == 0) continue;
            try {
                SendResult res = send(r, dueOn, "Scheduled");
                if ("SENT".equals(res.status()) || "PARTIAL".equals(res.status())) sent++;
            } catch (RuntimeException e) {
                log.error("Report schedule {} failed: {}", id, e.getMessage(), e);
                stamp(id, "FAILED", "Could not prepare the report: " + e.getMessage());
            }
        }
        return sent;
    }

    // ── sending ──────────────────────────────────────────────────────────────

    private SendResult send(Map<String, Object> r, LocalDate sendDay, String how) {
        UUID id = (UUID) r.get("id");
        ReportKind kind = ReportKind.fromKey((String) r.get("report")).orElseThrow();
        UUID companyId = (UUID) r.get("company_id");
        UUID creatorId = (UUID) r.get("created_by");
        ReportPeriods.Frequency f = ReportPeriods.Frequency.valueOf((String) r.get("frequency"));
        List<String> perms = new ArrayList<>(kind.permissions());
        perms.add(MANAGE);

        Map<UUID, Recipient> creator = tx.execute(s -> people(creatorId == null ? Set.of() : Set.of(creatorId), perms));
        Recipient owner = creator == null ? null : creator.get(creatorId);
        if (owner == null || !owner.permissions().contains(MANAGE) || !kind.openableWith(owner.permissions())) {
            String who = owner == null ? "The person who set it up" : owner.name();
            String msg = who + " can no longer schedule this report, so it was paused. Anyone who may schedule report emails can turn it back on.";
            tx.executeWithoutResult(s -> jdbc.update("UPDATE hrms.report_schedules SET active = false, updated_at = now() WHERE id = ?", id));
            stamp(id, "SKIPPED", msg);
            return new SendResult("SKIPPED", 0, 0, 0, msg);
        }

        List<UUID> wanted = uuids(r.get("recipient_user_ids"));
        Map<UUID, Recipient> found = tx.execute(s -> people(new LinkedHashSet<>(wanted), kind.permissions()));
        List<Recipient> allowed = wanted.stream().map(found::get)
                .filter(p -> p != null && p.email() != null && !p.email().isBlank() && kind.openableWith(p.permissions())).toList();
        int skipped = wanted.size() - allowed.size();
        if (allowed.isEmpty()) {
            String msg = "Nobody on the list can open this report any more, so nothing was sent.";
            stamp(id, "SKIPPED", msg);
            return new SendResult("SKIPPED", 0, 0, skipped, msg);
        }

        ReportPeriods.Period period = ReportPeriods.periodFor(f, sendDay);
        ReportPdfService.Params params = ReportPeriods.params(kind, companyId, period);
        // Workforce Analytics sections follow each recipient's own permissions,
        // so people with the same report permissions share one rendering.
        Map<Set<String>, List<Recipient>> groups = new LinkedHashMap<>();
        for (Recipient p : allowed) {
            Set<String> key = kind == ReportKind.WORKFORCE_ANALYTICS
                    ? p.permissions().stream().filter(kind.permissions()::contains).collect(Collectors.toSet())
                    : Set.copyOf(kind.permissions());
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(p);
        }
        int ok = 0, failed = 0;
        String lastError = null;
        String frequencyWord = f == ReportPeriods.Frequency.WEEKLY ? "weekly" : "monthly";
        for (Map.Entry<Set<String>, List<Recipient>> g : groups.entrySet()) {
            ReportPdfService.Rendered pdf = pdfs.render(kind, params, g.getKey(), "Scheduled " + frequencyWord + " by " + owner.name());
            for (Recipient p : g.getValue()) {
                try {
                    mail.send(new EmailMessage(p.email(), p.name(), subject(kind, pdf.companyName(), period), body(kind, pdf.companyName(), period, p, owner, frequencyWord),
                            null, List.of(), List.of(new EmailMessage.Attachment(pdf.fileName(), "application/pdf", pdf.bytes()))));
                    ok++;
                } catch (RuntimeException e) {
                    failed++;
                    lastError = e.getMessage();
                    log.warn("Report email {} to {} failed: {}", id, p.email(), e.getMessage());
                }
            }
            Map<String, Object> filters = new LinkedHashMap<>();
            filters.put("frequency", f.name());
            filters.put("from", String.valueOf(params.from() == null ? period.from() : params.from()));
            filters.put("to", String.valueOf(params.to() == null ? period.to() : params.to()));
            if (params.asOf() != null) filters.put("asOf", params.asOf().toString());
            if (params.year() != null) filters.put("year", params.year());
            filters.put("recipients", g.getValue().size());
            filters.put("how", how);
            exportLog.record(new ReportExportLog.Entry(kind, "PDF", "SCHEDULE", pdf.fileName(), companyId, pdf.companyName(), filters,
                    pdf.rowCount(), (long) pdf.bytes().length, id, creatorId));
        }
        String status = failed == 0 ? "SENT" : ok == 0 ? "FAILED" : "PARTIAL";
        String msg = (ok > 0 ? "Sent to " + ok + (ok == 1 ? " person" : " people") : "Not sent")
                + (failed > 0 ? ", " + failed + " failed" + (lastError == null ? "" : " (" + lastError + ")") : "")
                + (skipped > 0 ? ", " + skipped + " left out (no access to this report)" : "")
                + " · " + period.label();
        stamp(id, status, msg);
        return new SendResult(status, ok, failed, skipped, msg);
    }

    static String subject(ReportKind kind, String company, ReportPeriods.Period period) {
        return kind.label() + " · " + company + " · " + period.label();
    }

    static String body(ReportKind kind, String company, ReportPeriods.Period period, Recipient to, Recipient owner, String frequencyWord) {
        String e = ReportHtml.esc(company);
        return "<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.55\">"
                + "<p>Hello " + ReportHtml.esc(to.name()) + ",</p>"
                + "<p>Here is the <b>" + ReportHtml.esc(kind.label().toLowerCase()) + "</b> for <b>" + e + "</b>, covering "
                + ReportHtml.esc(period.label()) + ". The PDF is attached.</p>"
                + "<p style=\"color:#475569\">You get this " + frequencyWord + " email because " + ReportHtml.esc(owner.name())
                + " added you to it in " + e + "'s HR workspace. To stop it, ask them or your HR team to take you off the list.</p>"
                + "<p style=\"color:#94a3b8;font-size:12px\">The report holds " + e + " data. Please don't forward it outside the company.</p>"
                + "</div>";
    }

    private void stamp(UUID id, String status, String message) {
        try {
            tx.executeWithoutResult(s -> jdbc.update(
                    "UPDATE hrms.report_schedules SET last_run_at = now(), last_status = ?, last_message = ?, updated_at = now() WHERE id = ?",
                    status, message == null || message.length() <= 1000 ? message : message.substring(0, 1000), id));
        } catch (RuntimeException e) {
            log.error("Could not record the result of report schedule {}: {}", id, e.getMessage());
        }
    }

    // ── validation ───────────────────────────────────────────────────────────

    record Checked(ReportKind kind, ReportPeriods.Frequency frequency, Integer dayOfWeek, Integer dayOfMonth, List<UUID> recipients) {}

    private Checked check(Request req, Set<String> held) {
        if (req == null) throw new BusinessRuleException("Nothing to save", "REPORT_SCHEDULE_EMPTY");
        ReportKind kind = ReportKind.fromKey(req.report()).filter(ReportKind::schedulable)
                .orElseThrow(() -> new BusinessRuleException("Choose a report to send", "REPORT_SCHEDULE_REPORT"));
        if (!kind.openableWith(held)) {
            throw new AccessDeniedException("You can't open the " + kind.label().toLowerCase() + ", so you can't schedule it");
        }
        if (req.companyId() == null) throw new BusinessRuleException("Choose a company", "REPORT_SCHEDULE_COMPANY");
        Boolean companyExists = tx.execute(s -> !jdbc.queryForList("SELECT 1 FROM org.companies WHERE id = ?", Integer.class, req.companyId()).isEmpty());
        if (!Boolean.TRUE.equals(companyExists)) throw new ResourceNotFoundException("Company not found");
        ReportPeriods.Frequency f;
        try {
            f = ReportPeriods.Frequency.valueOf(String.valueOf(req.frequency()).toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BusinessRuleException("Choose weekly or monthly", "REPORT_SCHEDULE_FREQUENCY");
        }
        Integer dow = null, dom = null;
        if (f == ReportPeriods.Frequency.WEEKLY) {
            if (req.dayOfWeek() == null || req.dayOfWeek() < 1 || req.dayOfWeek() > 7) {
                throw new BusinessRuleException("Choose the weekday it goes out", "REPORT_SCHEDULE_DAY");
            }
            dow = req.dayOfWeek();
        } else {
            if (req.dayOfMonth() == null || req.dayOfMonth() < 1 || req.dayOfMonth() > 28) {
                throw new BusinessRuleException("Choose a day of the month from 1 to 28", "REPORT_SCHEDULE_DAY");
            }
            dom = req.dayOfMonth();
        }
        List<UUID> ids = req.recipientIds() == null ? List.of() : new ArrayList<>(new LinkedHashSet<>(req.recipientIds()));
        if (ids.isEmpty()) throw new BusinessRuleException("Pick at least one person to receive it", "REPORT_SCHEDULE_RECIPIENTS");
        if (ids.size() > MAX_RECIPIENTS) throw new BusinessRuleException("Pick at most " + MAX_RECIPIENTS + " people", "REPORT_SCHEDULE_RECIPIENTS");
        Map<UUID, Recipient> found = tx.execute(s -> people(new LinkedHashSet<>(ids), kind.permissions()));
        List<String> refused = new ArrayList<>();
        for (UUID id : ids) {
            Recipient p = found == null ? null : found.get(id);
            if (p == null) refused.add("someone who is no longer in this workspace");
            else if (!kind.openableWith(p.permissions())) refused.add(p.name());
        }
        if (!refused.isEmpty()) {
            throw new BusinessRuleException("These people can't open the " + kind.label().toLowerCase() + ", so they can't receive it: "
                    + String.join(", ", refused), "REPORT_SCHEDULE_RECIPIENT_ACCESS");
        }
        return new Checked(kind, f, dow, dom, ids);
    }

    private static String describe(Checked c) {
        return (c.frequency() == ReportPeriods.Frequency.WEEKLY ? "Weekly " : "Monthly ") + c.kind().label() + " email";
    }

    // ── lookups ──────────────────────────────────────────────────────────────

    /** Active workspace members by id, with the subset of {@code perms} each holds through their roles. */
    private Map<UUID, Recipient> people(Set<UUID> ids, List<String> perms) {
        Map<UUID, Recipient> out = new LinkedHashMap<>();
        if (ids.isEmpty()) return out;
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        jdbc.query("""
                SELECT c.id, c.email,
                       COALESCE(NULLIF(btrim(c.display_name), ''), NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), c.email) AS name
                  FROM auth.user_credentials c LEFT JOIN hrms.employees e ON e.id = c.employee_id
                 WHERE c.is_active AND c.id IN (""" + in + ")", rs -> {
            UUID id = rs.getObject("id", UUID.class);
            out.put(id, new Recipient(id, rs.getString("name"), rs.getString("email"), new java.util.HashSet<>()));
        }, ids.toArray());
        if (!out.isEmpty() && !perms.isEmpty()) {
            String users = String.join(",", Collections.nCopies(out.size(), "?"));
            String codes = String.join(",", Collections.nCopies(perms.size(), "?"));
            List<Object> args = new ArrayList<>(out.keySet());
            args.addAll(perms);
            jdbc.query("SELECT DISTINCT ur.user_id, rp.permission_code FROM rbac.user_roles ur JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id"
                    + " WHERE ur.user_id IN (" + users + ") AND rp.permission_code IN (" + codes + ")", rs -> {
                Recipient p = out.get(rs.getObject("user_id", UUID.class));
                if (p != null) p.permissions().add(rs.getString("permission_code"));
            }, args.toArray());
        }
        return out;
    }

    private Map<String, Object> row(UUID id) {
        List<Map<String, Object>> rows = tx.execute(s -> normalized(jdbc.queryForList("SELECT * FROM hrms.report_schedules WHERE id = ?", id)));
        if (rows == null || rows.isEmpty()) throw new ResourceNotFoundException("Report email not found");
        return rows.get(0);
    }

    private Map<String, Object> one(UUID id) {
        return list().stream().filter(m -> id.equals(m.get("id"))).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Report email not found"));
    }

    /** Reads the recipient array while the connection is still open (a JDBC array can't be read after it). */
    private static List<Map<String, Object>> normalized(List<Map<String, Object>> rows) {
        for (Map<String, Object> r : rows) r.put("recipient_user_ids", uuids(r.get("recipient_user_ids")));
        return rows;
    }

    @SuppressWarnings("unchecked")
    private static List<UUID> uuids(Object v) {
        if (v == null) return List.of();
        if (v instanceof List<?> l) return (List<UUID>) l;
        try {
            Object arr = v instanceof Array a ? a.getArray() : v;
            if (arr instanceof UUID[] u) return List.of(u);
            if (arr instanceof Object[] o) {
                List<UUID> out = new ArrayList<>();
                for (Object x : o) if (x != null) out.add(x instanceof UUID u ? u : UUID.fromString(String.valueOf(x)));
                return out;
            }
        } catch (java.sql.SQLException e) {
            log.warn("Could not read recipient list: {}", e.getMessage());
        }
        return List.of();
    }

    private static String pgArray(List<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }

    private static Integer num(Object v) {
        return v instanceof Number n ? n.intValue() : null;
    }
}
