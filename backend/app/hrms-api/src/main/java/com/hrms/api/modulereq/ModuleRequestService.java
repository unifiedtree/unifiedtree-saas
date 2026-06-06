package com.hrms.api.modulereq;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.hrms.api.modulereq.ModuleRequestController.ModuleRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Handles "please add these modules" requests from a workspace admin:
 * emails UnifiedTree and best-effort records REQUESTED rows in
 * {@code platform.tenant_modules}. It deliberately does NOT activate any
 * module — that stays a manual platform-admin step.
 *
 * <p>{@code platform.*} tables are not RLS-protected (managed by the platform
 * admin), so the best-effort insert needs no TenantContext binding.
 */
@Service
public class ModuleRequestService {

    private static final Logger log = LoggerFactory.getLogger(ModuleRequestService.class);

    /** Where add-module requests are routed for manual enablement. */
    private static final String NOTIFY_TO = "unifiedtree@gmail.com";

    private final MailService mailService;
    private final JdbcTemplate jdbc;

    public ModuleRequestService(MailService mailService, JdbcTemplate jdbc) {
        this.mailService = mailService;
        this.jdbc = jdbc;
    }

    public void handle(ModuleRequest req) {
        String subdomain = req.subdomain() == null ? "" : req.subdomain().trim().toLowerCase(Locale.ROOT);
        List<String> modules = normalizeModules(req.modules());

        sendNotification(subdomain, req.adminEmail(), req.adminName(), modules);
        bestEffortRecordRequested(subdomain, modules);
    }

    private void sendNotification(String subdomain, String adminEmail, String adminName, List<String> modules) {
        String subject = "Module add request: " + subdomain;
        String moduleList = modules.isEmpty() ? "(none specified)" : String.join(", ", modules);
        String html = """
                <h2>Module add request</h2>
                <p>A workspace admin has requested additional modules.</p>
                <table cellpadding="6" style="border-collapse:collapse">
                  <tr><td><b>Workspace</b></td><td>%s</td></tr>
                  <tr><td><b>Admin name</b></td><td>%s</td></tr>
                  <tr><td><b>Admin email</b></td><td>%s</td></tr>
                  <tr><td><b>Modules to add</b></td><td>%s</td></tr>
                </table>
                <p>This is a notification only — no module has been activated.
                   Enable the modules manually from the platform admin console.</p>
                """.formatted(
                        esc(subdomain),
                        esc(adminName == null || adminName.isBlank() ? "(not provided)" : adminName),
                        esc(adminEmail),
                        esc(moduleList));
        try {
            mailService.send(EmailMessage.simple(NOTIFY_TO, subject, html));
            log.info("Module add request emailed for workspace '{}' (modules: {})", subdomain, moduleList);
        } catch (Exception e) {
            // Surface the failure so the caller can retry; the request itself is not persisted state.
            log.error("Failed to email module add request for workspace '{}'", subdomain, e);
            throw e;
        }
    }

    /**
     * Best-effort: if the subdomain resolves to a tenant, park the requested
     * modules as REQUESTED rows (idempotent). Never fails the request.
     */
    private void bestEffortRecordRequested(String subdomain, List<String> modules) {
        if (subdomain.isBlank() || modules.isEmpty()) return;
        try {
            UUID tenantId = jdbc.query(
                    "SELECT id FROM platform.tenants WHERE subdomain = ?",
                    rs -> rs.next() ? UUID.fromString(rs.getString(1)) : null,
                    subdomain);
            if (tenantId == null) {
                log.info("Module add request: no tenant for subdomain '{}', skipping DB record", subdomain);
                return;
            }
            for (String moduleKey : modules) {
                jdbc.update("""
                        INSERT INTO platform.tenant_modules
                            (id, tenant_id, module_key, status, requested_at)
                        SELECT ?, ?, ?, 'REQUESTED', now()
                         WHERE EXISTS (SELECT 1 FROM platform.module_catalog WHERE key = ?)
                        ON CONFLICT (tenant_id, module_key) DO NOTHING
                        """, UUID.randomUUID(), tenantId, moduleKey, moduleKey);
            }
        } catch (Exception e) {
            // Best-effort only — the email is the canonical signal.
            log.warn("Module add request: failed to record REQUESTED rows for '{}'", subdomain, e);
        }
    }

    private static List<String> normalizeModules(List<String> modules) {
        if (modules == null) return List.of();
        return modules.stream()
                .filter(m -> m != null && !m.isBlank())
                .map(m -> m.trim().toLowerCase(Locale.ROOT))
                .distinct()
                .collect(Collectors.toList());
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
