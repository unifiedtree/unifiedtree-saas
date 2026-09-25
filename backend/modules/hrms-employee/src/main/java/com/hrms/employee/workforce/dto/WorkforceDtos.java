package com.hrms.employee.workforce.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Wire DTOs for the HRMS workforce surface. Records for terseness.
 * One source file so the DTO layer is easy to read end-to-end.
 */
public final class WorkforceDtos {
    private WorkforceDtos() { }

    // -- Company -------------------------------------------------------------
    public record CompanyResponse(
            UUID id,
            String name,
            String legalName,
            String registrationNumber,
            String panNumber,
            String gstin,
            String industry,
            String country,
            String timezone,
            String currency,
            String fiscalYearStart,
            String logoUrl,
            Integer employeeCount,
            boolean active,
            // V143.22: TAN, date of incorporation ("since") and a description.
            String tanNumber,
            LocalDate incorporationDate,
            String description
    ) { }

    public record CreateCompanyRequest(
            @NotBlank @Size(max = 150) String name,
            @Size(max = 200) String legalName,
            @Size(max = 50)  String registrationNumber,
            @Size(max = 15)  String panNumber,
            @Size(max = 20)  String gstin,
            @Size(max = 50)  String industry,
            String country,
            String timezone,
            String currency,
            String fiscalYearStart,
            @jakarta.validation.constraints.Pattern(regexp = "^$|^[A-Za-z]{4}[0-9]{5}[A-Za-z]$", message = "TAN looks like AAAA99999A")
            String tanNumber,
            /** yyyy-MM-dd; blank = not set. */
            String incorporationDate,
            @Size(max = 2000) String description
    ) { }

    public record UpdateCompanyRequest(
            @NotBlank @Size(max = 150) String name,
            @Size(max = 200) String legalName,
            @Size(max = 50)  String registrationNumber,
            @Size(max = 15)  String panNumber,
            @Size(max = 20)  String gstin,
            @Size(max = 50)  String industry,
            String country,
            String timezone,
            String currency,
            String fiscalYearStart,
            // V143.22. Null = leave unchanged; blank = clear.
            @jakarta.validation.constraints.Pattern(regexp = "^$|^[A-Za-z]{4}[0-9]{5}[A-Za-z]$", message = "TAN looks like AAAA99999A")
            String tanNumber,
            /** yyyy-MM-dd. Null = leave unchanged; blank = clear. */
            String incorporationDate,
            @Size(max = 2000) String description
    ) { }

    // -- Branch --------------------------------------------------------------
    public record BranchResponse(
            UUID id,
            UUID companyId,
            String name,
            String code,
            String addressLine,
            String city,
            String state,
            String country,
            String pincode,
            BigDecimal latitude,
            BigDecimal longitude,
            Integer geoFenceRadiusMeters,
            boolean geoFenceEnforced,
            UUID managerEmployeeId,
            Integer employeeCount,
            boolean headquarters,
            boolean active,
            /** HEAD_OFFICE, BRANCH, PLANT, WAREHOUSE, OFFICE, STORE or OTHER (V143.22). */
            String branchType
    ) { }

    public record CreateBranchRequest(
            @NotNull UUID companyId,
            @NotBlank @Size(max = 150) String name,
            @Size(max = 30)  String code,
            @Size(max = 255) String addressLine,
            @Size(max = 100) String city,
            @Size(max = 100) String state,
            String country,
            String pincode,
            BigDecimal latitude,
            BigDecimal longitude,
            Integer geoFenceRadiusMeters,
            Boolean isHeadquarters,
            /** V143.22. HEAD_OFFICE also makes it the head office. Null = BRANCH (or HEAD_OFFICE when isHeadquarters). */
            String branchType
    ) { }

    /**
     * Partial branch update. 2026-09-09: BranchService had create, geofence and
     * archive but NO update, so a branch's name, code or address could never be
     * corrected from any client — web or mobile. A typo was permanent short of
     * archiving the branch and re-creating it, which orphans the employees
     * pointing at it.
     *
     * <p>Every field is nullable and applied only when present. That is
     * deliberate and load-bearing: CompanyService.update took the opposite
     * approach and unconditionally copied registrationNumber / panNumber /
     * gstin, so every company edit silently NULLed the statutory ids used for
     * PF, ESI and TDS. Partial-and-null-guarded is the pattern here.
     */
    public record UpdateBranchRequest(
            @Size(max = 150) String name,
            @Size(max = 30)  String code,
            @Size(max = 255) String addressLine,
            @Size(max = 100) String city,
            @Size(max = 100) String state,
            String country,
            String pincode,
            Boolean isHeadquarters,
            Boolean isActive,
            /** V143.22. HEAD_OFFICE makes it the head office; any other type makes it an ordinary branch. */
            String branchType
    ) { }

    public record UpdateGeofenceRequest(
            @NotNull @jakarta.validation.constraints.DecimalMin("-90") @jakarta.validation.constraints.DecimalMax("90") BigDecimal latitude,
            @NotNull @jakarta.validation.constraints.DecimalMin("-180") @jakarta.validation.constraints.DecimalMax("180") BigDecimal longitude,
            @NotNull @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(100000) Integer radiusMeters,
            Boolean enforced
    ) { }

    // -- Department ----------------------------------------------------------
    public record DepartmentResponse(
            UUID id,
            UUID companyId,
            String name,
            String code,
            UUID parentDepartmentId,
            UUID departmentHeadEmployeeId,
            String description,
            // 2026-09-10: added so the colour + icon an admin picks are real
            // org settings that every viewer sees, not a per-browser
            // localStorage key. Both nullable — the SPA falls back to its own
            // default palette when the row was created before this landed.
            String colorHex,
            String iconKey,
            Integer employeeCount,
            boolean active,
            /** Branches this department works in (hrms.department_branches); empty = not limited. */
            List<UUID> branchIds
    ) { }

    public record CreateDepartmentRequest(
            @NotNull UUID companyId,
            @NotBlank @Size(max = 100) String name,
            @Size(max = 30) String code,
            UUID parentDepartmentId,
            UUID departmentHeadEmployeeId,
            String description,
            @Size(max = 9)  String colorHex,
            @Size(max = 40) String iconKey,
            List<UUID> branchIds
    ) { }

    // -- Designation ---------------------------------------------------------
    public record DesignationResponse(
            UUID id,
            UUID companyId,
            String title,
            /** The linked grade's code, or the legacy free text when no grade is linked. */
            String grade,
            UUID departmentId,
            UUID reportsToDesignationId,
            String jobResponsibilities,
            Integer headcount,
            boolean active,
            /** V143.22: the grade by id (null = none, or legacy text that matched no grade). */
            UUID gradeId,
            String code
    ) { }

    /** {@code gradeId} wins over {@code grade}: when it is set the text becomes that grade's code. */
    public record CreateDesignationRequest(
            @NotNull UUID companyId,
            @NotBlank @Size(max = 100) String title,
            @Size(max = 20) String grade,
            UUID departmentId,
            UUID reportsToDesignationId,
            String jobResponsibilities,
            UUID gradeId,
            @Size(max = 30) String code
    ) { }

    /** A full replace, like before: a null gradeId with a null grade clears the grade. */
    public record UpdateDesignationRequest(
            @NotBlank @Size(max = 100) String title,
            @Size(max = 20) String grade,
            UUID departmentId,
            UUID reportsToDesignationId,
            String jobResponsibilities,
            UUID gradeId,
            @Size(max = 30) String code
    ) { }

    // -- Workforce employee --------------------------------------------------
    public record WorkforceEmployeeResponse(
            UUID id,
            UUID companyId,
            String employeeCode,
            String firstName,
            String middleName,
            String lastName,
            String email,
            String phone,
            LocalDate dateOfBirth,
            WorkforceEmployee.Gender gender,
            UUID departmentId,
            UUID designationId,
            UUID branchId,
            UUID geoFenceZoneId,
            UUID reportingManagerId,
            WorkforceEmployee.EmploymentType employmentType,
            WorkforceEmployee.EmploymentStatus employmentStatus,
            LocalDate dateOfJoining,
            LocalDate probationEndDate,
            LocalDate confirmationDate,
            LocalDate noticeStartDate,
            LocalDate lastWorkingDay,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
            String exitReason,
            // V143.13: resignation / termination / ... (null = not recorded).
            WorkforceEmployee.ExitType exitType,
            // QA-FIX (2026-08-13 reverify R2): ctcAnnual is blanked to null in the
            // list projection (via toListResponse) to prevent salary-scraping of the
            // whole workforce. Jackson NON_NULL omits the KEY entirely when value is
            // null, so list responses no longer even mention the field. Detail GETs
            // still populate it and it serialises normally.
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
            BigDecimal ctcAnnual,
            // B2 FIX (audit 2026-08-15): expose bank/statutory/salary fields.
            // Bank account is masked to last-4 unless caller has the elevated
            // hrms.employees.pii.read permission — see WorkforceEmployeeService.toResponse.
            String uan,
            String esi,
            // 2026-09-08: projected so edit-mode prefill can hydrate the field
            // instead of blanking a previously-saved branch name on every save.
            String bankBranchName,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
            String bankAccountNumber,
            String bankIfsc,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
            BigDecimal monthlySalary,
            String salaryFrequency,
            // B2 FIX (audit 2026-08-17): projected as List<Integer> of ISO day
            // numbers (1=Mon..7=Sun). Stored as CSV in the DB column; parsed
            // in WorkforceEmployeeService.parseWeeklyOffDays. Frontend edit
            // mode reads this to hydrate the weekly-off checkboxes; a String
            // projection made the checkbox pre-fill default to Sat+Sun.
            List<Integer> weeklyOffDays,
            String profilePhotoUrl,
            boolean faceEnrolled,
            boolean hasAccount,
            boolean active
    ) { }

    public record CreateWorkforceEmployeeRequest(
            @NotNull UUID companyId,
            @Size(max = 50) String employeeCode,           // optional - generated if blank
            @NotBlank @Size(max = 100) String firstName,
            @Size(max = 100) String middleName,
            @Size(max = 100) String lastName,
            @Size(max = 255) String email,
            @Size(max = 20)  String phone,
            LocalDate dateOfBirth,
            WorkforceEmployee.Gender gender,
            UUID departmentId,
            UUID designationId,
            UUID branchId,
            UUID geoFenceZoneId,
            String weeklyOffDays,
            UUID reportingManagerId,
            WorkforceEmployee.EmploymentType employmentType,
            LocalDate dateOfJoining,
            BigDecimal ctcAnnual,
            // identity
            String panNumber,
            String aadhaarNumber,
            String passportNumber,
            // B2 FIX: statutory + salary fields (were silently dropped by create/update)
            //
            // 2026-09-08 DATA-LOSS FIX: both clients POST `uanNumber` / `esiNumber`
            // (web EmployeeForm.tsx:625-626, mobile staff-onboarding.tsx payload),
            // but this record declared only `uan` / `esi` and Jackson has no
            // case/name fuzzing — so every UAN and ESI number HR typed was
            // silently discarded while the form said "Employee created".
            // @JsonAlias accepts BOTH spellings so neither client needs a change
            // and older callers keep working.
            @JsonAlias({"uanNumber", "pfUan"})  String uan,
            @JsonAlias({"esiNumber"})           String esi,
            BigDecimal monthlySalary,
            String salaryFrequency,
            // bank
            String bankName,
            String bankAccountNumber,
            String bankIfsc,
            // Same 2026-09-08 fix: the column hrms.employees.bank_branch_name has
            // always existed and both clients send bankBranchName, but there was
            // no field here to receive it.
            String bankBranchName,
            // Free-text designation. The web form falls back to a text input when
            // the tenant has no designations configured yet (EmployeeForm.tsx:613);
            // that value had nowhere to land. The service now auto-creates a
            // Designation row from it and links designationId.
            String designation,
            // address
            String currentAddressLine,
            String currentAddressCity,
            String currentAddressState,
            String currentAddressPincode,
            // emergency
            String emergencyContactName,
            String emergencyContactRelation,
            String emergencyContactPhone,
            // role to assign on invitation (defaults to EMPLOYEE if null)
            String roleCode
    ) {
        /**
         * Build the minimal request used by the workspace-invite path, where we
         * only know a company, a name and an email — everything else is filled
         * in later by the employee or HR.
         *
         * <p>This exists because {@code WorkspaceAccessService} used to call the
         * canonical constructor positionally with ~36 trailing nulls, and that
         * call site broke every single time a field was added to this record
         * (twice now: the B2 statutory fields on 2026-08-15, then bankBranchName
         * and designation on 2026-09-08 — the second one got past a local
         * incremental {@code mvn compile} and only failed in Cloud Build).
         *
         * <p>Keep this factory adjacent to the component list: adding a field
         * above means adding exactly one {@code null} here, and no call site
         * anywhere else has to change.
         */
        public static CreateWorkforceEmployeeRequest minimal(
                UUID companyId, String firstName, String lastName, String email) {
            return new CreateWorkforceEmployeeRequest(
                    companyId,
                    null,            // employeeCode — generated server-side
                    firstName,
                    null,            // middleName
                    lastName,
                    email,
                    null,            // phone
                    null,            // dateOfBirth
                    null,            // gender
                    null,            // departmentId
                    null,            // designationId
                    null,            // branchId
                    null,            // geoFenceZoneId
                    null,            // weeklyOffDays — server default Sat+Sun
                    null,            // reportingManagerId
                    null,            // employmentType — server default FULL_TIME
                    null,            // dateOfJoining
                    null,            // ctcAnnual
                    null,            // panNumber
                    null,            // aadhaarNumber
                    null,            // passportNumber
                    null,            // uan
                    null,            // esi
                    null,            // monthlySalary
                    null,            // salaryFrequency
                    null,            // bankName
                    null,            // bankAccountNumber
                    null,            // bankIfsc
                    null,            // bankBranchName
                    null,            // designation
                    null,            // currentAddressLine
                    null,            // currentAddressCity
                    null,            // currentAddressState
                    null,            // currentAddressPincode
                    null,            // emergencyContactName
                    null,            // emergencyContactRelation
                    null,            // emergencyContactPhone
                    null             // roleCode — server default EMPLOYEE
            );
        }
    }

    public record UpdateWorkforceEmployeeRequest(
            String firstName,
            String middleName,
            String lastName,
            String email,
            String phone,
            LocalDate dateOfBirth,
            WorkforceEmployee.Gender gender,
            UUID departmentId,
            UUID designationId,
            UUID branchId,
            UUID geoFenceZoneId,
            UUID reportingManagerId,
            WorkforceEmployee.EmploymentType employmentType,
            WorkforceEmployee.EmploymentStatus employmentStatus,
            LocalDate dateOfJoining,
            LocalDate probationEndDate,
            LocalDate confirmationDate,
            LocalDate noticeStartDate,
            LocalDate lastWorkingDay,
            String exitReason,
            BigDecimal ctcAnnual,
            // 2026-09-08: mirror the create-side alias fix so an EDIT doesn't
            // silently wipe/ignore statutory + branch fields either.
            String bankBranchName,
            String profilePhotoUrl,
            // B2 FIX (audit 2026-08-15): HR could edit these fields on the
            // employee form and get a "Saved" toast, but the service silently
            // dropped them. Wire them through the update path.
            //
            // 2026-09-08: same @JsonAlias fix as the create record — clients
            // send uanNumber/esiNumber, this record declared uan/esi.
            @JsonAlias({"uanNumber", "pfUan"})  String uan,
            @JsonAlias({"esiNumber"})           String esi,
            // 2026-09-08 audit: CREATE accepted panNumber / aadhaarNumber /
            // bankName but UPDATE did not, so those three could be set once at
            // hire time and never corrected. The employee form pre-fills them
            // in edit mode, which made the omission look like a save bug.
            String panNumber,
            String aadhaarNumber,
            String bankName,
            String bankAccountNumber,
            String bankIfsc,
            BigDecimal monthlySalary,
            String salaryFrequency,
            String weeklyOffDays,
            // V143.13: correct the recorded exit type from the separation editor.
            WorkforceEmployee.ExitType exitType
    ) { }

    /**
     * Aggregated status counts for the Workforce Directory stat cards.
     *
     * <p>Backs {@code GET /v1/hrms/employees/counts}. Fields are the raw
     * status buckets so the SPA can compose derived tiles ("Inactive" =
     * exited + terminated) without extra round trips. {@code total}
     * counts every active employee row (including PROBATION and SUSPENDED
     * which aren't broken out individually).
     */
    public record EmployeeCountsResponse(
            long total,
            long active,
            long notice,
            long exited,
            long terminated
    ) { }

    /** Filter object for the Workforce Directory page (matches client UI). */
    public record WorkforceFilter(
            UUID companyId,
            UUID departmentId,
            UUID branchId,
            WorkforceEmployee.EmploymentStatus status,
            String search,
            int page,
            int pageSize,
            /** Only people without a department (the dashboard's and reports' "No department"). */
            boolean noDepartment,
            /** Only people with an upcoming birthday / work anniversary / retirement (null = no such filter). */
            com.hrms.employee.workforce.service.MilestoneWindow.Kind milestone,
            /** The milestone window: days for birthdays and anniversaries, months for retirements (null = the dashboard's default). */
            Integer milestoneWithin
    ) {
        public WorkforceFilter {
            if (pageSize <= 0)   pageSize = 50;
            if (pageSize > 200)  pageSize = 200;
            if (page < 0)        page = 0;
        }

        /** The original filter, without the "no department" and milestone options. */
        public WorkforceFilter(UUID companyId, UUID departmentId, UUID branchId,
                               WorkforceEmployee.EmploymentStatus status, String search, int page, int pageSize) {
            this(companyId, departmentId, branchId, status, search, page, pageSize, false, null, null);
        }
    }

    // -- Contractor ----------------------------------------------------------
    public record ContractorResponse(
            UUID id,
            UUID companyId,
            String agencyName,
            String registrationNumber,
            String gstin,
            String contactPersonName,
            String contactEmail,
            String contactPhone,
            String city,
            /** Contract workers linked to the agency who work here now (counted, never typed in). */
            Integer activeWorkersCount,
            boolean active,
            // V143.22
            String licenceNumber,
            LocalDate licenceValidUntil,
            String serviceType,
            List<UUID> siteBranchIds,
            /** Every linked contract worker, including people who have left. */
            List<UUID> workerIds
    ) { }

    public record CreateContractorRequest(
            @NotNull UUID companyId,
            @NotBlank @Size(max = 150) String agencyName,
            @Size(max = 50)  String registrationNumber,
            @Size(max = 20)  String gstin,
            @Size(max = 100) String contactPersonName,
            @Size(max = 255) String contactEmail,
            @Size(max = 20)  String contactPhone,
            String addressLine,
            String city,
            String state,
            // V143.22
            @Size(max = 60)  String licenceNumber,
            LocalDate licenceValidUntil,
            @Size(max = 150) String serviceType,
            List<UUID> siteBranchIds
    ) { }

    /**
     * Partial agency update (V143.22). Null = leave unchanged; a blank string
     * clears a text field; an empty siteBranchIds clears the sites. The Master
     * form doesn't show GSTIN or the address, so a full replace would wipe them.
     */
    public record UpdateContractorRequest(
            @Size(max = 150) String agencyName,
            @Size(max = 50)  String registrationNumber,
            @Size(max = 20)  String gstin,
            @Size(max = 100) String contactPersonName,
            @Size(max = 255) String contactEmail,
            @Size(max = 20)  String contactPhone,
            @Size(max = 255) String addressLine,
            @Size(max = 100) String city,
            @Size(max = 100) String state,
            @Size(max = 60)  String licenceNumber,
            /** yyyy-MM-dd; blank clears it. */
            String licenceValidUntil,
            @Size(max = 150) String serviceType,
            List<UUID> siteBranchIds
    ) { }

    /** One contract worker linked to an agency. */
    public record ContractorWorkerResponse(
            UUID employeeId,
            String employeeCode,
            String name,
            String employmentStatus,
            java.time.Instant linkedAt
    ) { }

    // -- Classification rule -------------------------------------------------
    public record ClassificationRuleResponse(
            UUID id,
            UUID companyId,
            String name,
            String code,
            String description,
            Integer headcount,
            boolean active
    ) { }

    public record CreateClassificationRuleRequest(
            @NotNull UUID companyId,
            @NotBlank @Size(max = 100) String name,
            @Size(max = 30) String code,
            String description
    ) { }

    /** Partial update: null = leave unchanged; a blank code or description clears it. */
    public record UpdateClassificationRuleRequest(
            @Size(max = 100) String name,
            @Size(max = 30) String code,
            String description
    ) { }

    // -- Grade ---------------------------------------------------------------
    /**
     * A grade as the API returns it. {@code minCtcAnnual}/{@code maxCtcAnnual}
     * are the pay band: null when none is set, and also when the caller may not
     * see pay bands ({@code bandVisible} says which).
     */
    public record GradeResponse(
            UUID id,
            UUID tenantId,
            UUID companyId,
            String name,
            String code,
            int level,
            String description,
            boolean active,
            BigDecimal minCtcAnnual,
            BigDecimal maxCtcAnnual,
            boolean bandVisible,
            java.time.Instant createdAt,
            java.time.Instant updatedAt
    ) { }

    /** The pay band that applies to one employee: their designation's grade. */
    public record EmployeePayBandResponse(
            UUID employeeId,
            UUID designationId,
            UUID gradeId,
            String gradeCode,
            String gradeName,
            BigDecimal minCtcAnnual,
            BigDecimal maxCtcAnnual
    ) { }

    /** Replace the branches a department works in. Empty = not limited to any branch. */
    public record DepartmentBranchesRequest(@NotNull List<UUID> branchIds) { }
}
