package com.hrms.api.attendance;

import com.hrms.core.exception.FeatureNotReady;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Face stations and their punches (V143.95), read and written with JDBC only: no
 * JPA entity maps attendance.face_stations or attendance.station_punches. Row-level
 * security keeps every query to the caller's (or the station's) workspace.
 * Every call answers FEATURE_NOT_READY while the tables are missing.
 */
@Component
public class FaceStations {

    public static final String ACTIVE = "ACTIVE";
    public static final String REVOKED = "REVOKED";

    /** One station, with its branch's name and its punch counts (today; waiting for approval in the last 7 days). */
    public record Station(UUID id, UUID companyId, UUID branchId, String branchName, String name, String status,
                          String createdByName, Instant createdAt, String revokedByName, Instant revokedAt,
                          Instant lastStartedAt, String lastStartedByName, Instant lastUsedAt,
                          int punchesToday, int waitingApproval) {
        public boolean active() { return ACTIVE.equals(status); }
    }

    private final JdbcTemplate jdbc;

    public FaceStations(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Whether V143.95 is applied. */
    public boolean ready() {
        try {
            return Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT to_regclass('attendance.face_stations') IS NOT NULL AND to_regclass('attendance.station_punches') IS NOT NULL",
                    Boolean.class));
        } catch (RuntimeException e) {
            return false;
        }
    }

    void requireReady() {
        if (!ready()) throw new FeatureNotReady();
    }

    private static final String SELECT = """
            SELECT s.id, s.company_id, s.branch_id, b.name AS branch_name, s.name, s.status, s.created_by_name, s.created_at,
                   s.revoked_by_name, s.revoked_at, s.last_started_at, s.last_started_by_name, s.last_used_at,
                   (SELECT count(*) FROM attendance.station_punches p
                     WHERE p.station_id = s.id AND p.attendance_date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS punches_today,
                   (SELECT count(*) FROM attendance.station_punches p
                     WHERE p.station_id = s.id AND p.needs_approval
                       AND p.punched_at >= now() - interval '7 days'
                       AND NOT EXISTS (SELECT 1 FROM attendance.face_event_reviews r WHERE r.event_id = p.face_event_id)) AS waiting
              FROM attendance.face_stations s
              LEFT JOIN org.branches b ON b.id = s.branch_id
            """;

    private static final RowMapper<Station> ROW = (rs, i) -> new Station(
            (UUID) rs.getObject("id"), (UUID) rs.getObject("company_id"), (UUID) rs.getObject("branch_id"),
            rs.getString("branch_name"), rs.getString("name"), rs.getString("status"),
            rs.getString("created_by_name"), instant(rs.getTimestamp("created_at")),
            rs.getString("revoked_by_name"), instant(rs.getTimestamp("revoked_at")),
            instant(rs.getTimestamp("last_started_at")), rs.getString("last_started_by_name"),
            instant(rs.getTimestamp("last_used_at")), rs.getInt("punches_today"), rs.getInt("waiting"));

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    /** The workspace's stations, or one company's when {@code companyId} is set; active first, then by name. */
    public List<Station> list(UUID companyId) {
        requireReady();
        List<Object> args = new ArrayList<>();
        String where = "";
        if (companyId != null) {
            where = " WHERE s.company_id = ?";
            args.add(companyId);
        }
        return jdbc.query(SELECT + where + " ORDER BY (s.status = 'ACTIVE') DESC, lower(s.name), s.created_at", ROW, args.toArray());
    }

    /** One station, or null. */
    public Station find(UUID id) {
        requireReady();
        if (id == null) return null;
        List<Station> rows = jdbc.query(SELECT + " WHERE s.id = ?", ROW, id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public UUID create(UUID tenantId, UUID companyId, UUID branchId, String name, UUID byUserId, String byName) {
        requireReady();
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO attendance.face_stations (id, tenant_id, company_id, branch_id, name, status, created_by_user_id, created_by_name)
                VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                """, id, tenantId, companyId, branchId, name, byUserId, byName);
        return id;
    }

    /** Revokes an active station; false when it was already revoked (or isn't there). */
    public boolean revoke(UUID id, UUID byUserId, String byName) {
        requireReady();
        return jdbc.update("""
                UPDATE attendance.face_stations
                   SET status = 'REVOKED', revoked_at = now(), revoked_by_user_id = ?, revoked_by_name = ?
                 WHERE id = ? AND status = 'ACTIVE'
                """, byUserId, byName, id) > 0;
    }

    /** How many punches this station has made (ever). */
    public int punchCount(UUID id) {
        requireReady();
        Integer n = jdbc.queryForObject("SELECT count(*) FROM attendance.station_punches WHERE station_id = ?", Integer.class, id);
        return n == null ? 0 : n;
    }

    /** Deletes a station that never punched anyone. */
    public boolean delete(UUID id) {
        requireReady();
        return jdbc.update("DELETE FROM attendance.face_stations s WHERE s.id = ? "
                + "AND NOT EXISTS (SELECT 1 FROM attendance.station_punches p WHERE p.station_id = s.id)", id) > 0;
    }

    public void markStarted(UUID id, String byName) {
        jdbc.update("UPDATE attendance.face_stations SET last_started_at = now(), last_started_by_name = ? WHERE id = ?", byName, id);
    }

    public void markUsed(UUID id) {
        jdbc.update("UPDATE attendance.face_stations SET last_used_at = now() WHERE id = ?", id);
    }

    /** The station's own record of a punch it made (in the punch's transaction). */
    public void recordPunch(UUID tenantId, UUID stationId, UUID attendanceRecordId, UUID employeeId, LocalDate date,
                            String punchType, Instant punchedAt, UUID faceEventId, String scoreBucket, boolean needsApproval) {
        jdbc.update("""
                INSERT INTO attendance.station_punches (id, tenant_id, station_id, attendance_record_id, employee_id, attendance_date,
                    punch_type, punched_at, face_event_id, score_bucket, needs_approval)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), tenantId, stationId, attendanceRecordId, employeeId, date, punchType,
                Timestamp.from(punchedAt), faceEventId, scoreBucket, needsApproval);
    }
}
