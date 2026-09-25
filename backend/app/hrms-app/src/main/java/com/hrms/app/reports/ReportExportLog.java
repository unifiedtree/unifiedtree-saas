package com.hrms.app.reports;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The server export log (hrms.report_exports): one row per downloaded report
 * file, whoever built it. Server routes (report CSV and PDF, the audit log
 * export, scheduled emails) write their own row; files the browser builds
 * (Excel workbooks, chart PNGs, the on-screen CSVs) are recorded through
 * {@code POST /v1/reports/exports} by the page that made them.
 *
 * <p>Writes run in their own transaction (REQUIRES_NEW) so they commit with
 * the tenant bound on the connection whatever the caller is doing, and a
 * logging failure never breaks the download itself: it is logged loudly and
 * the file still goes out.
 */
@Service
public class ReportExportLog {

    private static final Logger log = LoggerFactory.getLogger(ReportExportLog.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final TransactionTemplate readTx;

    public ReportExportLog(JdbcTemplate jdbc, ObjectMapper json, PlatformTransactionManager txm) {
        this.jdbc = jdbc;
        this.json = json;
        this.tx = new TransactionTemplate(txm);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readTx = new TransactionTemplate(txm);
        this.readTx.setReadOnly(true);
    }

    /** What was exported. {@code userId} null means the signed-in user. */
    public record Entry(ReportKind report, String format, String source, String fileName, UUID companyId,
                        String companyName, Map<String, Object> filters, Integer rowCount, Long sizeBytes,
                        UUID scheduleId, UUID userId) {}

    /** Records an export; returns its id, or null when it could not be written. */
    public UUID record(Entry e) {
        UUID tenant = TenantContext.getTenantId();
        if (tenant == null) {
            log.error("Export not logged: no tenant bound (report={}, format={})", e.report().key(), e.format());
            return null;
        }
        UUID user = e.userId() != null ? e.userId() : TenantContext.getUserId();
        try {
            return tx.execute(status -> {
                String company = e.companyName();
                if ((company == null || company.isBlank()) && e.companyId() != null) {
                    List<String> names = jdbc.queryForList("SELECT name FROM org.companies WHERE id = ?", String.class, e.companyId());
                    company = names.isEmpty() ? null : names.get(0);
                }
                UUID id = UUID.randomUUID();
                jdbc.update("""
                        INSERT INTO hrms.report_exports (id, tenant_id, user_id, report, report_label, format, source,
                                                         file_name, company_id, company_name, filters, row_count, size_bytes, schedule_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
                        """, id, tenant, user, e.report().key(), e.report().label(), e.format(), e.source(),
                        trim(e.fileName(), 255), e.companyId(), trim(company, 255), filtersJson(e.filters()),
                        e.rowCount(), e.sizeBytes(), e.scheduleId());
                return id;
            });
        } catch (RuntimeException ex) {
            log.error("Export not logged (report={}, format={}, user={}): {}", e.report().key(), e.format(), user, ex.getMessage(), ex);
            return null;
        }
    }

    /** One page of the log, newest first; everyone's rows when {@code all}, else the caller's own. */
    public Map<String, Object> list(boolean all, int page, int size) {
        UUID me = TenantContext.getUserId();
        int p = Math.max(0, page), s = Math.max(1, Math.min(100, size));
        return readTx.execute(status -> {
            String where = all ? "" : " WHERE x.user_id = ?";
            Object[] countArgs = all ? new Object[0] : new Object[]{me};
            Long total = jdbc.queryForObject("SELECT count(*) FROM hrms.report_exports x" + where, Long.class, countArgs);
            List<Object> args = new ArrayList<>(List.of(countArgs));
            args.add(s);
            args.add(p * s);
            List<Map<String, Object>> rows = new ArrayList<>();
            jdbc.query("""
                    SELECT x.id, x.user_id, x.report, x.report_label, x.format, x.source, x.file_name, x.company_id, x.company_name,
                           x.filters::text AS filters, x.row_count, x.size_bytes, x.schedule_id, x.created_at,
                           COALESCE(NULLIF(btrim(c.display_name), ''), NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), c.email) AS user_name,
                           c.email AS user_email
                      FROM hrms.report_exports x
                      LEFT JOIN auth.user_credentials c ON c.id = x.user_id
                      LEFT JOIN hrms.employees e ON e.id = c.employee_id
                    """ + where + " ORDER BY x.created_at DESC, x.id LIMIT ? OFFSET ?", rs -> {
                Map<String, Object> m = new LinkedHashMap<>();
                UUID userId = rs.getObject("user_id", UUID.class);
                m.put("id", rs.getObject("id", UUID.class));
                m.put("report", rs.getString("report"));
                m.put("label", rs.getString("report_label"));
                m.put("format", rs.getString("format"));
                m.put("source", rs.getString("source"));
                m.put("fileName", rs.getString("file_name"));
                m.put("companyId", rs.getObject("company_id", UUID.class));
                m.put("companyName", rs.getString("company_name"));
                m.put("filters", parse(rs.getString("filters")));
                m.put("rowCount", rs.getObject("row_count"));
                m.put("sizeBytes", rs.getObject("size_bytes"));
                m.put("scheduleId", rs.getObject("schedule_id", UUID.class));
                Timestamp at = rs.getTimestamp("created_at");
                m.put("createdAt", at == null ? null : at.toInstant().toString());
                m.put("userId", userId);
                m.put("userName", rs.getString("user_name"));
                m.put("userEmail", rs.getString("user_email"));
                m.put("mine", userId != null && userId.equals(me));
                rows.add(m);
            }, args.toArray());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("content", rows);
            out.put("total", total == null ? 0 : total);
            out.put("page", p);
            out.put("size", s);
            out.put("scope", all ? "all" : "mine");
            return out;
        });
    }

    private String filtersJson(Map<String, Object> filters) {
        try {
            return json.writeValueAsString(filters == null ? Map.of() : filters);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    private Object parse(String text) {
        if (text == null) return Map.of();
        try {
            return json.readValue(text, Map.class);
        } catch (JsonProcessingException e) {
            return Map.of();
        }
    }

    private static String trim(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
