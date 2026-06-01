package com.hrms.app.bulk;

import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.dto.CreateEmployeeRequest;
import com.hrms.employee.enums.EmploymentType;
import com.hrms.employee.enums.Gender;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.service.EmployeeService;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
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

    public EmployeeBulkImportService(EmployeeService employeeService,
                                     EmployeeRepository employeeRepository) {
        this.employeeService = employeeService;
        this.employeeRepository = employeeRepository;
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

        int created = 0;
        for (BulkImportRow row : rows) {
            CreateEmployeeRequest req = toRequest(row, companyId);
            employeeService.createEmployee(req);
            created++;
        }

        log.info("BulkImport: committed {} employees for company={}", created, companyId);
        return BulkImportResult.committed(rows.size(), created);
    }

    // ── Parsing ───────────────────────────────────────────────────────────────

    private List<BulkImportRow> parse(MultipartFile file) throws IOException {
        String name = file.getOriginalFilename();
        if (name != null && name.toLowerCase().endsWith(".csv")) {
            return parseCsv(file);
        }
        return parseXlsx(file);
    }

    private List<BulkImportRow> parseCsv(MultipartFile file) throws IOException {
        List<BulkImportRow> rows = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(file.getInputStream()))) {
            String headerLine = reader.readLine();
            if (headerLine == null) return rows;

            String[] headers = headerLine.split(",");
            String line;
            int rowNum = 2;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;
                String[] cells = line.split(",", -1);
                rows.add(mapRow(rowNum++, headers, cells));
            }
        }
        return rows;
    }

    private List<BulkImportRow> parseXlsx(MultipartFile file) throws IOException {
        List<BulkImportRow> rows = new ArrayList<>();
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
