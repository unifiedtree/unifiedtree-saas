package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.enums.EmploymentType;
import com.hrms.employee.enums.Gender;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.LocalDate;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "employees")
@Getter
@Setter
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Employee extends BaseEntity {

    @Column(name = "employee_code", nullable = false, length = 20)
    private String employeeCode;

    @Column(name = "first_name", nullable = false, length = 100)
    private String firstName;

    @Column(name = "last_name", nullable = false, length = 100)
    private String lastName;

    @Column(name = "middle_name", length = 100)
    private String middleName;

    @Column(name = "email", nullable = false, length = 255)
    private String email;

    @Column(name = "personal_email", length = 255)
    private String personalEmail;

    @Column(name = "phone", length = 20)
    private String phone;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Enumerated(EnumType.STRING)
    @Column(name = "gender", length = 30)
    private Gender gender;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "branch_id")
    private UUID branchId;

    /**
     * The geofence zone this employee is allowed to punch in at. When set, the
     * attendance geofence check enforces THIS zone's coordinates/radius instead
     * of the branch's. Null = fall back to branch (or no geofence).
     */
    @Column(name = "geo_fence_zone_id")
    private UUID geoFenceZoneId;

    /**
     * Weekly off days as a CSV of ISO day numbers (1=Mon .. 7=Sun), e.g. "6,7"
     * for Sat+Sun. Drives the attendance present/absent/weekend calculation
     * per employee. Null/blank falls back to Sat+Sun.
     */
    @Column(name = "weekly_off_days", length = 20)
    private String weeklyOffDays;

    @Column(name = "reporting_manager_id")
    private UUID managerId;

    @Column(name = "job_title", length = 150)
    private String jobTitle;

    @Enumerated(EnumType.STRING)
    @Column(name = "employment_type", length = 30)
    private EmploymentType employmentType;

    @Enumerated(EnumType.STRING)
    @Column(name = "employment_status", nullable = false, length = 30)
    private EmploymentStatus employmentStatus;

    @Column(name = "date_of_joining")
    private LocalDate dateOfJoining;

    @Column(name = "confirmation_date")
    private LocalDate dateOfConfirmation;

    @Column(name = "date_of_termination")
    private LocalDate dateOfTermination;

    @Column(name = "probation_end_date")
    private LocalDate probationEndDate;

    @Column(name = "notice_period_days")
    private int noticePeriodDays = 30;

    @Column(name = "work_location", length = 255)
    private String workLocation;

    @Column(name = "salary_frequency", length = 30)
    private String salaryFrequency;

    @Column(name = "monthly_salary", precision = 14, scale = 2)
    private BigDecimal monthlySalary;

    @Column(name = "pan_number", length = 10)
    private String panNumber;

    @Column(name = "aadhaar_number", length = 12)
    private String aadhaarNumber;

    @Column(name = "pf_uan", length = 20)
    private String uanNumber;

    @Column(name = "esi_number", length = 30)
    private String esiNumber;

    @Column(name = "bank_account_number", length = 30)
    private String bankAccountNumber;

    @Column(name = "bank_ifsc", length = 11)
    private String bankIfscCode;

    @Column(name = "bank_name", length = 120)
    private String bankName;

    @Column(name = "bank_branch_name", length = 150)
    private String bankBranchName;

    @Column(name = "profile_photo_url", columnDefinition = "TEXT")
    private String profilePhotoUrl;

    @Column(name = "face_embedding", columnDefinition = "BYTEA")
    private byte[] faceEmbedding;

    @Column(name = "is_face_enrolled", nullable = false)
    private boolean isFaceEnrolled = false;
}
