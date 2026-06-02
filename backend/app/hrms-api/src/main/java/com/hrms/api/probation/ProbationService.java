package com.hrms.api.probation;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Array;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Probation reminder logic (Prompt 11). Lives in hrms-api because it depends on
 * {@link MailService}. All reads/writes are raw RLS-scoped JdbcTemplate (no JPA
 * entity) — mirroring InvitationService / WorkspaceAccessService.
 *
 * <p>In-app notifications are intentionally NOT sent here: the canonical profile
 * excludes {@code com.hrms.notification} (notifications flow via Kafka consumers,
 * not wired in dev). Reminders are email-only in this profile.
 */
@Service
public class ProbationService {

    private static final Logger log = LoggerFactory.getLogger(ProbationService.class);

    private final MailService mailService;
    private final JdbcTemplate jdbc;

    @Value("${hrms.probation.reminder-days-before:7}")
    private int defaultReminderDaysBefore;

    @Value("${unifiedtree.mail.invite-url-base:${INVITE_URL_BASE:http://localhost:3001}}")
    private String platformBaseUrl;

    public ProbationService(MailService mailService, JdbcTemplate jdbc) {
        this.mailService = mailService;
        this.jdbc = jdbc;
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public record ProbationConfigDto(int reminderDaysBefore, boolean autoExtendEnabled, int autoExtendDays) {}

    public record UpcomingProbationDto(
        UUID employeeId, String employeeCode, String employeeName,
        String probationEndDate, long daysRemaining, String jobTitle, String managerName) {}

    public record ReminderDto(
        UUID id, UUID employeeId, String employeeName, String probationEndDate,
        String reminderType, String sentAt) {}

    public record ScanResult(int scanned, int remindersSent) {}

    // ── Config ──────────────────────────────────────────────────────────────

    @Transactional
    public ProbationConfigDto getConfig(UUID tenantId) {
        bindTenant(tenantId);
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT reminder_days_before, auto_extend_enabled, auto_extend_days FROM hrms.probation_config WHERE tenant_id = ?",
            tenantId);
        if (rows.isEmpty()) {
            return new ProbationConfigDto(defaultReminderDaysBefore, false, 90);
        }
        Map<String, Object> r = rows.get(0);
        return new ProbationConfigDto(
            ((Number) r.get("reminder_days_before")).intValue(),
            Boolean.TRUE.equals(r.get("auto_extend_enabled")),
            ((Number) r.get("auto_extend_days")).intValue());
    }

    @Transactional
    public ProbationConfigDto updateConfig(UUID tenantId, ProbationConfigDto req) {
        if (req.reminderDaysBefore() < 1 || req.reminderDaysBefore() > 90) {
            throw new BusinessRuleException("Reminder days must be between 1 and 90", "INVALID_REMINDER_DAYS");
        }
        bindTenant(tenantId);
        jdbc.update("""
            INSERT INTO hrms.probation_config (tenant_id, reminder_days_before, auto_extend_enabled, auto_extend_days, updated_at)
            VALUES (?, ?, ?, ?, now())
            ON CONFLICT (tenant_id) DO UPDATE
                SET reminder_days_before = EXCLUDED.reminder_days_before,
                    auto_extend_enabled  = EXCLUDED.auto_extend_enabled,
                    auto_extend_days     = EXCLUDED.auto_extend_days,
                    updated_at           = now()
            """, tenantId, req.reminderDaysBefore(), req.autoExtendEnabled(), req.autoExtendDays());
        return new ProbationConfigDto(req.reminderDaysBefore(), req.autoExtendEnabled(), req.autoExtendDays());
    }

    // ── Dashboard list ──────────────────────────────────────────────────────

    @Transactional
    public List<UpcomingProbationDto> listUpcoming(UUID tenantId, int daysAhead) {
        bindTenant(tenantId);
        LocalDate windowEnd = LocalDate.now().plusDays(daysAhead);
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT e.id, e.employee_code, e.first_name, e.last_name, e.probation_end_date,
                   d.title AS job_title, m.first_name AS mgr_first, m.last_name AS mgr_last
              FROM hrms.employees e
              LEFT JOIN hrms.designations d ON d.id = e.designation_id
              LEFT JOIN hrms.employees    m ON m.id = e.reporting_manager_id
             WHERE e.is_active = TRUE
               AND e.employment_status = 'PROBATION'
               AND e.probation_end_date IS NOT NULL
               AND e.probation_end_date <= ?
             ORDER BY e.probation_end_date ASC
            """, windowEnd);
        List<UpcomingProbationDto> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            LocalDate end = ((java.sql.Date) r.get("probation_end_date")).toLocalDate();
            long days = ChronoUnit.DAYS.between(LocalDate.now(), end);
            out.add(new UpcomingProbationDto(
                (UUID) r.get("id"), (String) r.get("employee_code"),
                name(r.get("first_name"), r.get("last_name")),
                end.toString(), days, (String) r.get("job_title"),
                managerName(r.get("mgr_first"), r.get("mgr_last"))));
        }
        return out;
    }

    @Transactional
    public List<ReminderDto> listReminders(UUID tenantId) {
        bindTenant(tenantId);
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT l.id, l.employee_id, l.probation_end_date, l.reminder_type, l.sent_at,
                   e.first_name, e.last_name
              FROM hrms.probation_reminder_log l
              LEFT JOIN hrms.employees e ON e.id = l.employee_id
             ORDER BY l.sent_at DESC
             LIMIT 50
            """);
        List<ReminderDto> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            out.add(new ReminderDto(
                (UUID) r.get("id"), (UUID) r.get("employee_id"),
                name(r.get("first_name"), r.get("last_name")),
                ((java.sql.Date) r.get("probation_end_date")).toLocalDate().toString(),
                (String) r.get("reminder_type"),
                String.valueOf(r.get("sent_at"))));
        }
        return out;
    }

    // ── Extend ──────────────────────────────────────────────────────────────

    @Transactional
    public void extendProbation(UUID tenantId, UUID employeeId, LocalDate newEndDate) {
        if (newEndDate == null) throw new BusinessRuleException("New end date is required", "DATE_REQUIRED");
        bindTenant(tenantId);
        int updated = jdbc.update("""
            UPDATE hrms.employees
               SET probation_end_date = ?, updated_at = now()
             WHERE id = ? AND employment_status = 'PROBATION'
            """, newEndDate, employeeId);
        if (updated == 0) {
            throw new BusinessRuleException("Employee not found or not in probation", "EMPLOYEE_NOT_IN_PROBATION");
        }
    }

    // ── Scan ────────────────────────────────────────────────────────────────

    /**
     * Scan one tenant: find PROBATION employees whose probation_end_date is within
     * reminderDaysBefore days and have no UPCOMING reminder yet; email manager + HR
     * and log the reminder. Returns the number of reminders fired.
     */
    @Transactional
    public int scanForTenant(UUID tenantId) {
        bindTenant(tenantId);
        ProbationConfigDto config = getConfigInline(tenantId);
        LocalDate windowEnd = LocalDate.now().plusDays(config.reminderDaysBefore());
        String tenantName = loadTenantName(tenantId);

        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email,
                   e.probation_end_date, e.reporting_manager_id
              FROM hrms.employees e
             WHERE e.is_active = TRUE
               AND e.employment_status = 'PROBATION'
               AND e.probation_end_date IS NOT NULL
               AND e.probation_end_date BETWEEN CURRENT_DATE AND ?
             ORDER BY e.probation_end_date ASC
            """, windowEnd);

        int fired = 0;
        for (Map<String, Object> r : rows) {
            UUID empId = (UUID) r.get("id");
            LocalDate end = ((java.sql.Date) r.get("probation_end_date")).toLocalDate();

            Integer existing = jdbc.queryForObject("""
                SELECT count(*) FROM hrms.probation_reminder_log
                 WHERE employee_id = ? AND probation_end_date = ? AND reminder_type = 'UPCOMING'
                """, Integer.class, empId, end);
            if (existing != null && existing > 0) continue;

            String empName = name(r.get("first_name"), r.get("last_name"));
            long daysRemaining = ChronoUnit.DAYS.between(LocalDate.now(), end);

            Set<UUID> recipientIds = new LinkedHashSet<>();
            List<String> recipientEmails = new ArrayList<>();
            collectRecipients(tenantId, (UUID) r.get("reporting_manager_id"), recipientIds, recipientEmails);

            String deepLink = platformBaseUrl + "/hrms/employees/" + empId;
            String subject = String.format("Probation ending: %s (%d days)", empName, daysRemaining);
            String body = buildEmailHtml(empName, end.toString(), daysRemaining, deepLink);
            for (String to : recipientEmails) {
                try {
                    mailService.send(EmailMessage.simple(to, subject, body));
                } catch (Exception e) {
                    log.warn("Probation email to {} failed: {}", to, e.getMessage());
                }
            }

            jdbc.update(con -> {
                Array arr = con.createArrayOf("uuid", recipientIds.toArray(new UUID[0]));
                var ps = con.prepareStatement("""
                    INSERT INTO hrms.probation_reminder_log
                        (tenant_id, employee_id, probation_end_date, reminder_type, notified_user_ids)
                    VALUES (?, ?, ?, 'UPCOMING', ?)
                    ON CONFLICT (tenant_id, employee_id, probation_end_date, reminder_type) DO NOTHING
                    """);
                ps.setObject(1, tenantId);
                ps.setObject(2, empId);
                ps.setObject(3, java.sql.Date.valueOf(end));
                ps.setArray(4, arr);
                return ps;
            });
            fired++;
        }
        log.info("Probation scan tenant {} fired {} reminder(s)", tenantId, fired);
        return fired;
    }

    /**
     * Manual single-tenant scan for the /scan-now endpoint. MUST be @Transactional
     * itself: it self-invokes scanForTenant (same bean), so the inner method's
     * @Transactional proxy does not apply — without a transaction here, the
     * SET LOCAL tenant binding and the reminder-log INSERT would not take effect.
     */
    @Transactional
    public ScanResult scanNow(UUID tenantId) {
        int sent = scanForTenant(tenantId);
        return new ScanResult(sent, sent);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private ProbationConfigDto getConfigInline(UUID tenantId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT reminder_days_before, auto_extend_enabled, auto_extend_days FROM hrms.probation_config WHERE tenant_id = ?",
            tenantId);
        if (rows.isEmpty()) return new ProbationConfigDto(defaultReminderDaysBefore, false, 90);
        Map<String, Object> r = rows.get(0);
        return new ProbationConfigDto(
            ((Number) r.get("reminder_days_before")).intValue(),
            Boolean.TRUE.equals(r.get("auto_extend_enabled")),
            ((Number) r.get("auto_extend_days")).intValue());
    }

    private void collectRecipients(UUID tenantId, UUID managerEmployeeId,
                                   Set<UUID> ids, List<String> emails) {
        if (managerEmployeeId != null) {
            jdbc.queryForList("""
                SELECT uc.id, uc.email FROM auth.user_credentials uc
                 WHERE uc.employee_id = ? AND uc.is_active = TRUE AND uc.email IS NOT NULL
                """, managerEmployeeId).forEach(m -> {
                ids.add((UUID) m.get("id"));
                emails.add((String) m.get("email"));
            });
        }
        jdbc.queryForList("""
            SELECT DISTINCT uc.id, uc.email
              FROM rbac.user_roles ur
              JOIN rbac.roles r            ON r.id = ur.role_id
              JOIN auth.user_credentials uc ON uc.id = ur.user_id
             WHERE ur.tenant_id = ?
               AND r.code = 'HR_MANAGER'
               AND uc.is_active = TRUE
               AND uc.email IS NOT NULL
            """, tenantId).forEach(m -> {
            UUID id = (UUID) m.get("id");
            if (ids.add(id)) emails.add((String) m.get("email"));
        });
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }

    private String loadTenantName(UUID tenantId) {
        try {
            return jdbc.queryForObject("SELECT display_name FROM platform.tenants WHERE id = ?", String.class, tenantId);
        } catch (Exception e) { return "UnifiedTree"; }
    }

    private static String name(Object first, Object last) {
        String f = first == null ? "" : first.toString();
        String l = last == null ? "" : last.toString();
        String full = (f + " " + l).trim();
        return full.isEmpty() ? "Employee" : full;
    }

    private static String managerName(Object first, Object last) {
        if (first == null && last == null) return null;
        return name(first, last);
    }

    private static String buildEmailHtml(String empName, String endDate, long days, String deepLink) {
        return """
            <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">
              <h2 style="color:#047857">Probation Ending Soon</h2>
              <p>%s's probation period ends on <strong>%s</strong> (%d days from today).</p>
              <p>Please review and take one of these actions:</p>
              <ul>
                <li>Confirm as a permanent employee</li>
                <li>Extend the probation period</li>
                <li>Initiate exit if performance is unsatisfactory</li>
              </ul>
              <p style="text-align:center;margin:32px 0">
                <a href="%s" style="background:#047857;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Open Employee Record</a>
              </p>
              <p style="color:#666;font-size:14px">Or copy this link:<br><code>%s</code></p>
            </body></html>
            """.formatted(empName, endDate, days, deepLink, deepLink);
    }
}
