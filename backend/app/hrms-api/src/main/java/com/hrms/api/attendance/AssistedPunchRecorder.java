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
        AttendanceDto dto = attendanceService.checkInJson(
                t.employeeId(), t.companyId(), t.branchId(), t.departmentId(),
                by.latitude(), by.longitude(), faceImageBase64, "FACE_RECOGNITION", tenantId,
                t.locationName(), null, by.deviceId(), null, wfhDay, false, null);
        insert(tenantId, dto, t.employeeId(), "CHECK_IN", dto.checkInTime(), by);
        return dto;
    }

    /** Punch out: {@link AttendanceService#checkOut} with the self face punch's arguments, plus "punched by". */
    @Transactional
    public AttendanceDto checkOut(UUID tenantId, Target t, PunchedBy by) {
        AttendanceDto dto = attendanceService.checkOut(
                t.employeeId(), by.latitude(), by.longitude(), "FACE_RECOGNITION",
                t.locationName(), null, by.deviceId(), false, null);
        insert(tenantId, dto, t.employeeId(), "CHECK_OUT", dto.checkOutTime(), by);
        return dto;
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
