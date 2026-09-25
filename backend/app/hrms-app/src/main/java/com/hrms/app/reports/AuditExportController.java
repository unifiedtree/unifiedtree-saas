package com.hrms.app.reports;

import com.hrms.api.audit.AuditRecordNames;
import com.unifiedtree.audit.AuditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ContentDisposition;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The whole filtered audit trail as a CSV, streamed: the same filters as the
 * Audit logs screen (who, action, resource, record id, date range), every
 * matching event, newest first. Read in chunks of {@value #CHUNK} (each in its
 * own short transaction, walking by time and id), so a large trail neither
 * holds a connection nor sits in memory, and the file starts downloading at
 * once. Sensitive fields in "what changed" are masked exactly as on screen.
 *
 * <p>Same permission as the screen (audit.read). The export itself is written
 * to the export log and to the audit trail.
 */
@RestController
@RequestMapping("/v1/audit/events")
@Tag(name = "Audit", description = "Tenant-scoped audit event log")
@SecurityRequirement(name = "bearerAuth")
public class AuditExportController {

    private static final Logger log = LoggerFactory.getLogger(AuditExportController.class);
    static final int CHUNK = 1000;
    /** A hard stop so one click can't stream forever; the file says when it was reached. */
    static final int MAX_ROWS = 500_000;
    private static final Pattern PII = Pattern.compile(
            "\"(pan_encrypted|account_number_encrypted|aadhaar_encrypted|passport_number_encrypted)\"\\s*:\\s*\"[^\"]*\"",
            Pattern.CASE_INSENSITIVE);
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ENGLISH);

    private final JdbcTemplate jdbc;
    private final AuditRecordNames names;
    private final ReportExportLog exportLog;
    private final AuditService audit;
    private final TransactionTemplate readTx;

    public AuditExportController(JdbcTemplate jdbc, AuditRecordNames names, ReportExportLog exportLog, AuditService audit,
                                 PlatformTransactionManager txm) {
        this.jdbc = jdbc;
        this.names = names;
        this.exportLog = exportLog;
        this.audit = audit;
        this.readTx = new TransactionTemplate(txm);
        this.readTx.setReadOnly(true);
    }

    @GetMapping("/export.csv")
    @Operation(summary = "Every audit event matching the filters, as a streamed CSV")
    @PreAuthorize("hasAuthority('audit.read')")
    public void export(@RequestParam(required = false) String actor,
                       @RequestParam(required = false) String resource,
                       @RequestParam(required = false) String resourceId,
                       @RequestParam(required = false) String action,
                       @RequestParam(required = false) String from,
                       @RequestParam(required = false) String to,
                       HttpServletResponse response) throws IOException {
        Filter f = filter(actor, resource, resourceId, action, from, to);
        String file = "audit-log-" + LocalDate.now(ReportPdfService.IST) + ".csv";
        response.setContentType("text/csv;charset=UTF-8");
        response.setHeader("Content-Disposition", ContentDisposition.attachment().filename(file).build().toString());
        response.setHeader("Cache-Control", "no-store");

        int rows = 0;
        long bytes = 0;
        boolean truncated = false;
        OutputStream raw = response.getOutputStream();
        CountingWriter out = new CountingWriter(new OutputStreamWriter(raw, StandardCharsets.UTF_8));
        out.write('﻿');
        line(out, List.of("When (IST)", "Who", "Email", "Action", "Module", "Resource", "Record", "Record ID", "Summary",
                "IP address", "Browser / device", "Trace ID", "Event ID", "What changed"));
        if (!f.nothing()) {
            Instant afterAt = null;
            UUID afterId = null;
            while (true) {
                final Instant at = afterAt;
                final UUID id = afterId;
                List<Map<String, Object>> chunk = readTx.execute(s -> chunk(f, at, id));
                if (chunk == null || chunk.isEmpty()) break;
                for (Map<String, Object> r : chunk) {
                    if (rows >= MAX_ROWS) { truncated = true; break; }
                    line(out, row(r));
                    rows++;
                }
                out.flush();
                if (truncated || chunk.size() < CHUNK) break;
                Map<String, Object> last = chunk.get(chunk.size() - 1);
                afterAt = ((Timestamp) last.get("occurred_at")).toInstant();
                afterId = (UUID) last.get("id");
            }
        }
        if (truncated) line(out, List.of("Stopped at " + MAX_ROWS + " events. Narrow the dates or filters to export the rest."));
        out.flush();
        bytes = out.count;

        Map<String, Object> filters = new LinkedHashMap<>();
        if (notBlank(actor)) filters.put("who", actor.trim());
        if (notBlank(action)) filters.put("action", action.trim());
        if (notBlank(resource)) filters.put("resource", resource.trim());
        if (notBlank(resourceId)) filters.put("recordId", resourceId.trim());
        if (f.from() != null) filters.put("from", f.from().toString());
        if (f.to() != null) filters.put("to", f.to().toString());
        if (truncated) filters.put("truncated", true);
        exportLog.record(new ReportExportLog.Entry(ReportKind.AUDIT_LOG, "CSV", "SERVER", file, null, null, filters, rows, bytes, null, null));
        try {
            audit.record("audit", "EXPORT", "audit_log", null, "Exported " + rows + (rows == 1 ? " audit event" : " audit events") + " to CSV");
        } catch (RuntimeException e) {
            log.warn("Audit export not recorded in the audit trail: {}", e.getMessage());
        }
    }

    // ── query ────────────────────────────────────────────────────────────────

    record Filter(boolean nothing, UUID actorId, String action, String resource, UUID recordId, Instant from, Instant to) {}

    Filter filter(String actor, String resource, String resourceId, String action, String from, String to) {
        AuditRecordNames.ActorFilter who = readTx.execute(s -> names.actor(actor));
        UUID recordId = null;
        boolean nothing = who == null || who.matchesNothing();
        if (notBlank(resourceId)) {
            try { recordId = UUID.fromString(resourceId.trim()); } catch (IllegalArgumentException e) { nothing = true; }
        }
        return new Filter(nothing, who == null ? null : who.userId(), notBlank(action) ? action.trim() : null,
                notBlank(resource) ? resource.trim() : null, recordId, instant(from), instant(to));
    }

    private List<Map<String, Object>> chunk(Filter f, Instant afterAt, UUID afterId) {
        StringBuilder sql = new StringBuilder("""
                SELECT e.id, e.occurred_at, e.actor_user_id, e.actor_email, e.actor_ip, e.actor_user_agent, e.module, e.action,
                       e.entity_type, e.entity_id, e.summary, e.diff::text AS diff, COALESCE(e.correlation_id, e.request_id) AS trace_id,
                       COALESCE(NULLIF(btrim(c.display_name), ''), NULLIF(btrim(concat_ws(' ', emp.first_name, emp.last_name)), '')) AS actor_name,
                       c.email AS user_email
                  FROM audit.events e
                  LEFT JOIN auth.user_credentials c ON c.id = e.actor_user_id
                  LEFT JOIN hrms.employees emp ON emp.id = c.employee_id
                 WHERE TRUE""");
        List<Object> args = new ArrayList<>();
        if (f.actorId() != null) { sql.append(" AND e.actor_user_id = ?"); args.add(f.actorId()); }
        if (f.action() != null) { sql.append(" AND upper(e.action) = upper(?)"); args.add(f.action()); }
        if (f.resource() != null) { sql.append(" AND e.entity_type = ?"); args.add(f.resource()); }
        if (f.recordId() != null) { sql.append(" AND e.entity_id = ?"); args.add(f.recordId()); }
        if (f.from() != null) { sql.append(" AND e.occurred_at >= ?::timestamptz"); args.add(Timestamp.from(f.from())); }
        if (f.to() != null) { sql.append(" AND e.occurred_at <= ?::timestamptz"); args.add(Timestamp.from(f.to())); }
        if (afterAt != null) {
            sql.append(" AND (e.occurred_at, e.id) < (?::timestamptz, ?::uuid)");
            args.add(Timestamp.from(afterAt));
            args.add(afterId);
        }
        sql.append(" ORDER BY e.occurred_at DESC, e.id DESC LIMIT ").append(CHUNK);
        List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), args.toArray());
        Map<String, AuditRecordNames.Named> named = names.resolve(rows.stream()
                .map(r -> new AuditRecordNames.Ref((String) r.get("entity_type"), (UUID) r.get("entity_id"))).toList());
        for (Map<String, Object> r : rows) {
            UUID id = (UUID) r.get("entity_id");
            AuditRecordNames.Named n = id == null ? null : named.get(AuditRecordNames.key((String) r.get("entity_type"), id));
            r.put("record_name", n == null ? null : n.name());
        }
        return rows;
    }

    private static List<Object> row(Map<String, Object> r) {
        Timestamp at = (Timestamp) r.get("occurred_at");
        String who = r.get("actor_name") != null ? (String) r.get("actor_name")
                : r.get("actor_email") != null ? (String) r.get("actor_email")
                : r.get("user_email") != null ? (String) r.get("user_email")
                : r.get("actor_user_id") != null ? "A user" : "System";
        String email = r.get("actor_email") != null ? (String) r.get("actor_email") : (String) r.get("user_email");
        String diff = (String) r.get("diff");
        List<Object> out = new ArrayList<>();
        out.add(at == null ? "" : WHEN.format(at.toInstant().atZone(ReportPdfService.IST)));
        out.add(who);
        out.add(email);
        out.add(r.get("action"));
        out.add(r.get("module"));
        out.add(r.get("entity_type"));
        out.add(r.get("record_name"));
        out.add(r.get("entity_id"));
        out.add(r.get("summary"));
        out.add(r.get("actor_ip"));
        out.add(r.get("actor_user_agent"));
        out.add(r.get("trace_id"));
        out.add(r.get("id"));
        out.add(diff == null ? null : PII.matcher(diff).replaceAll("\"$1\":\"<encrypted>\""));
        return out;
    }

    // ── CSV ──────────────────────────────────────────────────────────────────

    private static void line(Writer out, List<?> cells) throws IOException {
        for (int i = 0; i < cells.size(); i++) {
            if (i > 0) out.write(',');
            out.write(cell(cells.get(i)));
        }
        out.write("\r\n");
    }

    /** RFC 4180, plus a leading ' on text a spreadsheet would run as a formula. */
    static String cell(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v);
        if (!s.isEmpty() && "=+-@\t\r".indexOf(s.charAt(0)) >= 0) s = "'" + s;
        boolean quote = s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0 || s.indexOf('\'') >= 0;
        return quote ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }

    private static Instant instant(String v) {
        if (!notBlank(v)) return null;
        try { return Instant.parse(v.trim()); } catch (java.time.format.DateTimeParseException e) { return null; }
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    /** Counts the characters written (for the export log's size). */
    private static final class CountingWriter extends Writer {
        private final Writer inner;
        long count;
        CountingWriter(Writer inner) { this.inner = inner; }
        @Override public void write(char[] buf, int off, int len) throws IOException { inner.write(buf, off, len); count += len; }
        @Override public void flush() throws IOException { inner.flush(); }
        @Override public void close() throws IOException { inner.close(); }
    }
}
