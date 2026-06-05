package com.hrms.attendance.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One row in the Attendance App's "Find Others" panel and pin on the Geofence
 * Map. The fields below are the union of what the map (lat/lng/zoneName) and
 * the slide-up Find Others panel (employeeCode, departmentId/Name, branchId,
 * status badges) need.
 *
 * <p>{@code live} is true when the employee has an open attendance record
 * (checked in, not yet checked out). The Attendance App buckets the
 * NOW/1H AGO/OFFLINE status badge from {@code lastSeenAt} (= check-in time)
 * since the backend stores check-in coords, not a streaming GPS heartbeat.
 *
 * <p>NEW fields (added with V050+): {@code employeeCode}, {@code departmentId},
 * {@code departmentName}, {@code branchId}. Existing fields are unchanged so
 * older clients continue to deserialize cleanly.
 */
public record LiveLocationResponse(
        UUID employeeId,
        String employeeCode,
        String fullName,
        String jobTitle,
        String profilePhotoUrl,
        Double latitude,
        Double longitude,
        String locationName,
        String zoneName,
        UUID departmentId,
        String departmentName,
        UUID branchId,
        Instant lastSeenAt,
        boolean live
) {
}
