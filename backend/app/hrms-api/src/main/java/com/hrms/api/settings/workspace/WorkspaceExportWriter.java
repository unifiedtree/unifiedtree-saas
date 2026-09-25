package com.hrms.api.settings.workspace;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.sql.Array;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Writes a workspace's data as a zip: one folder per module, one CSV (UTF-8,
 * Excel-friendly) per table, plus users-and-access.csv and a README that lists
 * every file, its row count, and what was left out on purpose.
 *
 * <p>Tables are discovered from the catalogue (every table with a tenant_id
 * column in the business schemas), so modules added later are exported
 * without touching this class. Partitions are read through their parent once.
 * Secrets are never written: passwords, tokens, two-factor secrets, face
 * templates, encrypted columns and full identity/bank numbers (see
 * {@link #excluded}).
 *
 * <p>Must run with the workspace bound (TenantContext): each table is read in
 * its own read-only transaction so RLS applies, and every query also filters
 * on tenant_id. One table failing is recorded in the README and the rest carry on.
 */
@Component
public class WorkspaceExportWriter {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceExportWriter.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** Business schema -> folder in the zip (numbered so they sort in a sensible order). */
    static final Map<String, String> FOLDERS = new LinkedHashMap<>();
    static {
        FOLDERS.put("org", "01-organisation");
        FOLDERS.put("hrms", "02-people");
        FOLDERS.put("attendance", "03-attendance");
        FOLDERS.put("leave_mgmt", "04-leave");
        FOLDERS.put("payroll", "05-payroll");
        FOLDERS.put("expense_mgmt", "06-expenses");
        FOLDERS.put("advance_mgmt", "07-advances");
        FOLDERS.put("fnf_mgmt", "08-exit-and-final-settlement");
        FOLDERS.put("hiring_mgmt", "09-hiring");
        FOLDERS.put("performance_mgmt", "10-performance");
        FOLDERS.put("learning_mgmt", "11-learning");
        FOLDERS.put("compliance_mgmt", "12-compliance");
        FOLDERS.put("policy_mgmt", "13-policies");
        FOLDERS.put("pli_mgmt", "14-incentives");
        FOLDERS.put("document_mgmt", "15-documents");
        FOLDERS.put("letters", "16-letters");
        FOLDERS.put("settings", "17-settings");
        FOLDERS.put("notiftemplate_mgmt", "18-notification-templates");
        FOLDERS.put("integration_mgmt", "19-integrations");
    }

    private static final Pattern SECRET_NAME = Pattern.compile(
            "(?i).*(password|secret|token|_hash$|^hash_|_enc$|_encrypted$|^encrypted_|embedding|recovery_code).*");
    private static final Set<String> FULL_ID_NUMBERS = Set.of(
            "aadhaar_number", "passport_number", "bank_account_number", "account_number");

    public record TableResult(String file, long rows, List<String> leftOut) {}

    public record Stats(int tables, long rows, List<TableResult> files, List<String> failures) {}

    private final JdbcTemplate jdbc;
    private final TransactionTemplate readTx;

    public WorkspaceExportWriter(JdbcTemplate jdbc, PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.readTx = new TransactionTemplate(txManager);
        this.readTx.setReadOnly(true);
    }

    /** Whether a column is left out of the export, and never written. */
    static boolean excluded(String column, String type) {
        String c = column.toLowerCase(Locale.ROOT);
        if ("tenant_id".equals(c)) return true;
        if (type != null && type.toLowerCase(Locale.ROOT).startsWith("bytea")) return true;
        return FULL_ID_NUMBERS.contains(c) || SECRET_NAME.matcher(c).matches();
    }

    public Stats write(UUID tenantId, String workspaceName, String requestedBy, OutputStream out) throws IOException {
        List<TableResult> files = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        long rows = 0;
        try (ZipOutputStream zip = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            for (String[] t : tables()) {
                String schema = t[0], table = t[1];
                String file = FOLDERS.getOrDefault(schema, schema) + "/" + table.replace('_', '-') + ".csv";
                try {
                    TableResult r = exportTable(zip, tenantId, schema, table, file);
                    files.add(r);
                    rows += r.rows();
                } catch (RuntimeException e) {
                    log.warn("export: {}.{} failed for tenant {}: {}", schema, table, tenantId, e.getMessage());
                    failures.add(file + " (" + shortReason(e) + ")");
                }
            }
            try {
                TableResult users = exportUsers(zip, tenantId);
                files.add(users);
                rows += users.rows();
            } catch (RuntimeException e) {
                failures.add("users-and-access.csv (" + shortReason(e) + ")");
            }
            zip.putNextEntry(new ZipEntry("README.txt"));
            zip.write(readme(workspaceName, requestedBy, files, failures).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return new Stats(files.size(), rows, files, failures);
    }

    /** Business tables that carry tenant_id and that the app may read. */
    List<String[]> tables() {
        String in = FOLDERS.keySet().stream().map(s -> "?").collect(Collectors.joining(","));
        return jdbc.query("""
                SELECT n.nspname, c.relname
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN (%s)
                   AND c.relkind IN ('r', 'p')
                   AND NOT c.relispartition
                   AND EXISTS (SELECT 1 FROM pg_attribute a
                                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
                   AND has_table_privilege(c.oid, 'SELECT')
                 ORDER BY 1, 2
                """.formatted(in), (rs, n) -> new String[]{rs.getString(1), rs.getString(2)},
                FOLDERS.keySet().toArray());
    }

    private TableResult exportTable(ZipOutputStream zip, UUID tenantId, String schema, String table, String file) {
        List<String[]> cols = jdbc.query("""
                SELECT a.attname, format_type(a.atttypid, a.atttypmod)
                  FROM pg_attribute a
                 WHERE a.attrelid = (quote_ident(?) || '.' || quote_ident(?))::regclass
                   AND a.attnum > 0 AND NOT a.attisdropped
                   AND has_column_privilege(a.attrelid, a.attnum, 'SELECT')
                 ORDER BY a.attnum
                """, (rs, n) -> new String[]{rs.getString(1), rs.getString(2)}, schema, table);
        List<String> kept = new ArrayList<>();
        List<String> leftOut = new ArrayList<>();
        for (String[] c : cols) (excluded(c[0], c[1]) ? leftOut : kept).add(c[0]);
        if (kept.isEmpty()) return new TableResult(file, 0, leftOut);
        String sql = "SELECT " + kept.stream().map(WorkspaceExportWriter::ident).collect(Collectors.joining(", "))
                + " FROM " + ident(schema) + "." + ident(table) + " WHERE tenant_id = ?";
        Long n = readTx.execute(status -> jdbc.query(con -> {
            PreparedStatement ps = con.prepareStatement(sql);
            ps.setFetchSize(2000);
            ps.setObject(1, tenantId);
            return ps;
        }, (ResultSetExtractor<Long>) rs -> writeCsv(zip, file, rs)));
        return new TableResult(file, n == null ? 0 : n, leftOut);
    }

    private TableResult exportUsers(ZipOutputStream zip, UUID tenantId) {
        String sql = """
                SELECT uc.email, uc.mobile_number AS phone, e.employee_code,
                       COALESCE(string_agg(DISTINCT r.code, ', '), '') AS roles,
                       uc.is_active AS active, uc.is_mfa_enabled AS two_factor_on, uc.last_login_at
                  FROM auth.user_credentials uc
                  LEFT JOIN hrms.employees e ON e.id = uc.employee_id
                  LEFT JOIN rbac.user_roles ur ON ur.user_id = uc.id
                  LEFT JOIN rbac.roles r ON r.id = ur.role_id
                 WHERE uc.tenant_id = ?
                 GROUP BY uc.id, uc.email, uc.mobile_number, e.employee_code, uc.is_active, uc.is_mfa_enabled, uc.last_login_at
                 ORDER BY lower(uc.email)
                """;
        Long n = readTx.execute(status -> jdbc.query(sql, (ResultSetExtractor<Long>) rs -> writeCsv(zip, "users-and-access.csv", rs), tenantId));
        return new TableResult("users-and-access.csv", n == null ? 0 : n, List.of());
    }

    private static long writeCsv(ZipOutputStream zip, String file, ResultSet rs) throws SQLException {
        try {
            zip.putNextEntry(new ZipEntry(file));
            try {
                ResultSetMetaData md = rs.getMetaData();
                int cols = md.getColumnCount();
                StringBuilder sb = new StringBuilder("﻿");
                for (int i = 1; i <= cols; i++) {
                    if (i > 1) sb.append(',');
                    sb.append(csv(md.getColumnLabel(i)));
                }
                sb.append("\r\n");
                long n = 0;
                while (rs.next()) {
                    for (int i = 1; i <= cols; i++) {
                        if (i > 1) sb.append(',');
                        sb.append(csv(format(rs.getObject(i))));
                    }
                    sb.append("\r\n");
                    n++;
                    if (sb.length() > 64_000) {
                        zip.write(sb.toString().getBytes(StandardCharsets.UTF_8));
                        sb.setLength(0);
                    }
                }
                zip.write(sb.toString().getBytes(StandardCharsets.UTF_8));
                return n;
            } finally {
                zip.closeEntry();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** One value as text: times in IST, arrays joined, JSON as-is. */
    static String format(Object v) throws SQLException {
        if (v == null) return "";
        if (v instanceof Timestamp ts) return ts.toInstant().atZone(IST).toOffsetDateTime().toString();
        if (v instanceof java.time.OffsetDateTime o) return o.atZoneSameInstant(IST).toOffsetDateTime().toString();
        if (v instanceof Array a) {
            Object arr = a.getArray();
            if (arr instanceof Object[] objs) {
                List<String> parts = new ArrayList<>();
                for (Object o : objs) parts.add(o == null ? "" : o.toString());
                return String.join("; ", parts);
            }
            return String.valueOf(arr);
        }
        if (v instanceof Number || v instanceof Boolean) return v.toString();
        String s = v.toString();
        // Spreadsheet apps run cells that start with = + @ as formulas; keep them text.
        if (!s.isEmpty() && "=+@\t\r".indexOf(s.charAt(0)) >= 0) return "'" + s;
        if (s.length() > 1 && s.charAt(0) == '-' && !Character.isDigit(s.charAt(1))) return "'" + s;
        return s;
    }

    static String csv(String s) {
        if (s == null) return "";
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
            return '"' + s.replace("\"", "\"\"") + '"';
        }
        return s;
    }

    static String ident(String s) {
        return '"' + s.replace("\"", "\"\"") + '"';
    }

    static String readme(String workspace, String requestedBy, List<TableResult> files, List<String> failures) {
        String when = ZonedDateTime.now(IST).format(DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH));
        StringBuilder sb = new StringBuilder();
        sb.append(workspace).append(": full data export\r\n");
        sb.append("Created ").append(when).append(" IST");
        if (requestedBy != null) sb.append(", requested by ").append(requestedBy);
        sb.append("\r\n\r\n");
        sb.append("One folder per module, one spreadsheet (CSV, UTF-8) per table. Open them in Excel,\r\n");
        sb.append("Google Sheets or LibreOffice. Times are India Standard Time. Ids link rows across files\r\n");
        sb.append("(for example employee_id in attendance files is the id column of 02-people/employees.csv).\r\n\r\n");
        sb.append("This file contains salaries, bank details and personal information. Store it securely\r\n");
        sb.append("and delete it when you no longer need it.\r\n\r\n");
        sb.append("FILES\r\n");
        for (TableResult f : files) {
            sb.append("  ").append(f.file()).append("  ").append(f.rows()).append(f.rows() == 1 ? " row" : " rows");
            if (!f.leftOut().isEmpty()) sb.append("  (left out: ").append(String.join(", ", f.leftOut())).append(')');
            sb.append("\r\n");
        }
        sb.append("\r\nLEFT OUT ON PURPOSE\r\n");
        sb.append("  - Passwords, sign-in and session tokens, two-factor secrets and recovery codes.\r\n");
        sb.append("  - Face templates used for face punch-in.\r\n");
        sb.append("  - Full Aadhaar, passport and bank account numbers, and every field stored encrypted.\r\n");
        sb.append("    The last 4 digits are included where the workspace keeps them.\r\n");
        sb.append("  - Uploaded files (documents, photos, receipts). The files above list them; download\r\n");
        sb.append("    each one from the document vault.\r\n");
        sb.append("  - The audit trail. Export it from Audit logs.\r\n");
        if (!failures.isEmpty()) {
            sb.append("\r\nCOULD NOT BE EXPORTED (ask your admin to try again)\r\n");
            for (String f : failures) sb.append("  - ").append(f).append("\r\n");
        }
        return sb.toString();
    }

    private static String shortReason(RuntimeException e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        int nl = m.indexOf('\n');
        if (nl > 0) m = m.substring(0, nl);
        return m.length() > 160 ? m.substring(0, 160) : m;
    }
}
