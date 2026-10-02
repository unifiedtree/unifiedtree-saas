package com.hrms.app.bulk;

import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.entity.WorkforceEmployee;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Checks every row of an employee import and turns the good ones into the
 * Add-employee request (redesign BW-93). Pure: the lookups (the company's
 * departments, designations, branches, possible managers, and the emails and
 * codes already in use) are loaded by {@link EmployeeBulkImportService}.
 *
 * <p>Rules, beyond the ones imports always had (first and last name, a work
 * email with "@" that nobody in the workspace uses yet, yyyy-MM-dd dates, a
 * known employment type):
 * <ul>
 *   <li><b>department</b> by name, among the company's active departments.
 *       A name that matches none is a problem: before, the department was
 *       dropped without a word.</li>
 *   <li><b>designation</b> by title. A title that matches none is kept as the
 *       job title, as imports always did, with a warning; no designation is
 *       created.</li>
 *   <li><b>branch</b> by name or code; <b>reporting_manager</b> by employee
 *       code or work email (someone still working). Left blank, the
 *       Add-employee defaults apply (the company's only branch; the
 *       department's head).</li>
 *   <li><b>employee_code</b> must be free in the company; blank = the
 *       company's next code.</li>
 *   <li>PAN, UAN, ESI, bank account and IFSC use the Add-employee form's
 *       formats. A future joining date is allowed.</li>
 *   <li>The same email or code twice in one file is a problem.</li>
 * </ul>
 */
public final class EmployeeImportMapper {

    private EmployeeImportMapper() {}

    static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    // The Add-employee form's formats (EmployeeForm.tsx RX).
    static final Pattern PAN = Pattern.compile("^[A-Z]{5}[0-9]{4}[A-Z]$");
    static final Pattern UAN = Pattern.compile("^\\d{12}$");
    static final Pattern ESI = Pattern.compile("^\\d{10,17}$");
    static final Pattern ACCOUNT = Pattern.compile("^\\d{9,18}$");
    static final Pattern IFSC = Pattern.compile("^[A-Z]{4}0[A-Z\\d]{6}$");

    /**
     * An employee code ending in more than 18 digits. The employee-code counter casts that tail to
     * bigint (HrConfigurationService.previewNextEmployeeCode, WorkforceEmployeeService.incrementAndFetch),
     * which stops at 19 digits, so importing one used to make the whole company's Add employee page
     * answer 500. Refused at import instead.
     */
    static final Pattern LONG_NUMERIC_TAIL = Pattern.compile(".*?[0-9]{19,}$");

    /** A person a row may report to. */
    public record Manager(UUID id, String code, String email) {}

    /** What the rows are checked against; names, titles, codes and emails as stored. */
    public record Lookups(Map<String, UUID> activeDepartments,
                          Set<String> inactiveDepartments,
                          Map<String, UUID> designations,
                          List<Branch> branches,
                          List<Manager> managers,
                          Set<String> emailsInUse,
                          Set<String> codesInUse) {}

    public record Branch(UUID id, String name, String code) {}

    /** A row that passed: the request to create it, and a job title to keep when no designation matched. */
    public record Mapped(int row, CreateWorkforceEmployeeRequest request, String jobTitle) {}

    static String key(String s) {
        return s == null ? "" : s.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static String trimmed(String s) {
        return blank(s) ? null : s.trim();
    }

    /** Indexes names (lower-cased, spaces collapsed) to ids; used by the service to build the lookups. */
    public static Map<String, UUID> index(Map<UUID, String> byId) {
        Map<String, UUID> out = new HashMap<>();
        byId.forEach((id, name) -> { if (!blank(name)) out.putIfAbsent(key(name), id); });
        return out;
    }

    /**
     * Checks every row (adding problems and warnings to it) and returns the
     * requests for the rows without problems, in file order.
     */
    public static List<Mapped> map(List<BulkImportRow> rows, UUID companyId, Lookups l) {
        List<Mapped> out = new ArrayList<>();
        Map<String, Integer> emailsInFile = new HashMap<>();
        Map<String, Integer> codesInFile = new HashMap<>();
        Set<String> emailsInUse = lower(l.emailsInUse());
        Set<String> codesInUse = lower(l.codesInUse());
        for (BulkImportRow row : rows) {
            Mapped m = mapRow(row, companyId, l, emailsInUse, codesInUse, emailsInFile, codesInFile);
            if (m != null && !row.hasErrors()) out.add(m);
        }
        return out;
    }

    private static Set<String> lower(Set<String> values) {
        Set<String> out = new HashSet<>();
        if (values != null) for (String v : values) if (v != null) out.add(v.trim().toLowerCase(Locale.ROOT));
        return out;
    }

    private static Mapped mapRow(BulkImportRow row, UUID companyId, Lookups l, Set<String> emailsInUse, Set<String> codesInUse,
                                 Map<String, Integer> emailsInFile, Map<String, Integer> codesInFile) {
        // Names and email: the checks imports always had, then lengths the table allows.
        if (blank(row.getFirstName())) row.addProblem("first_name", "first_name is required");
        else if (row.getFirstName().trim().length() > 100) row.addProblem("first_name", "first_name is longer than 100 characters");
        if (blank(row.getLastName())) row.addProblem("last_name", "last_name is required");
        else if (row.getLastName().trim().length() > 100) row.addProblem("last_name", "last_name is longer than 100 characters");

        String email = trimmed(row.getEmail());
        if (email == null || !email.contains("@")) {
            row.addProblem("email", "email is invalid or missing");
        } else if (email.length() > 255) {
            row.addProblem("email", "email is longer than 255 characters");
        } else {
            String k = email.toLowerCase(Locale.ROOT);
            if (emailsInUse.contains(k)) {
                row.addProblem("email", "email already exists: " + email);
            } else if (emailsInFile.containsKey(k)) {
                row.addProblem("email", "email appears more than once in this file (also row " + emailsInFile.get(k) + "): " + email);
            } else {
                emailsInFile.put(k, row.getRowNumber());
            }
        }

        LocalDate joined = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        if (!blank(row.getDateOfJoining())) {
            try {
                joined = LocalDate.parse(row.getDateOfJoining().trim(), DATE_FMT);
            } catch (DateTimeParseException e) {
                row.addProblem("date_of_joining", "date_of_joining must be yyyy-MM-dd, got: " + row.getDateOfJoining());
            }
        }
        LocalDate born = null;
        if (!blank(row.getDateOfBirth())) {
            try {
                born = LocalDate.parse(row.getDateOfBirth().trim(), DATE_FMT);
            } catch (DateTimeParseException e) {
                row.addProblem("date_of_birth", "date_of_birth must be yyyy-MM-dd, got: " + row.getDateOfBirth());
            }
        }

        WorkforceEmployee.EmploymentType type = WorkforceEmployee.EmploymentType.FULL_TIME;
        if (!blank(row.getEmploymentType())) {
            try {
                type = WorkforceEmployee.EmploymentType.valueOf(
                        row.getEmploymentType().trim().toUpperCase(Locale.ROOT).replace(' ', '_').replace('-', '_'));
            } catch (IllegalArgumentException e) {
                row.addProblem("employment_type", "employment_type invalid: " + row.getEmploymentType());
            }
        }

        WorkforceEmployee.Gender gender = null;
        if (!blank(row.getGender())) {
            try {
                gender = WorkforceEmployee.Gender.valueOf(row.getGender().trim().toUpperCase(Locale.ROOT).replace(' ', '_'));
            } catch (IllegalArgumentException e) {
                row.addWarning("gender", "gender not recognised, left empty: " + row.getGender());
            }
        }

        String phone = trimmed(row.getPhone());
        if (phone != null && phone.length() > 20) row.addProblem("phone", "phone is longer than 20 characters");

        String code = trimmed(row.getEmployeeCode());
        if (code != null) {
            String k = code.toLowerCase(Locale.ROOT);
            if (code.length() > 50) row.addProblem("employee_code", "employee_code is longer than 50 characters");
            // A numeric tail longer than 18 digits overflows the bigint cast the employee-code
            // counter uses, which used to answer 500 on the whole company's Add employee page.
            else if (LONG_NUMERIC_TAIL.matcher(code).matches()) {
                row.addProblem("employee_code", "employee_code ends in more than 18 digits, which is too long to number: " + code);
            }
            else if (codesInUse.contains(k)) row.addProblem("employee_code", "employee_code already in use: " + code);
            else if (codesInFile.containsKey(k)) {
                row.addProblem("employee_code", "employee_code appears more than once in this file (also row " + codesInFile.get(k) + "): " + code);
            } else codesInFile.put(k, row.getRowNumber());
        }

        UUID departmentId = null;
        if (!blank(row.getDepartmentName())) {
            String k = key(row.getDepartmentName());
            departmentId = l.activeDepartments().get(k);
            if (departmentId == null) {
                row.addProblem("department", l.inactiveDepartments().contains(k)
                        ? "department is archived in this company: " + row.getDepartmentName().trim()
                        : "department not found in this company: " + row.getDepartmentName().trim());
            }
        }

        UUID designationId = null;
        String jobTitle = trimmed(row.getJobTitle());
        if (!blank(row.getDesignationName())) {
            designationId = l.designations().get(key(row.getDesignationName()));
            if (designationId == null) {
                row.addWarning("designation", "No designation called '" + row.getDesignationName().trim()
                        + "' in this company; it is kept as the job title");
                if (jobTitle == null) jobTitle = row.getDesignationName().trim();
            }
        }
        if (jobTitle != null && jobTitle.length() > 150) row.addProblem("job_title", "job_title is longer than 150 characters");

        UUID branchId = null;
        if (!blank(row.getBranch())) {
            String k = key(row.getBranch());
            List<Branch> byCode = l.branches().stream().filter(b -> b.code() != null && key(b.code()).equals(k)).toList();
            List<Branch> byName = l.branches().stream().filter(b -> key(b.name()).equals(k)).toList();
            // A unique code wins; else the name; else (several branches share the code) ambiguous.
            List<Branch> hits = byCode.size() == 1 ? byCode : !byName.isEmpty() ? byName : byCode;
            if (hits.size() == 1) branchId = hits.get(0).id();
            else if (hits.isEmpty()) row.addProblem("branch", "branch not found in this company: " + row.getBranch().trim());
            else row.addProblem("branch", "more than one branch matches, use its code: " + row.getBranch().trim());
        }

        UUID managerId = null;
        if (!blank(row.getReportingManager())) {
            String k = row.getReportingManager().trim().toLowerCase(Locale.ROOT);
            List<Manager> hits = l.managers().stream()
                    .filter(m -> (m.code() != null && m.code().trim().toLowerCase(Locale.ROOT).equals(k))
                            || (m.email() != null && m.email().trim().toLowerCase(Locale.ROOT).equals(k)))
                    .toList();
            if (hits.size() == 1) managerId = hits.get(0).id();
            else if (hits.isEmpty()) {
                row.addProblem("reporting_manager", "reporting_manager not found (use their employee code or work email): "
                        + row.getReportingManager().trim());
            } else {
                row.addProblem("reporting_manager", "more than one person matches reporting_manager, use their work email: "
                        + row.getReportingManager().trim());
            }
        }

        String pan = upper(row.getPan());
        if (pan != null && !PAN.matcher(pan).matches()) row.addProblem("pan", "pan must look like ABCDE1234F, got: " + row.getPan().trim());
        String uan = digits(row.getUan());
        if (uan != null && !UAN.matcher(uan).matches()) row.addProblem("uan", "uan must be 12 digits, got: " + row.getUan().trim());
        String esi = digits(row.getEsi());
        if (esi != null && !ESI.matcher(esi).matches()) row.addProblem("esi", "esi must be 10 to 17 digits, got: " + row.getEsi().trim());
        String account = digits(row.getBankAccount());
        if (account != null && !ACCOUNT.matcher(account).matches()) {
            row.addProblem("bank_account", "bank_account must be 9 to 18 digits");
        }
        String ifsc = upper(row.getIfsc());
        if (ifsc != null && !IFSC.matcher(ifsc).matches()) row.addProblem("ifsc", "ifsc must look like SBIN0001234, got: " + row.getIfsc().trim());
        String bankName = trimmed(row.getBankName());
        if (bankName != null && bankName.length() > 100) row.addProblem("bank_name", "bank_name is longer than 100 characters");

        if (row.hasErrors()) return null;
        CreateWorkforceEmployeeRequest req = new CreateWorkforceEmployeeRequest(
                companyId,
                code,                           // blank = the company's next code
                row.getFirstName().trim(),
                null,                           // middleName
                row.getLastName().trim(),
                email,
                phone,
                born,
                gender,
                departmentId,
                designationId,
                branchId,
                null,                           // geoFenceZoneId
                null,                           // weeklyOffDays: the company's
                managerId,                      // null = the department's head
                type,
                joined,
                null,                           // ctcAnnual
                pan,
                null,                           // aadhaarNumber
                null,                           // passportNumber
                uan,
                esi,
                null,                           // monthlySalary
                null,                           // salaryFrequency
                bankName,
                account,
                ifsc,
                null,                           // bankBranchName
                null,                           // designation (free text would create one; never from an import)
                null, null, null, null,         // current address
                null, null, null,               // emergency contact
                null);                          // roleCode
        return new Mapped(row.getRowNumber(), req, jobTitle);
    }

    private static String upper(String s) {
        return blank(s) ? null : s.trim().toUpperCase(Locale.ROOT);
    }

    private static String digits(String s) {
        return blank(s) ? null : s.replaceAll("\\s+", "");
    }
}
