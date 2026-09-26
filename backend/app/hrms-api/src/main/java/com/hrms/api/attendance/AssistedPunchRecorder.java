package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.service.AttendanceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Writes an assisted face punch (V143.40): the punch on the employee's own
 * attendance, through exactly the code a self face punch uses, and the
 * "punched by" row in attendance.assisted_punches, in one transaction. So a
 * punch never lands without saying who made it.
 *
 * <p>attendance.assisted_punches is read and written with JDBC only; no JPA
 * entity maps it.
 */
@Component
public class AssistedPunchRecorder {

    private static final Logger log = LoggerFactory.getLogger(AssistedPunchRecorder.class);

    private final JdbcTemplate jdbc;
    private final AttendanceService attendanceService;

    public AssistedPunchRecorder(JdbcTemplate jdbc, AttendanceService attendanceService) {
        this.jdbc = jdbc;
        this.attendanceService = attendanceService;
    }

    /** Who made the punch, from where, on which phone. */
    public record PunchedBy(UUID userId, UUID employeeId, String name, double latitude, double longitude,
                            Double accuracyMeters, Integer distanceMeters, boolean withinFence, String deviceId,
                            UUID faceEventId) {}

    /** Where the employee's punch is filed: their company, branch and department, and the place name. */
    public record Target(UUID employeeId, UUID companyId, UUID branchId, UUID departmentId, String locationName) {}

    /**
     * Punch in: {@link AttendanceService#checkInJson} with the self face punch's
     * arguments, plus "punched by". No client event id: an assisted punch is made
     * online, and one punch in a day already stops a double punch.
     */
    @Transactional
    public AttendanceDto checkIn(UUID tenantId, Target t, String faceImageBase64, boolean wfhDay, PunchedBy by) {
        lockEmployee(tenantId, t.employeeId());
        AttendanceDto dto = attendanceService.checkInJson(
                t.employeeId(), t.companyId(), t.branchId(), t.departmentId(),
                by.latitude(), by.longitude(), faceImageBase64, "FACE_RECOGNITION", tenantId,
                t.locationName(), null, by.deviceId(), null, wfhDay, false, null);
        insert(tenantId, dto, t.employeeId(), "CHECK_IN", dto.checkInTime(), by);
        return dto;
    }

    /**
     * Punch out: {@link AttendanceService#checkOut} with the self face punch's
     * arguments, plus "punched by". Refused with {@link AlreadyPunchedOut} when
     * today is already punched out: checkOut would hand back that earlier punch
     * out, and it must not be recorded as this caller's.
     */
    @Transactional
    public AttendanceDto checkOut(UUID tenantId, Target t, PunchedBy by) {
        lockEmployee(tenantId, t.employeeId());
        attendanceService.getTodayRecord(t.employeeId())
                .filter(r -> r.checkInTime() != null && r.checkOutTime() != null)
                .ifPresent(r -> { throw new AlreadyPunchedOut(r.checkOutTime()); });
        AttendanceDto dto = attendanceService.checkOut(
                t.employeeId(), by.latitude(), by.longitude(), "FACE_RECOGNITION",
                t.locationName(), null, by.deviceId(), false, null);
        insert(tenantId, dto, t.employeeId(), "CHECK_OUT", dto.checkOutTime(), by);
        return dto;
    }

    /** Today was already punched out (by someone else, while the face was being checked). */
    public static class AlreadyPunchedOut extends RuntimeException {
        private final String checkOutTime;
        AlreadyPunchedOut(String checkOutTime) {
            super("Already punched out at " + checkOutTime);
            this.checkOutTime = checkOutTime;
        }
        public String checkOutTime() { return checkOutTime; }
    }

    /**
     * One assisted punch at a time per employee, until this transaction ends: two
     * managers punching the same person at once are taken in turn, so the second
     * sees the first's punch (one punch in and one punch out a day).
     */
    private void lockEmployee(UUID tenantId, UUID employeeId) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                (org.springframework.jdbc.core.ResultSetExtractor<Void>) rs -> null,
                "assisted-punch:" + tenantId + ":" + employeeId);
    }

    private void insert(UUID tenantId, AttendanceDto dto, UUID employeeId, String type, String punchTime, PunchedBy by) {
        Instant at = parse(punchTime);
        jdbc.update("""
                INSERT INTO attendance.assisted_punches (id, tenant_id, attendance_record_id, employee_id, attendance_date,
                    punch_type, punched_at, punched_by_user_id, punched_by_employee_id, punched_by_name, face_event_id,
                    latitude, longitude, accuracy_m, distance_m, within_fence, device_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), tenantId, dto.id(), employeeId, LocalDate.parse(dto.attendanceDate()),
                type, Timestamp.from(at), by.userId(), by.employeeId(), by.name(), by.faceEventId(),
                by.latitude(), by.longitude(), by.accuracyMeters(), by.distanceMeters(), by.withinFence(), by.deviceId());
    }

    private static Instant parse(String iso) {
        try {
            return iso != null ? Instant.parse(iso) : Instant.now();
        } catch (RuntimeException e) {
            return Instant.now();
        }
    }

    /**
     * The face check the verification just recorded: the newest passed check of
     * this purpose for this login in the last five minutes. Null when none.
     */
    public UUID latestPassedFaceEvent(UUID tenantId, UUID loginId, String purpose) {
        try {
            List<UUID> ids = jdbc.queryForList("""
                    SELECT id FROM attendance.face_verification_events
                     WHERE tenant_id = ? AND employee_id = ? AND purpose = ? AND result = 'PASS'
                       AND created_at >= now() - interval '5 minutes'
                     ORDER BY created_at DESC LIMIT 1
                    """, UUID.class, tenantId, loginId, purpose);
            return ids.isEmpty() ? null : ids.get(0);
        } catch (RuntimeException e) {
            log.warn("Could not find the face check for an assisted punch: {}", e.getMessage());
            return null;
        }
    }

    /**
     * The assisted punches filed on these days (the punch's attendance date), in
     * order, whose attendance record still exists; one employee's when
     * {@code employeeId} is set. Empty when V143.40 isn't applied yet (the table
     * is looked up first) or the read fails: "Punched by" is a label, never a
     * reason for a page to fail.
     */
    public List<AssistedPunchService.PunchedByRow> punchesBetween(UUID tenantId, LocalDate from, LocalDate to, UUID employeeId) {
        List<AssistedPunchService.PunchedByRow> out = new java.util.ArrayList<>();
        try {
            Boolean present = jdbc.queryForObject(
                    "SELECT to_regclass('attendance.assisted_punches') IS NOT NULL", Boolean.class);
            if (!Boolean.TRUE.equals(present)) return out;
            List<Object> params = new java.util.ArrayList<>(List.of(tenantId, from, to));
            if (employeeId != null) params.add(employeeId);
            jdbc.query("""
                    SELECT ap.attendance_record_id, ap.employee_id, ap.attendance_date, ap.punch_type,
                           ap.punched_by_name, ap.punched_at
                      FROM attendance.assisted_punches ap
                      JOIN attendance.records r ON r.id = ap.attendance_record_id AND r.attendance_date = ap.attendance_date
                                               AND r.employee_id = ap.employee_id
                     WHERE ap.tenant_id = ? AND ap.attendance_date BETWEEN ? AND ?
                    """ + (employeeId != null ? "   AND ap.employee_id = ?\n" : "") + " ORDER BY ap.punched_at",
                    (RowCallbackHandler) rs -> out.add(new AssistedPunchService.PunchedByRow(
                            (UUID) rs.getObject("attendance_record_id"), (UUID) rs.getObject("employee_id"),
                            rs.getObject("attendance_date", LocalDate.class).toString(), rs.getString("punch_type"),
                            rs.getString("punched_by_name"), rs.getTimestamp("punched_at").toInstant().toString())),
                    params.toArray());
        } catch (RuntimeException e) {
            log.warn("Could not read who made assisted punches: {}", e.getMessage());
            out.clear();
        }
        return out;
    }

    /**
     * "Punched by" names for face checks that cleared an assisted punch, by face
     * event id. Empty when there are none, or when V143.40 isn't applied yet (the
     * table is looked up first, so a missing table never breaks the caller's
     * transaction).
     */
    public Map<UUID, String> punchedByForFaceEvents(Collection<UUID> faceEventIds) {
        Map<UUID, String> out = new HashMap<>();
        if (faceEventIds == null || faceEventIds.isEmpty()) return out;
        try {
            Boolean present = jdbc.queryForObject(
                    "SELECT to_regclass('attendance.assisted_punches') IS NOT NULL", Boolean.class);
            if (!Boolean.TRUE.equals(present)) return out;
            List<UUID> ids = List.copyOf(faceEventIds);
            String in = String.join(",", Collections.nCopies(ids.size(), "?"));
            jdbc.query("SELECT face_event_id, punched_by_name FROM attendance.assisted_punches WHERE face_event_id IN (" + in + ")",
                    (RowCallbackHandler) rs -> out.put((UUID) rs.getObject("face_event_id"), rs.getString("punched_by_name")),
                    ids.toArray());
        } catch (RuntimeException e) {
            log.warn("Could not read who made assisted face punches: {}", e.getMessage());
        }
        return out;
    }
}
