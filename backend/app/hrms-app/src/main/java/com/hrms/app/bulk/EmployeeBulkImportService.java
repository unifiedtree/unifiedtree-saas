package com.hrms.app.bulk;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import org.apache.poi.ooxml.POIXMLException;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Two-phase employee bulk import:
 *  Phase 1 (validate): Parse file, collect all errors, return without writing.
 *  Phase 2 (commit):   Re-parse and create employees only if Phase 1 had zero errors.
 *
 * <p>Redesign BW-93: every row is created through the Add-employee path
 * ({@link WorkforceEmployeeService#create(com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest, boolean)}),
 * under the same rules (company employee codes, weekly offs, the only branch,
 * the department head as manager), with department and designation matched by
 * name, branch by name or code and manager by code or email
 * ({@link EmployeeImportMapper}). Imported people start ACTIVE, as they always
 * have. Problems come back per row and column. Commit stays all-or-nothing:
 * one transaction, and nothing is written unless every row passes.
 */
@Service
public class EmployeeBulkImportService {

    private static final Logger log = LoggerFactory.getLogger(EmployeeBulkImportService.class);

    /** The template's columns. Required ones first; the check itself is in {@link EmployeeImportMapper}. */
    public static final List<String> REQUIRED_COLUMNS = List.of(
            "first_name", "last_name", "email", "employment_type", "date_of_joining");
    public static final List<String> OPTIONAL_COLUMNS = List.of(
            "employee_code", "phone", "department", "designation", "job_title", "branch", "reporting_manager",
            "gender", "date_of_birth", "pan", "uan", "esi", "bank_name", "bank_account", "ifsc");

    /** The columns, for the import page's chips (GET /v1/bulk-import/employees/columns). */
    public record Columns(List<String> required, List<String> optional) {}

    /** A commit: the result, and the people it created (for starting onboarding after the commit). */
    public record Commit(BulkImportResult result, List<WorkforceEmployeeResponse> employees) {}

    private final WorkforceEmployeeService workforce;
    private final JdbcTemplate jdbc;
    /**
     * Canonical seat-quota enforcer, shared with EmployeeService and the
     * workforce-directory create path. Kept optional so unit tests / legacy
     * contexts (where the enforcer bean isn't scanned) can still instantiate
     * this service — production always has it wired.
     */
    private final SeatQuotaEnforcer seatQuotaEnforcer;
    /** Whose each email and number already is (the workspace's email rule, shared with Add employee). */
    private final EmployeeContactGuard contactGuard;

    @Autowired
    public EmployeeBulkImportService(WorkforceEmployeeService workforce,
                                     JdbcTemplate jdbc,
                                     org.springframework.beans.factory.ObjectProvider<SeatQuotaEnforcer> seatQuotaEnforcerProvider,
                                     EmployeeContactGuard contactGuard) {
        this.workforce = workforce;
        this.jdbc = jdbc;
        this.seatQuotaEnforcer = seatQuotaEnforcerProvider.getIfAvailable();
        this.contactGuard = contactGuard;
    }

    /** The same, with the email rule read through {@code jdbc} (tests that build the service by hand). */
    public EmployeeBulkImportService(WorkforceEmployeeService workforce,
                                     JdbcTemplate jdbc,
                                     org.springframework.beans.factory.ObjectProvider<SeatQuotaEnforcer> seatQuotaEnforcerProvider) {
        this(workforce, jdbc, seatQuotaEnforcerProvider, new EmployeeContactGuard(jdbc));
    }

    public Columns columns() {
        return new Columns(REQUIRED_COLUMNS, OPTIONAL_COLUMNS);
    }

    @Transactional(readOnly = true)
    public BulkImportResult validateOnly(MultipartFile file, UUID companyId) throws IOException {
        List<BulkImportRow> rows = parse(file);
        EmployeeImportMapper.map(rows, companyId, lookups(companyId));
        return checked(rows);
    }

    @Transactional
    public Commit validateAndCommit(MultipartFile file, UUID companyId) throws IOException {
        List<BulkImportRow> rows = parse(file);
        List<EmployeeImportMapper.Mapped> mapped = EmployeeImportMapper.map(rows, companyId, lookups(companyId));
        BulkImportResult check = checked(rows);
        if (!check.errors().isEmpty()) {
            return new Commit(check, List.of());
        }

        // Seat guard: reject the whole file if it would push the workspace over
        // its paid cap. Applied before ANY row is written — the alternative was
        // half-committing an upload and half-erroring mid-batch. This closes the
        // bypass verified live 2026-08-10 where a 500-row CSV walked past a
        // 10-seat plan without a peep. The per-row assertCapacity() inside
        // WorkforceEmployeeService.create is a belt-and-braces second check,
        // but the aggregate pre-flight is what stops a bulk-mode blowout.
        if (seatQuotaEnforcer != null) {
            seatQuotaEnforcer.assertCapacity(rows.size());
        }

        List<BulkImportResult.CreatedRow> created = new ArrayList<>();
        List<WorkforceEmployeeResponse> employees = new ArrayList<>();
        for (EmployeeImportMapper.Mapped m : mapped) {
            WorkforceEmployeeResponse emp;
            try {
                emp = workforce.create(m.request(), true);
            } catch (HrmsException e) {
                // Everything above is checked first, so this is rare (someone added the
                // same email meanwhile). The whole import is rolled back.
                throw new BusinessRuleException("Row " + m.row() + ": " + e.getMessage(), "IMPORT_ROW_FAILED");
            }
            if (m.jobTitle() != null) {
                // hrms.employees.job_title isn't mapped on the workforce entity; imports
                // have always kept the file's job title (else the unmatched designation).
                jdbc.update("UPDATE hrms.employees SET job_title = ? WHERE id = ? AND tenant_id = ?",
                        m.jobTitle(), emp.id(), TenantContext.getTenantId());
            }
            employees.add(emp);
            created.add(new BulkImportResult.CreatedRow(m.row(), emp.id(), emp.employeeCode(),
                    (emp.firstName() + " " + (emp.lastName() == null ? "" : emp.lastName())).trim(), null, null));
        }

        log.info("BulkImport: committed {} employees for company={}", created.size(), companyId);
        return new Commit(BulkImportResult.committed(rows.size(), warnings(rows), created), employees);
    }

    private static BulkImportResult checked(List<BulkImportRow> rows) {
        List<String> errors = rows.stream().flatMap(r -> r.getErrors().stream()).toList();
        List<BulkImportProblem> problems = rows.stream().flatMap(r -> r.getProblems().stream()).toList();
        return BulkImportResult.checked(rows.size(), errors, problems, warnings(rows));
    }

    private static List<BulkImportProblem> warnings(List<BulkImportRow> rows) {
        return rows.stream().flatMap(r -> r.getWarnings().stream()).toList();
    }

    // ── Lookups (JDBC; tenant-filtered, RLS as well) ─────────────────────────

    EmployeeImportMapper.Lookups lookups(UUID companyId) {
        UUID tenant = TenantContext.getTenantId();
        Boolean company = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM org.companies WHERE tenant_id = ? AND id = ?)", Boolean.class, tenant, companyId);
        if (!Boolean.TRUE.equals(company)) {
            throw new BusinessRuleException("That company isn't in this workspace", "IMPORT_COMPANY_UNKNOWN");
        }
        Map<UUID, String> active = new HashMap<>();
        Set<String> inactive = new HashSet<>();
        jdbc.query("SELECT id, name, is_active FROM hrms.departments WHERE tenant_id = ? AND company_id = ?",
                rs -> {
                    if (rs.getBoolean("is_active")) active.put(rs.getObject("id", UUID.class), rs.getString("name"));
                    else inactive.add(EmployeeImportMapper.key(rs.getString("name")));
                }, tenant, companyId);
        Map<UUID, String> titles = new HashMap<>();
        jdbc.query("SELECT id, title FROM hrms.designations WHERE tenant_id = ? AND company_id = ? AND is_active = TRUE",
                rs -> { titles.put(rs.getObject("id", UUID.class), rs.getString("title")); }, tenant, companyId);
        List<EmployeeImportMapper.Branch> branches = jdbc.query(
                "SELECT id, name, code FROM org.branches WHERE tenant_id = ? AND company_id = ? AND is_active = TRUE",
                (rs, i) -> new EmployeeImportMapper.Branch(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("code")),
                tenant, companyId);
        List<EmployeeImportMapper.Manager> managers = jdbc.query("""
                SELECT id, employee_code, email FROM hrms.employees
                 WHERE tenant_id = ? AND is_active = TRUE AND employment_status NOT IN ('EXITED', 'TERMINATED')
                """, (rs, i) -> new EmployeeImportMapper.Manager(rs.getObject("id", UUID.class),
                        rs.getString("employee_code"), rs.getString("email")), tenant);
        // Emails: anywhere in the workspace (work, personal and login emails, trimmed and
        // lower-cased, people who left included), with whose each one is, so a row names
        // the person. Codes: in this company, as Add employee checks.
        Map<String, EmployeeContactGuard.Owner> emailOwners = contactGuard.allEmailOwners(tenant);
        Set<String> emails = new HashSet<>(emailOwners.keySet());
        Set<String> codes = new HashSet<>(jdbc.queryForList(
                "SELECT lower(employee_code) FROM hrms.employees WHERE tenant_id = ? AND company_id = ?", String.class, tenant, companyId));
        return new EmployeeImportMapper.Lookups(EmployeeImportMapper.index(active), inactive,
                EmployeeImportMapper.index(titles), branches, managers, emails, codes,
                emailOwners, contactGuard.allPhoneOwners(tenant), EmployeeContactGuard.callerMaySeeOwners());
    }

    // ── Template ─────────────────────────────────────────────────────────────

    public byte[] buildTemplate() throws IOException {
        try (Workbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Employees");

            // Header row
            Row header = sheet.createRow(0);
            int col = 0;
            for (String h : REQUIRED_COLUMNS) header.createCell(col++).setCellValue(h);
            for (String h : OPTIONAL_COLUMNS) header.createCell(col++).setCellValue(h);

            // One example row
            Row example = sheet.createRow(1);
            example.createCell(0).setCellValue("Jane");
            example.createCell(1).setCellValue("Smith");
            example.createCell(2).setCellValue("jane.smith@example.com");
            example.createCell(3).setCellValue("FULL_TIME");
            example.createCell(4).setCellValue("2025-01-15");

            for (int i = 0; i < REQUIRED_COLUMNS.size() + OPTIONAL_COLUMNS.size(); i++) sheet.autoSizeColumn(i);

            wb.write(out);
            return out.toByteArray();
        }
    }

    /** The same template as CSV (UTF-8, header plus the example row). */
    public byte[] buildCsvTemplate() {
        List<String> header = new ArrayList<>(REQUIRED_COLUMNS);
        header.addAll(OPTIONAL_COLUMNS);
        List<String> example = new ArrayList<>(List.of("Jane", "Smith", "jane.smith@example.com", "FULL_TIME", "2025-01-15"));
        while (example.size() < header.size()) example.add("");
        String csv = String.join(",", header) + "\r\n" + String.join(",", example) + "\r\n";
        return csv.getBytes(StandardCharsets.UTF_8);
    }

    // ── Parsing ───────────────────────────────────────────────────────────────

    private List<BulkImportRow> parse(MultipartFile file) throws IOException {
        String name = file.getOriginalFilename();
        if (name != null && name.toLowerCase().endsWith(".csv")) {
            return parseCsv(file);
        }
        return parseXlsx(file);
    }

    /**
     * B2 FIX (audit 2026-08-15): RFC 4180-compliant CSV parser.
     *
     * <p>The previous implementation used {@code String.split(",")} on every
     * line, which corrupts any field that contains a comma inside quotes
     * (e.g. "Doe, John") and does not understand escaped quotes or embedded
     * newlines. It also implicitly used the platform default charset and
     * silently swallowed a leading UTF-8 BOM as part of the first header
     * name, which broke header matching on files exported from Excel.
     *
     * <p>Now:
     *   - UTF-8 InputStreamReader (never platform default);
     *   - explicit BOM strip on the first character;
     *   - fields may be quoted with {@code "}, quotes inside quoted fields
     *     doubled as {@code ""}, and newlines allowed inside quoted fields.
     *   - trailing empty fields preserved so short rows don't shift columns.
     */
    private List<BulkImportRow> parseCsv(MultipartFile file) throws IOException {
        List<BulkImportRow> rows = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
            List<List<String>> records = readCsvRecords(reader);
            if (records.isEmpty()) return rows;
            List<String> headerRecord = records.get(0);
            // Strip UTF-8 BOM if present on first header.
            if (!headerRecord.isEmpty()) {
                String h0 = headerRecord.get(0);
                if (h0 != null && !h0.isEmpty() && h0.charAt(0) == '﻿') {
                    headerRecord.set(0, h0.substring(1));
                }
            }
            String[] headers = headerRecord.toArray(new String[0]);
            for (int i = 1; i < records.size(); i++) {
                List<String> rec = records.get(i);
                if (rec.isEmpty() || (rec.size() == 1 && (rec.get(0) == null || rec.get(0).isBlank()))) {
                    continue;
                }
                String[] cells = new String[headers.length];
                for (int c = 0; c < headers.length; c++) {
                    cells[c] = c < rec.size() ? (rec.get(c) == null ? "" : rec.get(c)) : "";
                }
                rows.add(mapRow(i + 1, headers, cells));
            }
        }
        return rows;
    }

    /** Minimal RFC-4180 CSV reader — handles quoted fields, doubled quotes,
     *  embedded commas, and embedded newlines. Returns one record per row. */
    private static List<List<String>> readCsvRecords(BufferedReader reader) throws IOException {
        List<List<String>> out = new ArrayList<>();
        List<String> cur = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean inQuotes = false;
        int ch;
        while ((ch = reader.read()) != -1) {
            char c = (char) ch;
            if (inQuotes) {
                if (c == '"') {
                    int next = reader.read();
                    if (next == '"') { field.append('"'); }
                    else {
                        inQuotes = false;
                        if (next == -1) break;
                        // reprocess the peeked char in outer state
                        if (next == ',') { cur.add(field.toString()); field.setLength(0); }
                        else if (next == '\r') { /* handled by \n */ }
                        else if (next == '\n') { cur.add(field.toString()); field.setLength(0); out.add(cur); cur = new ArrayList<>(); }
                        else { field.append((char) next); }
                    }
                } else {
                    field.append(c);
                }
            } else {
                if (c == '"') {
                    inQuotes = true;
                } else if (c == ',') {
                    cur.add(field.toString());
                    field.setLength(0);
                } else if (c == '\r') {
                    // ignore, wait for \n
                } else if (c == '\n') {
                    cur.add(field.toString());
                    field.setLength(0);
                    out.add(cur);
                    cur = new ArrayList<>();
                } else {
                    field.append(c);
                }
            }
        }
        if (field.length() > 0 || !cur.isEmpty()) {
            cur.add(field.toString());
            out.add(cur);
        }
        return out;
    }

    private List<BulkImportRow> parseXlsx(MultipartFile file) throws IOException {
        List<BulkImportRow> rows = new ArrayList<>();
        // Wrap POI's exception chain in a clean 400. Uploading a text/CSV/junk
        // file with a .xlsx extension previously threw POIXMLException /
        // NotOfficeXmlFileException from deep inside the ZIP reader and 500'd
        // the request. That is a client error, not a server bug.
        try (Workbook wb = new XSSFWorkbook(file.getInputStream())) {
            Sheet sheet = wb.getSheetAt(0);
            Row headerRow = sheet.getRow(0);
            if (headerRow == null) return rows;

            String[] headers = new String[headerRow.getLastCellNum()];
            for (int i = 0; i < headers.length; i++) {
                Cell c = headerRow.getCell(i);
                headers[i] = c != null ? c.getStringCellValue().trim().toLowerCase() : "";
            }

            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                if (row == null) continue;
                String[] cells = new String[headers.length];
                for (int c = 0; c < headers.length; c++) {
                    Cell cell = row.getCell(c);
                    cells[c] = cellValue(cell);
                }
                rows.add(mapRow(r + 1, headers, cells));
            }
        } catch (POIXMLException | IllegalArgumentException | IllegalStateException e) {
            log.warn("Rejecting bulk-import upload: not a valid .xlsx ({})", e.getMessage());
            throw new HrmsException(
                    "Uploaded file is not a valid .xlsx",
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILE_FORMAT");
        }
        return rows;
    }

    private BulkImportRow mapRow(int rowNum, String[] headers, String[] cells) {
        BulkImportRow row = new BulkImportRow(rowNum);
        for (int i = 0; i < headers.length; i++) {
            String val = i < cells.length ? cells[i].trim() : "";
            switch (headers[i].trim().toLowerCase().replace(" ", "_").replace("-", "_")) {
                case "first_name"       -> row.setFirstName(val);
                case "last_name"        -> row.setLastName(val);
                case "email", "work_email" -> row.setEmail(val);
                case "phone", "mobile"  -> row.setPhone(val);
                case "department"       -> row.setDepartmentName(val);
                case "designation"      -> row.setDesignationName(val);
                case "job_title"        -> row.setJobTitle(val);
                case "employment_type"  -> row.setEmploymentType(val);
                case "date_of_joining", "joining_date" -> row.setDateOfJoining(val);
                case "gender"           -> row.setGender(val);
                case "date_of_birth", "dob" -> row.setDateOfBirth(val);
                // Redesign BW-93: the Add-employee columns.
                case "employee_code", "code" -> row.setEmployeeCode(val);
                case "branch"           -> row.setBranch(val);
                case "reporting_manager", "manager", "manager_code", "manager_email" -> row.setReportingManager(val);
                case "pan", "pan_number" -> row.setPan(val);
                case "uan", "uan_number" -> row.setUan(val);
                case "esi", "esi_number" -> row.setEsi(val);
                case "bank_name"        -> row.setBankName(val);
                case "bank_account", "bank_account_number", "account_number" -> row.setBankAccount(val);
                case "ifsc", "bank_ifsc", "ifsc_code" -> row.setIfsc(val);
                default -> { /* unknown columns are ignored, as before */ }
            }
        }
        return row;
    }

    private String cellValue(Cell cell) {
        if (cell == null) return "";
        return switch (cell.getCellType()) {
            case STRING  -> cell.getStringCellValue();
            case NUMERIC -> DateUtil.isCellDateFormatted(cell)
                    ? cell.getLocalDateTimeCellValue().toLocalDate().toString()
                    : String.valueOf((long) cell.getNumericCellValue());
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            default -> "";
        };
    }
}
