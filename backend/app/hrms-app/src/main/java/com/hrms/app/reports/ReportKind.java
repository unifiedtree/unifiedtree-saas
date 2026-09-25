package com.hrms.app.reports;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Every report that can be downloaded, logged or scheduled, with the
 * permission(s) that open it. One place, so an export, a log entry or a
 * scheduled email can never be a wider door than the report screen itself.
 *
 * <p>{@link #permissions()} is "any of": Workforce Analytics opens with any of
 * the three people reports (each of its sections then needs its own).
 * {@link #AUDIT_LOG} and {@link #EMPLOYEE_DIRECTORY} are exports that are
 * logged but are not report pages, so they can't be scheduled.
 */
public enum ReportKind {
    HEADCOUNT("headcount", "Headcount report", true, List.of("hrms.report.headcount")),
    ATTRITION("attrition", "Attrition report", true, List.of("hrms.report.attrition")),
    ATTENDANCE_SUMMARY("attendance-summary", "Attendance summary", true, List.of("hrms.report.attendance")),
    LEAVE_BALANCE("leave-balance", "Leave balance report", true, List.of("hrms.report.leave")),
    LATE_MARKS("late-marks", "Late marks report", true, List.of("hrms.report.attendance")),
    DIVERSITY("diversity", "Diversity report", true, List.of("hrms.report.diversity")),
    WORKFORCE_ANALYTICS("workforce-analytics", "Workforce Analytics", true,
            List.of("hrms.report.headcount", "hrms.report.attrition", "hrms.report.diversity")),
    AUDIT_LOG("audit-log", "Audit log", false, List.of("audit.read")),
    EMPLOYEE_DIRECTORY("employee-directory", "Employee directory", false, List.of("hrms.employee.read"));

    private final String key;
    private final String label;
    private final boolean schedulable;
    private final List<String> permissions;

    ReportKind(String key, String label, boolean schedulable, List<String> permissions) {
        this.key = key;
        this.label = label;
        this.schedulable = schedulable;
        this.permissions = permissions;
    }

    public String key() { return key; }
    public String label() { return label; }
    public boolean schedulable() { return schedulable; }
    public List<String> permissions() { return permissions; }

    /** True when {@code held} contains any permission that opens this report. */
    public boolean openableWith(Set<String> held) {
        return held != null && permissions.stream().anyMatch(held::contains);
    }

    public static Optional<ReportKind> fromKey(String key) {
        if (key == null) return Optional.empty();
        String k = key.trim().toLowerCase();
        return Arrays.stream(values()).filter(r -> r.key.equals(k)).findFirst();
    }
}
