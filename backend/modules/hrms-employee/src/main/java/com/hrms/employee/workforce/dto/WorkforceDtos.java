package com.hrms.employee.workforce.dto;

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
            boolean active
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
            String fiscalYearStart
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
            String fiscalYearStart
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
            boolean active
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
            Boolean isHeadquarters
    ) { }

    public record UpdateGeofenceRequest(
            @NotNull BigDecimal latitude,
            @NotNull BigDecimal longitude,
            @NotNull Integer radiusMeters,
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
            Integer employeeCount,
            boolean active
    ) { }

    public record CreateDepartmentRequest(
            @NotNull UUID companyId,
            @NotBlank @Size(max = 100) String name,
            @Size(max = 30) String code,
            UUID parentDepartmentId,
            UUID departmentHeadEmployeeId,
            String description,
            List<UUID> branchIds
    ) { }

    // -- Designation ---------------------------------------------------------
    public record DesignationResponse(
            UUID id,
            UUID companyId,
            String title,
            String grade,
            UUID departmentId,
            UUID reportsToDesignationId,
            String jobResponsibilities,
            Integer headcount,
            boolean active
    ) { }

    public record CreateDesignationRequest(
            @NotNull UUID companyId,
            @NotBlank @Size(max = 100) String title,
            @Size(max = 10) String grade,
            UUID departmentId,
            UUID reportsToDesignationId,
            String jobResponsibilities
    ) { }

    public record UpdateDesignationRequest(
            @NotBlank @Size(max = 100) String title,
            @Size(max = 10) String grade,
            UUID departmentId,
            UUID reportsToDesignationId,
            String jobResponsibilities
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
            LocalDate lastWorkingDay,
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
            String uan,
            String esi,
            BigDecimal monthlySalary,
            String salaryFrequency,
            // bank
            String bankName,
            String bankAccountNumber,
            String bankIfsc,
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
    ) { }

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
            String profilePhotoUrl,
            // B2 FIX (audit 2026-08-15): HR could edit these fields on the
            // employee form and get a "Saved" toast, but the service silently
            // dropped them. Wire them through the update path.
            String uan,
            String esi,
            String bankAccountNumber,
            String bankIfsc,
            BigDecimal monthlySalary,
            String salaryFrequency,
            String weeklyOffDays
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
            int pageSize
    ) {
        public WorkforceFilter {
            if (pageSize <= 0)   pageSize = 50;
            if (pageSize > 200)  pageSize = 200;
            if (page < 0)        page = 0;
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
            Integer activeWorkersCount,
            boolean active
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
            String state
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
}
