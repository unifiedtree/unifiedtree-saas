package com.hrms.app.bulk;

import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import org.apache.poi.ooxml.POIXMLException;
import org.springframework.http.HttpStatus;
import com.hrms.employee.dto.CreateEmployeeRequest;
import com.hrms.employee.enums.EmploymentType;
import com.hrms.employee.enums.Gender;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.service.EmployeeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Two-phase employee bulk import:
 *  Phase 1 (validate): Parse file, collect all errors, return without writing.
 *  Phase 2 (commit):   Re-parse and create employees only if Phase 1 had zero errors.
 */
@Service
public class EmployeeBulkImportService {

    private static final Logger log = LoggerFactory.getLogger(EmployeeBulkImportService.class);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private final EmployeeService employeeService;
    private final EmployeeRepository employeeRepository;
    /**
     * Canonical seat-quota enforcer, shared with EmployeeService and the
     * workforce-directory create path. Kept optional so unit tests / legacy
     * contexts (where the enforcer bean isn't scanned) can still instantiate
     * this service — production always has it wired.
     */
    private final SeatQuotaEnforcer seatQuotaEnforcer;

    @Autowired
    public EmployeeBulkImportService(EmployeeService employeeService,
                                     EmployeeRepository employeeRepository,
                                     org.springframework.beans.factory.ObjectProvider<SeatQuotaEnforcer> seatQuotaEnforcerProvider) {
        this.employeeService = employeeService;
        this.employeeRepository = employeeRepository;
        this.seatQuotaEnforcer = seatQuotaEnforcerProvider.getIfAvailable();
    }

    public BulkImportResult validateOnly(MultipartFile file, UUID companyId) throws IOException {
        List<BulkImportRow> rows = parse(file);
        validate(rows, companyId);
        List<String> errors = rows.stream()
                .filter(BulkImportRow::hasErrors)
                .flatMap(r -> r.getErrors().stream())
                .toList();
        return BulkImportResult.validationFailed(rows.size(), errors);
    }

    @Transactional
    public BulkImportResult validateAndCommit(MultipartFile file, UUID companyId) throws IOException {
        List<BulkImportRow> rows = parse(file);
        validate(rows, companyId);

        List<String> errors = rows.stream()
                .filter(BulkImportRow::hasErrors)
                .flatMap(r -> r.getErrors().stream())
                .toList();

        if (!errors.isEmpty()) {
            return BulkImportResult.validationFailed(rows.size(), errors);
        }

        // Seat guard: reject the whole file if it would push the workspace over
        // its paid cap. Applied before ANY row is written — the alternative was
        // half-committing an upload and half-erroring mid-batch. This closes the
        // bypass verified live 2026-08-10 where a 500-row CSV walked past a
        // 10-seat plan without a peep. Per-row assertCapacity(1) inside
        // employeeService.createEmployee is a belt-and-braces second check,
        // but the aggregate pre-flight is what stops a bulk-mode blowout.
        if (seatQuotaEnforcer != null) {
            seatQuotaEnforcer.assertCapacity(rows.size());
        }

        int created = 0;
        for (BulkImportRow row : rows) {
            CreateEmployeeRequest req = toRequest(row, companyId);
            employeeService.createEmployee(req);
            created++;
        }

        log.info("BulkImport: committed {} employees for company={}", created, companyId);
        return BulkImportResult.committed(rows.size(), created);
    }

    // ── Template ─────────────────────────────────────────────────────────────

    public byte[] buildTemplate() throws IOException {
        String[] required = {"first_name", "last_name", "email", "employment_type", "date_of_joining"};
        String[] optional = {"phone", "department", "designation", "job_title", "gender", "date_of_birth"};

        try (Workbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Employees");

            // Header row
            Row header = sheet.createRow(0);
            int col = 0;
            for (String h : required) header.createCell(col++).setCellValue(h);
            for (String h : optional) header.createCell(col++).setCellValue(h);

            // One example row
            Row example = sheet.createRow(1);
            example.createCell(0).setCellValue("Jane");
            example.createCell(1).setCellValue("Smith");
            example.createCell(2).setCellValue("jane.smith@example.com");
            example.createCell(3).setCellValue("FULL_TIME");
            example.createCell(4).setCellValue("2025-01-15");

            for (int i = 0; i < required.length + optional.length; i++) sheet.autoSizeColumn(i);

            wb.write(out);
            return out.toByteArray();
        }
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
            switch (headers[i].toLowerCase().replace(" ", "_")) {
                case "first_name"       -> row.setFirstName(val);
                case "last_name"        -> row.setLastName(val);
                case "email"            -> row.setEmail(val);
                case "phone"            -> row.setPhone(val);
                case "department"       -> row.setDepartmentName(val);
                case "designation"      -> row.setDesignationName(val);
                case "job_title"        -> row.setJobTitle(val);
                case "employment_type"  -> row.setEmploymentType(val);
                case "date_of_joining"  -> row.setDateOfJoining(val);
                case "gender"           -> row.setGender(val);
                case "date_of_birth"    -> row.setDateOfBirth(val);
            }
        }
        return row;
    }

    // ── Validation ────────────────────────────────────────────────────────────

    private void validate(List<BulkImportRow> rows, UUID companyId) {
        for (BulkImportRow row : rows) {
            if (row.getFirstName() == null || row.getFirstName().isBlank()) {
                row.addError("first_name is required");
            }
            if (row.getLastName() == null || row.getLastName().isBlank()) {
                row.addError("last_name is required");
            }
            if (row.getEmail() == null || !row.getEmail().contains("@")) {
                row.addError("email is invalid or missing");
            } else if (employeeRepository.findByEmail(row.getEmail()).isPresent()) {
                row.addError("email already exists: " + row.getEmail());
            }
            if (row.getDateOfJoining() != null && !row.getDateOfJoining().isBlank()) {
                try {
                    LocalDate.parse(row.getDateOfJoining(), DATE_FMT);
                } catch (DateTimeParseException e) {
                    row.addError("date_of_joining must be yyyy-MM-dd, got: " + row.getDateOfJoining());
                }
            }
            if (row.getEmploymentType() != null && !row.getEmploymentType().isBlank()) {
                try {
                    EmploymentType.valueOf(row.getEmploymentType().toUpperCase());
                } catch (IllegalArgumentException e) {
                    row.addError("employment_type invalid: " + row.getEmploymentType());
                }
            }
        }
    }

    // ── Mapping to CreateEmployeeRequest ──────────────────────────────────────

    private CreateEmployeeRequest toRequest(BulkImportRow row, UUID companyId) {
        LocalDate doj = (row.getDateOfJoining() != null && !row.getDateOfJoining().isBlank())
                ? LocalDate.parse(row.getDateOfJoining(), DATE_FMT) : LocalDate.now();
        LocalDate dob = (row.getDateOfBirth() != null && !row.getDateOfBirth().isBlank())
                ? LocalDate.parse(row.getDateOfBirth(), DATE_FMT) : null;
        EmploymentType et = (row.getEmploymentType() != null && !row.getEmploymentType().isBlank())
                ? EmploymentType.valueOf(row.getEmploymentType().toUpperCase()) : EmploymentType.FULL_TIME;
        Gender gender = null;
        if (row.getGender() != null && !row.getGender().isBlank()) {
            try { gender = Gender.valueOf(row.getGender().toUpperCase()); } catch (IllegalArgumentException ignored) {}
        }

        return new CreateEmployeeRequest(
                row.getFirstName(), row.getLastName(), null,
                row.getEmail(), null, row.getPhone(),
                dob, gender, companyId,
                null, null, null,
                row.getJobTitle() != null ? row.getJobTitle() : row.getDesignationName(),
                et, doj, 30, null, null, null,
                null, null, null, null,
                null, null, null, null,
                null);
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
