package com.hrms.api.attendance;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * What a punch-in alert needs from the database (V143.72), read with JDBC on the
 * alert's own thread, inside a read transaction the caller opened with the
 * tenant bound. Every query names the tenant as well, so nothing from another
 * workspace can be read even if row-level security were off.
 */
@Component
class PunchAlertFacts {

    /** The most role holders one alert considers (the alert itself is capped lower). */
    static final int MAX_ROLE_HOLDERS = 500;

    private final JdbcTemplate jdbc;

    PunchAlertFacts(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The person who punched: name, company, work area and manager (their
     * reporting manager, else their department head).
     */
    record Person(String name, UUID companyId, UUID branchId, UUID zoneId, UUID managerId) {}

    /** The person, or null when they aren't in this workspace. */
    Person person(UUID tenantId, UUID employeeId) {
        List<Person> rows = jdbc.query("""
                SELECT NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS name,
                       e.company_id, e.branch_id, e.geo_fence_zone_id,
                       COALESCE(e.reporting_manager_id, d.department_head_employee_id) AS manager_id
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.id = ? AND e.tenant_id = ?
                """, (rs, i) -> new Person(rs.getString("name"), (UUID) rs.getObject("company_id"),
                (UUID) rs.getObject("branch_id"), (UUID) rs.getObject("geo_fence_zone_id"),
                (UUID) rs.getObject("manager_id")), employeeId, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** These people as candidates (their company, whether they still work here, whether they have a login). */
    List<PunchAlerts.Candidate> candidates(UUID tenantId, Collection<UUID> employeeIds) {
        List<PunchAlerts.Candidate> out = new ArrayList<>();
        if (employeeIds == null || employeeIds.isEmpty()) return out;
        jdbc.query("""
                SELECT e.id, e.company_id, (%s) AS working,
                       EXISTS (SELECT 1 FROM auth.user_credentials uc
                                WHERE uc.tenant_id = e.tenant_id AND uc.employee_id = e.id AND uc.is_active = TRUE) AS has_login
                  FROM hrms.employees e
                 WHERE e.tenant_id = ? AND e.id = ANY(CAST(? AS uuid[]))
                """.formatted(PunchAlertSettingsService.WORKING), (RowCallbackHandler) rs -> out.add(new PunchAlerts.Candidate(
                (UUID) rs.getObject("id"), (UUID) rs.getObject("company_id"), rs.getBoolean("working"), rs.getBoolean("has_login"))),
                tenantId, PunchAlertSettingsService.array(employeeIds));
        return out;
    }

    /**
     * People in this company who hold one of these roles through an active login,
     * never through a role that can't be chosen (EMPLOYEE, the platform's own).
     */
    List<PunchAlerts.Candidate> roleHolders(UUID tenantId, UUID companyId, Collection<UUID> roleIds) {
        List<PunchAlerts.Candidate> out = new ArrayList<>();
        if (roleIds == null || roleIds.isEmpty() || companyId == null) return out;
        jdbc.query("""
                SELECT DISTINCT e.id, e.company_id, (%s) AS working
                  FROM rbac.user_roles ur
                  JOIN rbac.roles r ON r.id = ur.role_id AND (r.tenant_id IS NULL OR r.tenant_id = ur.tenant_id)
                  JOIN auth.user_credentials uc ON uc.id = ur.user_id AND uc.tenant_id = ur.tenant_id AND uc.is_active = TRUE
                  JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = ur.tenant_id
                 WHERE ur.tenant_id = ? AND ur.role_id = ANY(CAST(? AS uuid[])) AND e.company_id = ?
                   AND NOT (r.code = ANY(CAST(? AS text[])))
                 LIMIT ?
                """.formatted(PunchAlertSettingsService.WORKING), (RowCallbackHandler) rs -> out.add(new PunchAlerts.Candidate(
                (UUID) rs.getObject("id"), (UUID) rs.getObject("company_id"), rs.getBoolean("working"), true)),
                tenantId, PunchAlertSettingsService.array(roleIds), companyId,
                PunchAlertSettingsService.HIDDEN_ROLE_CODES.stream().sorted().collect(Collectors.joining(",", "{", "}")),
                MAX_ROLE_HOLDERS);
        return out;
    }

    /**
     * The company's places people punch at: its active office zones and its
     * active branches with a position (a branch without its own radius uses
     * 100 m, as the punch's zone check does). The person's assigned zone and
     * branch are marked as their own.
     */
    List<PunchAlerts.Place> places(UUID tenantId, UUID companyId, UUID ownZoneId, UUID ownBranchId) {
        List<PunchAlerts.Place> out = new ArrayList<>();
        if (companyId == null) return out;
        jdbc.query("""
                SELECT z.name, z.latitude, z.longitude, z.radius_meters AS radius, (z.id = ?) AS own
                  FROM public.geo_fence_zones z
                 WHERE z.tenant_id = ? AND z.company_id = ? AND z.is_active = TRUE
                UNION ALL
                SELECT b.name, b.latitude::float8, b.longitude::float8, COALESCE(b.geo_fence_radius_meters, 100), (b.id = ?)
                  FROM org.branches b
                 WHERE b.tenant_id = ? AND b.company_id = ? AND b.is_active = TRUE
                   AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL
                """, (RowCallbackHandler) rs -> out.add(new PunchAlerts.Place(rs.getString("name"),
                rs.getDouble("latitude"), rs.getDouble("longitude"), rs.getInt("radius"), rs.getBoolean("own"))),
                ownZoneId, tenantId, companyId, ownBranchId, tenantId, companyId);
        return out;
    }

    /** Who punched in for the person and the accuracy of their phone, for an assisted punch-in. */
    record Assisted(String punchedByName, Double accuracyMeters) {}

    /** The assisted punch-in behind this record, or null when they punched in themself (or V143.40 isn't applied). */
    Assisted assisted(UUID tenantId, UUID attendanceRecordId) {
        if (attendanceRecordId == null) return null;
        Boolean present = jdbc.queryForObject("SELECT to_regclass('attendance.assisted_punches') IS NOT NULL", Boolean.class);
        if (!Boolean.TRUE.equals(present)) return null;
        List<Assisted> rows = jdbc.query("""
                SELECT punched_by_name, accuracy_m FROM attendance.assisted_punches
                 WHERE tenant_id = ? AND attendance_record_id = ? AND punch_type = 'CHECK_IN'
                 ORDER BY punched_at DESC LIMIT 1
                """, (rs, i) -> {
            double acc = rs.getDouble("accuracy_m");
            return new Assisted(rs.getString("punched_by_name"), rs.wasNull() ? null : acc);
        }, tenantId, attendanceRecordId);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
