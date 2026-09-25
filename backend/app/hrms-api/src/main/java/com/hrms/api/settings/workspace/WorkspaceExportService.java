package com.hrms.api.settings.workspace;

import com.hrms.api.mail.EmailMessage;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import com.unifiedtree.settings.branding.DocumentStorage;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.BufferedOutputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Full workspace data export (Settings -> Danger zone -> Export all data).
 *
 * <p>A request is stored as QUEUED and built on a background thread (one at a
 * time per server, so an export never competes with sign-ins for the database
 * pool). The zip goes to the private document store when it is configured,
 * otherwise into the database row (up to {@value #MAX_DB_BYTES} bytes). The
 * person who asked is emailed when it's ready; any holder of
 * {@code workspace.data.export} can download it for {@value #KEEP_DAYS} days,
 * after which it is deleted. One export at a time per workspace.
 */
@Service
public class WorkspaceExportService {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceExportService.class);

    static final int KEEP_DAYS = 7;
    static final long MAX_DB_BYTES = 25L * 1024 * 1024;
    static final long MAX_BYTES = 300L * 1024 * 1024;
    /** A job still QUEUED/RUNNING after this long died with its server. */
    static final int STALE_MINUTES = 120;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public record ExportView(UUID id, String status, String requestedByEmail, OffsetDateTime createdAt,
                             OffsetDateTime completedAt, OffsetDateTime expiresAt, Long sizeBytes, Integer tableCount,
                             Long rowCount, String fileName, String error, int downloadCount) {}

    public record Download(String fileName, byte[] bytes) {}

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final WorkspaceExportWriter writer;
    private final DocumentStorage storage;
    private final WorkspaceMailer mailer;
    private final AuditService audit;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "workspace-export");
        t.setDaemon(true);
        return t;
    });

    public WorkspaceExportService(JdbcTemplate jdbc, PlatformTransactionManager txManager, WorkspaceExportWriter writer,
                                  DocumentStorage storage, WorkspaceMailer mailer, AuditService audit) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
        this.writer = writer;
        this.storage = storage;
        this.mailer = mailer;
        this.audit = audit;
    }

    @PreDestroy
    void stop() {
        worker.shutdownNow();
    }

    @Transactional
    public ExportView request(UUID tenantId, UUID userId, String email) {
        failStale(tenantId);
        Integer open = jdbc.queryForObject(
                "SELECT count(*)::int FROM platform.workspace_data_exports WHERE tenant_id = ? AND status IN ('QUEUED', 'RUNNING')",
                Integer.class, tenantId);
        if (open != null && open > 0) {
            throw new HrmsException("An export is already being prepared. You'll get an email when it's ready.",
                    HttpStatus.CONFLICT, "EXPORT_IN_PROGRESS");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO platform.workspace_data_exports (id, tenant_id, requested_by, requested_by_email, status)
                VALUES (?, ?, ?, ?, 'QUEUED')
                """, id, tenantId, userId, email);
        audit.record("settings", "WORKSPACE_EXPORT_REQUESTED", "workspace_export", id, "Requested a full data export");
        Runnable start = () -> worker.submit(() -> run(tenantId, id));
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { start.run(); }
            });
        } else {
            start.run();
        }
        return find(tenantId, id);
    }

    @Transactional
    public List<ExportView> list(UUID tenantId) {
        failStale(tenantId);
        return jdbc.query(SELECT + " WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10", this::map, tenantId);
    }

    /** Bytes of a ready export; counts the download. */
    @Transactional
    public Download download(UUID tenantId, UUID id) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT status, storage, file_key, file_bytes, file_name, expires_at
                  FROM platform.workspace_data_exports WHERE id = ? AND tenant_id = ?
                """, id, tenantId);
        if (rows.isEmpty()) throw new HrmsException("That export doesn't exist.", HttpStatus.NOT_FOUND, "EXPORT_NOT_FOUND");
        Map<String, Object> r = rows.get(0);
        Timestamp exp = (Timestamp) r.get("expires_at");
        if (!"READY".equals(r.get("status")) || exp == null || exp.toInstant().isBefore(java.time.Instant.now())) {
            throw new HrmsException("This export is no longer available. Request a new one.", HttpStatus.GONE, "EXPORT_EXPIRED");
        }
        byte[] bytes = "R2".equals(r.get("storage")) ? storage.read((String) r.get("file_key")) : (byte[]) r.get("file_bytes");
        if (bytes == null) throw new HrmsException("The export file is missing. Request a new one.", HttpStatus.GONE, "EXPORT_EXPIRED");
        jdbc.update("UPDATE platform.workspace_data_exports SET download_count = download_count + 1, downloaded_at = now() WHERE id = ?", id);
        audit.record("settings", "WORKSPACE_EXPORT_DOWNLOADED", "workspace_export", id, "Downloaded the full data export");
        return new Download((String) r.get("file_name"), bytes);
    }

    /** Hourly: fail jobs that died with their server, delete exports past their 7 days. */
    @Transactional
    public int housekeeping(UUID tenantId) {
        int failed = failStale(tenantId);
        List<Map<String, Object>> old = jdbc.queryForList("""
                SELECT id, storage, file_key FROM platform.workspace_data_exports
                 WHERE tenant_id = ? AND status = 'READY' AND expires_at <= now()
                """, tenantId);
        for (Map<String, Object> r : old) {
            if ("R2".equals(r.get("storage")) && r.get("file_key") != null) storage.deleteQuietly((String) r.get("file_key"));
            jdbc.update("UPDATE platform.workspace_data_exports SET status = 'EXPIRED', file_bytes = NULL WHERE id = ?", r.get("id"));
        }
        return failed + old.size();
    }

    // ---- the background job ------------------------------------------------------

    void run(UUID tenantId, UUID id) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        Path tmp = null;
        String requester = null;
        try {
            Map<String, Object> claimed = tx.execute(s -> {
                int n = jdbc.update("UPDATE platform.workspace_data_exports SET status = 'RUNNING', started_at = now() WHERE id = ? AND status = 'QUEUED'", id);
                return n == 1 ? jdbc.queryForMap("SELECT requested_by_email FROM platform.workspace_data_exports WHERE id = ?", id) : null;
            });
            if (claimed == null) return;
            requester = (String) claimed.get("requested_by_email");
            String workspace = tx.execute(s -> mailer.workspaceName(tenantId));
            String slug = tx.execute(s -> jdbc.queryForList("SELECT subdomain FROM platform.tenants WHERE id = ?", String.class, tenantId)
                    .stream().findFirst().orElse("workspace"));

            tmp = Files.createTempFile("workspace-export-", ".zip");
            WorkspaceExportWriter.Stats stats;
            try (OutputStream out = new BufferedOutputStream(Files.newOutputStream(tmp))) {
                stats = writer.write(tenantId, workspace, requester, out);
            }
            long size = Files.size(tmp);
            if (size > MAX_BYTES) throw new IllegalStateException("The export is larger than 300 MB. Contact support for a bulk export.");
            byte[] bytes = Files.readAllBytes(tmp);
            String fileName = slug + "-data-export-" + LocalDate.now(IST) + ".zip";
            String storedIn;
            String key = null;
            if (storage.isConfigured()) {
                key = "workspace-exports/" + tenantId + "/" + id + ".zip";
                storage.put(key, bytes, "application/zip");
                storedIn = "R2";
            } else if (size <= MAX_DB_BYTES) {
                storedIn = "DB";
            } else {
                throw new IllegalStateException("File storage isn't set up and the export is over 25 MB.");
            }
            final String k = key;
            tx.executeWithoutResult(s -> jdbc.update("""
                    UPDATE platform.workspace_data_exports
                       SET status = 'READY', storage = ?, file_key = ?, file_bytes = ?, file_name = ?, size_bytes = ?,
                           table_count = ?, row_count = ?, completed_at = now(), expires_at = now() + make_interval(days => ?),
                           error = ?
                     WHERE id = ?
                    """, storedIn, k, "DB".equals(storedIn) ? bytes : null, fileName, size, stats.tables(), stats.rows(), KEEP_DAYS,
                    stats.failures().isEmpty() ? null : "Some tables could not be exported: " + String.join("; ", stats.failures()),
                    id));
            notifyReady(tenantId, requester, workspace, fileName);
            log.info("workspace export {} ready for tenant {}: {} tables, {} rows, {} bytes", id, tenantId, stats.tables(), stats.rows(), size);
        } catch (Exception e) {
            log.error("workspace export {} failed for tenant {}", id, tenantId, e);
            String msg = e.getMessage() == null ? "The export failed. Please try again." : e.getMessage();
            try {
                tx.executeWithoutResult(s -> jdbc.update("""
                        UPDATE platform.workspace_data_exports SET status = 'FAILED', error = ?, completed_at = now() WHERE id = ?
                        """, msg.length() > 500 ? msg.substring(0, 500) : msg, id));
            } catch (Exception inner) {
                log.error("could not mark export {} failed", id, inner);
            }
        } finally {
            if (tmp != null) {
                try { Files.deleteIfExists(tmp); } catch (Exception ignored) { /* temp dir is cleaned by the OS */ }
            }
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    private void notifyReady(UUID tenantId, String to, String workspace, String fileName) {
        if (to == null || to.isBlank()) return;
        String until = OffsetDateTime.now(IST).plusDays(KEEP_DAYS).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH));
        String link = tx.execute(s -> mailer.link(tenantId, "/settings/danger#st-export"));
        mailer.sendAfterCommit(List.of(new EmailMessage(to, null, workspace + ": your data export is ready",
                WorkspaceMailer.html(workspace, "Your data export is ready",
                        List.of("The full export of " + WorkspaceMailer.esc(workspace) + " (" + WorkspaceMailer.esc(fileName)
                                        + ") is ready. Sign in and open Settings, Danger zone to download it.",
                                "It stays available until " + until + ", then it is deleted. The file contains salaries and "
                                        + "personal details, so keep it somewhere safe."),
                        "Download the export", link), null, List.of()).withFromName(workspace)));
    }

    private int failStale(UUID tenantId) {
        return jdbc.update("""
                UPDATE platform.workspace_data_exports
                   SET status = 'FAILED', completed_at = now(),
                       error = 'The server restarted while this export was being prepared. Request a new one.'
                 WHERE tenant_id = ? AND status IN ('QUEUED', 'RUNNING') AND created_at < now() - make_interval(mins => ?)
                """, tenantId, STALE_MINUTES);
    }

    private static final String SELECT = """
            SELECT id, status, requested_by_email, created_at, completed_at, expires_at, size_bytes, table_count,
                   row_count, file_name, error, download_count
              FROM platform.workspace_data_exports
            """;

    private ExportView find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT + " WHERE id = ? AND tenant_id = ?", this::map, id, tenantId).stream().findFirst()
                .orElseThrow(() -> new HrmsException("That export doesn't exist.", HttpStatus.NOT_FOUND, "EXPORT_NOT_FOUND"));
    }

    private ExportView map(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new ExportView(rs.getObject("id", UUID.class), rs.getString("status"), rs.getString("requested_by_email"),
                ts(rs.getTimestamp("created_at")), ts(rs.getTimestamp("completed_at")), ts(rs.getTimestamp("expires_at")),
                (Long) rs.getObject("size_bytes"), (Integer) rs.getObject("table_count"), (Long) rs.getObject("row_count"),
                rs.getString("file_name"), rs.getString("error"), rs.getInt("download_count"));
    }

    private static OffsetDateTime ts(Timestamp t) {
        return t == null ? null : t.toInstant().atOffset(ZoneOffset.UTC);
    }
}
