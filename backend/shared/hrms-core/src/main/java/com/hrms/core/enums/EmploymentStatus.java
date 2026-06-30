package com.hrms.core.enums;

public enum EmploymentStatus {
    ACTIVE,
    ON_LEAVE,
    PROBATION,
    NOTICE_PERIOD,
    // SUSPENDED + EXITED are written by the workforce model (its own EmploymentStatus
    // enum) and stored in hrms.employees.employment_status. They were missing here, so
    // hydrating an employee with status EXITED/SUSPENDED into a core `Employee` entity
    // threw "No enum constant ... EXITED" -> HTTP 500 (e.g. the attendance dashboard).
    // The core enum must represent every value the column can hold.
    SUSPENDED,
    EXITED,
    TERMINATED,
    RESIGNED,
    RETIRED
}
