package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Canonical employee record matching the {@code hrms.employees} table. This
 * is distinct from the legacy {@link com.hrms.employee.entity.Employee} that
 * still services the existing attendance/leave flows; once data is migrated,
 * the legacy entity will be retired.
 */
@Entity
@Table(schema = "hrms", name = "employees")
@Getter
@Setter
public class WorkforceEmployee extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    // -- identity (public) ---------------------------------------------------
    @Column(name = "employee_code", nullable = false, length = 50)
    private String employeeCode;

    @Column(name = "first_name", nullable = false, length = 100)
    private String firstName;

    @Column(name = "middle_name", length = 100)
    private String middleName;

    @Column(name = "last_name", length = 100)
    private String lastName;

    @Column(name = "preferred_name", length = 100)
    private String preferredName;

    @Column(name = "email", length = 255)
    private String email;

    @Column(name = "secondary_email", length = 255)
    private String secondaryEmail;

    @Column(name = "phone", length = 20)
    private String phone;

    @Column(name = "secondary_phone", length = 20)
    private String secondaryPhone;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Enumerated(EnumType.STRING)
    @Column(name = "gender", length = 30)
    private Gender gender;

    @Column(name = "marital_status", length = 20)
    private String maritalStatus;

    @Column(name = "blood_group", length = 5)
    private String bloodGroup;

    @Column(name = "nationality", length = 50)
    private String nationality;

    @Column(name = "profile_photo_url", length = 500)
    private String profilePhotoUrl;

    // -- employment ----------------------------------------------------------
    @Column(name = "department_id") private UUID departmentId;
    @Column(name = "designation_id") private UUID designationId;
    @Column(name = "branch_id")     private UUID branchId;
    // Geofence zone the employee must punch in at (overrides branch geofence).
    @Column(name = "geo_fence_zone_id") private UUID geoFenceZoneId;
    // Weekly off days, CSV of ISO day numbers (1=Mon..7=Sun); e.g. "6,7"=Sat+Sun.
    @Column(name = "weekly_off_days", length = 20) private String weeklyOffDays;
    @Column(name = "reporting_manager_id") private UUID reportingManagerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "employment_type", nullable = false, length = 30)
    private EmploymentType employmentType = EmploymentType.FULL_TIME;

    @Enumerated(EnumType.STRING)
    @Column(name = "employment_status", nullable = false, length = 30)
    private EmploymentStatus employmentStatus = EmploymentStatus.PROBATION;

    @Column(name = "date_of_joining")       private LocalDate dateOfJoining;
    @Column(name = "probation_end_date")    private LocalDate probationEndDate;
    @Column(name = "confirmation_date")     private LocalDate confirmationDate;
    @Column(name = "notice_start_date")     private LocalDate noticeStartDate;
    @Column(name = "last_working_day")      private LocalDate lastWorkingDay;
    @Column(name = "exit_reason", length = 100) private String exitReason;

    @Column(name = "ctc_annual", precision = 14, scale = 2)
    private BigDecimal ctcAnnual;

    @Column(name = "job_responsibilities", columnDefinition = "TEXT")
    private String jobResponsibilities;

    // -- statutory identity --------------------------------------------------
    @Column(name = "pan_number",      length = 15) private String panNumber;
    @Column(name = "aadhaar_number",  length = 20) private String aadhaarNumber;
    @Column(name = "passport_number", length = 20) private String passportNumber;
    @Column(name = "pf_uan",          length = 20) private String pfUan;
    @Column(name = "esi_number",      length = 20) private String esiNumber;

    // -- bank ----------------------------------------------------------------
    @Column(name = "bank_name",                length = 100) private String bankName;
    @Column(name = "bank_account_number",      length = 50)  private String bankAccountNumber;
    @Column(name = "bank_ifsc",                length = 15)  private String bankIfsc;
    @Column(name = "bank_account_holder_name", length = 150) private String bankAccountHolderName;

    // -- address -------------------------------------------------------------
    @Column(name = "current_address_line",      length = 255) private String currentAddressLine;
    @Column(name = "current_address_city",      length = 100) private String currentAddressCity;
    @Column(name = "current_address_state",     length = 100) private String currentAddressState;
    @Column(name = "current_address_pincode",   length = 15)  private String currentAddressPincode;
    @Column(name = "permanent_address_line",    length = 255) private String permanentAddressLine;
    @Column(name = "permanent_address_city",    length = 100) private String permanentAddressCity;
    @Column(name = "permanent_address_state",   length = 100) private String permanentAddressState;
    @Column(name = "permanent_address_pincode", length = 15)  private String permanentAddressPincode;

    // -- emergency contact ---------------------------------------------------
    @Column(name = "emergency_contact_name",     length = 150) private String emergencyContactName;
    @Column(name = "emergency_contact_relation", length = 50)  private String emergencyContactRelation;
    @Column(name = "emergency_contact_phone",    length = 20)  private String emergencyContactPhone;

    // -- biometric -----------------------------------------------------------
    @Column(name = "is_face_enrolled", nullable = false) private boolean faceEnrolled;
    @Column(name = "face_template_id", length = 100)     private String  faceTemplateId;
    @Column(name = "face_enrolled_at")                   private OffsetDateTime faceEnrolledAt;

    // -- meta ----------------------------------------------------------------
    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    public enum Gender { MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY }
    public enum EmploymentType { FULL_TIME, PART_TIME, CONTRACT, INTERN, CONSULTANT }
    public enum EmploymentStatus { PROBATION, ACTIVE, NOTICE_PERIOD, SUSPENDED, EXITED, TERMINATED }
}
