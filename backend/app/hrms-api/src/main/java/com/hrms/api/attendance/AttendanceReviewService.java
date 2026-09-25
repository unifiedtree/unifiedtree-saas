package com.hrms.api.attendance;

import com.hrms.attendance.policy.AttendancePolicyEvaluator;
import com.hrms.attendance.policy.EffectiveDay;
import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.notifications.events.AttendanceStatusChangedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Attendance review (V143.10): the exceptions list, manual status changes with
 * a reason, the audit trail, and HR decisions on face punches.
 *
 * <p>Who: {@code attendance.status.review} reads the list,
 * {@code attendance.status.override} changes a day. Scope is the My team rule
 * ({@link TeamEmployeeScope}): HR / admin see everyone in the company, a
 * department manager only their team. Nobody changes their own day.
 *
 * <p>Every change writes a row to {@code attendance.day_status_reviews} (who,
 * when, from → to, reason), an audit event, and notifies the employee. A manual
 * status is also written onto the day's attendance record (when it has a
 * check-in) so payroll, which reads that column, counts it.
 */
@Service
public class AttendanceReviewService {

    private static final Logger log = LoggerFactory.getLogger(AttendanceReviewService.class);
    static final int MAX_RANGE_DAYS = 62;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy");

    private final JdbcTemplate jdbc;
    private final EffectiveDayStatusService days;
    private final TeamEmployeeScope teamScope;
    private final EmployeeRepository employees;
    private final WorkforceDepartmentRepository departments;
    private final ApplicationEventPublisher events;
    @Autowired(required = false)
    private AuditService audit;

    public AttendanceReviewService(JdbcTemplate jdbc, EffectiveDayStatusService days, TeamEmployeeScope teamScope,
                                   EmployeeRepository employees, WorkforceDepartmentRepository departments,
                                   ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.days = days;
        this.teamScope = teamScope;
        this.employees = employees;
        this.departments = departments;
        this.events = events;
    }

    /** One card in the review list: an employee-day that needs a look. */
    public record ExceptionItem(
            String id, UUID employeeId, String employeeName, String employeeCode, String departmentName,
            LocalDate date, List<String> flags, String status, String note, Instant checkIn, Instant checkOut,
            Integer lateMinutes, Integer workedMinutes, Integer earlyByMinutes, Integer distanceMeters,
            String shiftName, Instant expectedStart, boolean lossOfPay) {}

    /** One manual change, for the history. */
    public record StatusChange(UUID id, UUID employeeId, LocalDate date, String action, String fromStatus,
                               String toStatus, String reason, String reviewerName, Instant at) {}

    /** A face punch with the HR decision on it. */
    public record FaceEvent(UUID id, UUID employeeId, String employeeName, String employeeCode, String departmentName,
                            String purpose, String result, String scoreBucket, Instant createdAt, LocalDate date,
                            String status, String decision, String decisionNote, String decidedBy, Instant decidedAt) {}

    /** Result of a face decision: the event and the day it belongs to, after the change. */
    public record FaceDecisionResult(FaceEvent event, EffectiveDay day) {}

    // ── the review list ────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<ExceptionItem> exceptions(Jwt jwt, LocalDate from, LocalDate to) {
        LocalDate today = EffectiveDayStatusService.today();
        LocalDate[] range = range(from, to, today.minusDays(6), today);
        List<Employee> team = team(jwt);
        if (team.isEmpty()) return List.of();
        Map<UUID, Employee> byId = team.stream().collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        Map<UUID, String> depts = departmentNames(team);
        Map<UUID, Map<LocalDate, EffectiveDay>> all = days.effectiveStatuses(byId.keySet(), range[0], range[1]);
        List<ExceptionItem> out = new ArrayList<>();
        for (Map.Entry<UUID, Map<LocalDate, EffectiveDay>> e : all.entrySet()) {
            Employee emp = byId.get(e.getKey());
            for (EffectiveDay d : e.getValue().values()) {
                if (d == null || d.manual()) continue;
                List<String> flags = flags(d, today);
                if (flags.isEmpty()) continue;
                out.add(new ExceptionItem(e.getKey() + ":" + d.date(), e.getKey(), name(emp), emp.getEmployeeCode(),
                        emp.getDepartmentId() != null ? depts.get(emp.getDepartmentId()) : null, d.date(), flags,
                        d.status(), d.note(), d.hasPunch() ? d.checkIn() : null, d.hasPunch() ? d.checkOut() : null,
                        d.lateMinutes(), d.workedMinutes(), d.earlyByMinutes(), d.distanceMeters(), d.shiftName(),
                        d.expectedStart(), d.lossOfPay()));
            }
        }
        out.sort(Comparator.comparing(ExceptionItem::date).reversed().thenComparing(i -> Objects.toString(i.employeeName(), "")));
        return out;
    }

    /** What makes a day worth a reviewer's look. Package-visible for tests. */
    static List<String> flags(EffectiveDay d, LocalDate today) {
        List<String> f = new ArrayList<>();
        switch (d.status()) {
            case EffectiveDay.LATE -> f.add("LATE");
            case EffectiveDay.HALF_DAY -> f.add("HALF_DAY");
            case EffectiveDay.ABSENT -> f.add("ABSENT");
            default -> { }
        }
        if (d.earlyLeave()) f.add("EARLY_LEAVE");
        if (d.hasPunch() && d.checkOut() == null && d.date().isBefore(today)) f.add("NO_CHECKOUT");
        if (d.outsideGeofence()) f.add("OUTSIDE_ZONE");
        if (d.punchRejected() && !f.contains("ABSENT")) f.add("FACE_REJECTED");
        return f;
    }

    // ── manual status changes ──────────────────────────────────────────────

    /**
     * Sets, excuses or clears a day's status.
     *
     * @param status PRESENT, LATE, HALF_DAY, ABSENT, EXCUSE (present, with the
     *               lateness / early leave / zone excused) or CLEAR (remove the
     *               manual status; the company rules decide again)
     */
    @Transactional
    public EffectiveDay changeStatus(Jwt jwt, UUID employeeId, LocalDate date, String status, String reason) {
        if (employeeId == null || date == null) throw new BusinessRuleException("Choose the person and the day.", "STATUS_TARGET_REQUIRED");
        String target = status == null ? "" : status.trim().toUpperCase();
        String action = switch (target) {
            case "EXCUSE" -> "EXCUSE";
            case "CLEAR" -> "CLEAR";
            default -> {
                if (!EffectiveDay.isSettable(target))
                    throw new BusinessRuleException("Choose Present, Late, Half day or Absent.", "STATUS_INVALID");
                yield "SET";
            }
        };
        String why = reason == null ? "" : reason.trim();
        if (why.length() < 3) throw new BusinessRuleException("Add a reason (at least 3 characters). The employee will see it.", "STATUS_REASON_REQUIRED");
        if (why.length() > 500) throw new BusinessRuleException("Keep the reason under 500 characters.", "STATUS_REASON_TOO_LONG");
        Employee emp = assertInTeam(jwt, employeeId);
        LocalDate today = EffectiveDayStatusService.today();
        if (date.isAfter(today)) throw new BusinessRuleException("You can't set the status of a day that hasn't happened yet.", "STATUS_FUTURE_DAY");

        EffectiveDay before = days.effectiveStatus(employeeId, date);
        if (before == null) throw new ResourceNotFoundException("Employee", employeeId);
        if (EffectiveDay.NOT_TRACKED.equals(before.status()) && !before.manual())
            throw new BusinessRuleException("This day is before the person's attendance started, or after they left.", "STATUS_NOT_TRACKED");
        if ("CLEAR".equals(action) && !before.manual())
            throw new BusinessRuleException("This day has no manual status to remove.", "STATUS_NOTHING_TO_CLEAR");
        String toStatus = "EXCUSE".equals(action) ? EffectiveDay.PRESENT : "CLEAR".equals(action) ? null : target;
        if ("SET".equals(action) && before.manual() && toStatus.equals(before.status()))
            throw new BusinessRuleException("This day is already set to " + AttendancePolicyEvaluator.label(toStatus) + ".", "STATUS_UNCHANGED");

        Reviewer who = reviewer(jwt);
        UUID rowId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO attendance.day_status_reviews (id, tenant_id, employee_id, company_id, attendance_date, action,
                    from_status, to_status, reason, reviewer_user_id, reviewer_employee_id, reviewer_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, rowId, TenantContext.getTenantId(), employeeId, emp.getCompanyId(), date, action,
                before.status(), toStatus, why, who.userId(), who.employeeId(), who.name());
        EffectiveDay after = days.effectiveStatus(employeeId, date);
        if (toStatus == null) jdbc.update("UPDATE attendance.day_status_reviews SET to_status = ? WHERE id = ?", after.status(), rowId);
        writeRecordStatus(employeeId, date, after, today);
        publish(employeeId, date, action, before.status(), after.status(), why, who.name());
        audit("DAY_STATUS_" + action, employeeId, "%s on %s: %s → %s. Reason: %s".formatted(name(emp), DAY.format(date),
                AttendancePolicyEvaluator.label(before.status()), AttendancePolicyEvaluator.label(after.status()), why));
        return after;
    }

    /** The manual changes on one person's days, newest first. */
    @Transactional(readOnly = true)
    public List<StatusChange> history(Jwt jwt, UUID employeeId, LocalDate from, LocalDate to) {
        assertCanRead(jwt, employeeId);
        LocalDate today = EffectiveDayStatusService.today();
        LocalDate f = from != null ? from : today.minusYears(1), t = to != null ? to : today;
        return jdbc.query("""
                SELECT id, employee_id, attendance_date, action, from_status, to_status, reason, reviewer_name, created_at
                  FROM attendance.day_status_reviews
                 WHERE employee_id = ? AND attendance_date BETWEEN ? AND ?
                 ORDER BY created_at DESC LIMIT 300
                """, (rs, i) -> new StatusChange((UUID) rs.getObject("id"), (UUID) rs.getObject("employee_id"),
                rs.getDate("attendance_date").toLocalDate(), rs.getString("action"), rs.getString("from_status"),
                rs.getString("to_status"), rs.getString("reason"), rs.getString("reviewer_name"),
                rs.getTimestamp("created_at").toInstant()), employeeId, f, t);
    }

    /** One person's effective day (self, or someone in the caller's team). */
    @Transactional(readOnly = true)
    public EffectiveDay day(Jwt jwt, UUID employeeId, LocalDate date) {
        assertCanRead(jwt, employeeId);
        EffectiveDay d = days.effectiveStatus(employeeId, date != null ? date : EffectiveDayStatusService.today());
        if (d == null) throw new ResourceNotFoundException("Employee", employeeId);
        return d;
    }

    // ── face punches ───────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<FaceEvent> faceEvents(Jwt jwt, LocalDate from, LocalDate to) {
        LocalDate today = EffectiveDayStatusService.today();
        LocalDate[] r = range(from, to, today.minusDays(6), today);
        List<Employee> team = team(jwt);
        if (team.isEmpty()) return List.of();
        Set<UUID> ids = team.stream().map(Employee::getId).collect(Collectors.toSet());
        Map<UUID, String> depts = departmentNames(team);
        Map<UUID, Employee> byId = team.stream().collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        Instant start = r[0].atStartOfDay(AttendancePolicyEvaluator.IST).toInstant();
        Instant end = r[1].plusDays(1).atStartOfDay(AttendancePolicyEvaluator.IST).toInstant();
        // Every punch from the last day of the range (the "All punches" list),
        // plus older punches the camera wasn't sure about (the ones to check).
        // Scoped to the caller's team in SQL so a busy company can't push the
        // unsure punches past the row limit.
        Instant lastDay = r[1].atStartOfDay(AttendancePolicyEvaluator.IST).toInstant();
        List<UUID> teamIds = new ArrayList<>(ids);
        String tin = String.join(",", Collections.nCopies(teamIds.size(), "?"));
        List<Object> params = new ArrayList<>(teamIds);
        params.add(Timestamp.from(start));
        params.add(Timestamp.from(end));
        params.add(Timestamp.from(lastDay));
        List<Object[]> rows = new ArrayList<>();
        jdbc.query("""
                SELECT ev.id, ev.purpose, ev.result, ev.score_bucket, ev.created_at, uc.employee_id
                  FROM attendance.face_verification_events ev
                  JOIN auth.user_credentials uc ON uc.id = ev.employee_id
                 WHERE uc.employee_id IN (%s)
                   AND ev.purpose IN ('PUNCH_IN', 'PUNCH_OUT') AND ev.created_at >= ? AND ev.created_at < ?
                   AND (ev.created_at >= ? OR (ev.result = 'PASS' AND ev.score_bucket IN ('LOW', 'MEDIUM')))
                 ORDER BY ev.created_at DESC LIMIT 2000
                """.formatted(tin), (RowCallbackHandler) rs -> rows.add(new Object[]{rs.getObject("id"), rs.getString("purpose"),
                rs.getString("result"), rs.getString("score_bucket"), rs.getTimestamp("created_at").toInstant(),
                rs.getObject("employee_id")}), params.toArray());
        List<Object[]> scoped = rows.stream().filter(o -> o[5] != null && ids.contains((UUID) o[5])).toList();
        Map<UUID, Object[]> decisions = latestDecisions(scoped.stream().map(o -> (UUID) o[0]).toList());
        List<FaceEvent> out = new ArrayList<>();
        for (Object[] o : scoped) {
            Employee emp = byId.get((UUID) o[5]);
            out.add(faceEvent(o, emp, emp.getDepartmentId() != null ? depts.get(emp.getDepartmentId()) : null, decisions.get((UUID) o[0])));
        }
        return out;
    }

    /** "Yes, it's them" (CONFIRMED) or "Not them" (REJECTED — the punch no longer counts). */
    @Transactional
    public FaceDecisionResult decideFace(Jwt jwt, UUID eventId, String decisionIn, String noteIn) {
        String decision = decisionIn == null ? "" : decisionIn.trim().toUpperCase();
        if (!"CONFIRMED".equals(decision) && !"REJECTED".equals(decision))
            throw new BusinessRuleException("Choose whether the face punch is this person or not.", "FACE_DECISION_INVALID");
        String note = noteIn == null ? "" : noteIn.trim();
        if ("REJECTED".equals(decision) && note.length() < 3)
            throw new BusinessRuleException("Say why this isn't them (at least 3 characters). The employee will see it.", "FACE_NOTE_REQUIRED");
        if (note.length() > 500) throw new BusinessRuleException("Keep the note under 500 characters.", "FACE_NOTE_TOO_LONG");
        List<Object[]> found = jdbc.query("""
                SELECT ev.id, ev.purpose, ev.result, ev.score_bucket, ev.created_at, uc.employee_id
                  FROM attendance.face_verification_events ev
                  LEFT JOIN auth.user_credentials uc ON uc.id = ev.employee_id
                 WHERE ev.id = ?
                """, (rs, i) -> new Object[]{rs.getObject("id"), rs.getString("purpose"), rs.getString("result"),
                rs.getString("score_bucket"), rs.getTimestamp("created_at").toInstant(), rs.getObject("employee_id")}, eventId);
        if (found.isEmpty()) throw new ResourceNotFoundException("Face punch", eventId);
        Object[] ev = found.get(0);
        if (!"PASS".equals(ev[2]) || !("PUNCH_IN".equals(ev[1]) || "PUNCH_OUT".equals(ev[1])))
            throw new BusinessRuleException("Only face punches the camera accepted can be checked.", "FACE_NOT_REVIEWABLE");
        if (ev[5] == null) throw new BusinessRuleException("This face punch isn't linked to an employee record.", "FACE_NO_EMPLOYEE");
        UUID employeeId = (UUID) ev[5];
        Employee emp = assertInTeam(jwt, employeeId);
        LocalDate date = ((Instant) ev[4]).atZone(AttendancePolicyEvaluator.IST).toLocalDate();
        LocalDate today = EffectiveDayStatusService.today();
        EffectiveDay before = days.effectiveStatus(employeeId, date);
        Reviewer who = reviewer(jwt);
        jdbc.update("""
                INSERT INTO attendance.face_event_reviews (tenant_id, event_id, employee_id, attendance_date, decision, note,
                    reviewer_user_id, reviewer_employee_id, reviewer_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, TenantContext.getTenantId(), eventId, employeeId, date, decision, note.isEmpty() ? null : note,
                who.userId(), who.employeeId(), who.name());
        EffectiveDay after = days.effectiveStatus(employeeId, date);
        String action = "REJECTED".equals(decision) ? "FACE_REJECT" : "FACE_CONFIRM";
        String reason = !note.isEmpty() ? note : "Confirmed the face punch is " + name(emp) + ".";
        jdbc.update("""
                INSERT INTO attendance.day_status_reviews (tenant_id, employee_id, company_id, attendance_date, action,
                    from_status, to_status, reason, face_event_id, reviewer_user_id, reviewer_employee_id, reviewer_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, TenantContext.getTenantId(), employeeId, emp.getCompanyId(), date, action,
                before != null ? before.status() : null, after != null ? after.status() : null, reason, eventId,
                who.userId(), who.employeeId(), who.name());
        boolean wasRejected = before != null && before.punchRejected();
        if (after != null && ("FACE_REJECT".equals(action) || wasRejected)) writeRecordStatus(employeeId, date, after, today);
        if (after != null && (before == null || !Objects.equals(before.status(), after.status()) || "FACE_REJECT".equals(action)))
            publish(employeeId, date, action, before != null ? before.status() : null, after.status(), note.isEmpty() ? null : note, who.name());
        audit("FACE_PUNCH_" + decision, employeeId, "%s face punch on %s %s by %s%s".formatted(name(emp), DAY.format(date),
                "REJECTED".equals(decision) ? "rejected" : "confirmed", who.name(), note.isEmpty() ? "" : ". Note: " + note));
        Map<UUID, Object[]> dec = latestDecisions(List.of(eventId));
        String dept = emp.getDepartmentId() != null ? departmentNames(List.of(emp)).get(emp.getDepartmentId()) : null;
        return new FaceDecisionResult(faceEvent(ev, emp, dept, dec.get(eventId)), after);
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /** Records the manual / face result on the day's record so payroll (which reads it) counts it. */
    private void writeRecordStatus(UUID employeeId, LocalDate date, EffectiveDay after, LocalDate today) {
        String recordStatus = recordStatusFor(after, date, today);
        jdbc.update("UPDATE attendance.records SET attendance_status = ?, updated_at = now(), version = version + 1 "
                + "WHERE employee_id = ? AND attendance_date = ? AND check_in_at IS NOT NULL", recordStatus, employeeId, date);
    }

    /**
     * The attendance_status to store on the day's record: the manual status, or
     * ABSENT / NOT_MARKED when HR rejected the face punch, or the punch's own
     * LATE / ON_TIME when neither applies (a manual status was removed).
     */
    static String recordStatusFor(EffectiveDay after, LocalDate date, LocalDate today) {
        if (after.manual()) return after.status();
        if (after.punchRejected()) return date.isBefore(today) ? "ABSENT" : "NOT_MARKED";
        return after.lateMinutes() != null ? "LATE" : "ON_TIME";
    }

    /** Marks an accepted check-in that was outside the attendance zone (geofence not enforced for the company). */
    @Transactional
    public void flagOutsideGeofence(UUID recordId, LocalDate date, Double distanceMeters) {
        if (recordId == null || date == null) return;
        jdbc.update("UPDATE attendance.records SET check_in_outside_geofence = TRUE, check_in_distance_m = ? WHERE id = ? AND attendance_date = ?",
                distanceMeters != null ? (int) Math.round(distanceMeters) : null, recordId, date);
    }

    private Map<UUID, Object[]> latestDecisions(List<UUID> eventIds) {
        Map<UUID, Object[]> out = new HashMap<>();
        if (eventIds.isEmpty()) return out;
        String in = String.join(",", Collections.nCopies(eventIds.size(), "?"));
        jdbc.query("SELECT DISTINCT ON (event_id) event_id, decision, note, reviewer_name, created_at FROM attendance.face_event_reviews "
                        + "WHERE event_id IN (" + in + ") ORDER BY event_id, created_at DESC",
                (RowCallbackHandler) rs -> out.put((UUID) rs.getObject("event_id"), new Object[]{rs.getString("decision"),
                        rs.getString("note"), rs.getString("reviewer_name"), rs.getTimestamp("created_at").toInstant()}),
                eventIds.toArray());
        return out;
    }

    private FaceEvent faceEvent(Object[] o, Employee emp, String dept, Object[] decision) {
        String result = (String) o[2], bucket = (String) o[3];
        Instant at = (Instant) o[4];
        String status = faceStatus(result, bucket, decision != null ? (String) decision[0] : null);
        return new FaceEvent((UUID) o[0], emp.getId(), name(emp), emp.getEmployeeCode(), dept, (String) o[1], result, bucket,
                at, at.atZone(AttendancePolicyEvaluator.IST).toLocalDate(), status,
                decision != null ? (String) decision[0] : null, decision != null ? (String) decision[1] : null,
                decision != null ? (String) decision[2] : null, decision != null ? (Instant) decision[3] : null);
    }

    /** OK / REVIEW (medium or low match, nobody checked) / CONFIRMED / FLAGGED / FAILED. Package-visible for tests. */
    static String faceStatus(String result, String bucket, String decision) {
        if (!"PASS".equals(result)) return "FAILED";
        if ("CONFIRMED".equals(decision)) return "CONFIRMED";
        if ("REJECTED".equals(decision)) return "FLAGGED";
        return "LOW".equals(bucket) || "MEDIUM".equals(bucket) ? "REVIEW" : "OK";
    }

    private void publish(UUID employeeId, LocalDate date, String kind, String from, String to, String reason, String by) {
        try {
            events.publishEvent(new AttendanceStatusChangedEvent(TenantContext.getTenantId(), employeeId, date, kind, from, to, reason, by));
        } catch (Exception ex) {
            log.warn("Could not publish AttendanceStatusChangedEvent for {} on {}: {}", employeeId, date, ex.getMessage());
        }
    }

    private void audit(String action, UUID employeeId, String summary) {
        if (audit == null) return;
        try {
            audit.record("attendance", action, "employee", employeeId, summary);
        } catch (Exception ex) {
            log.warn("Audit write failed for {}: {}", action, ex.getMessage());
        }
    }

    private List<Employee> team(Jwt jwt) {
        try {
            return teamScope.resolve(jwt, null);
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
    }

    private Employee assertInTeam(Jwt jwt, UUID employeeId) {
        UUID self = callerEmployeeId(jwt);
        if (employeeId.equals(self))
            throw new AccessDeniedException("You can't change your own attendance. Ask HR or your manager.");
        return team(jwt).stream().filter(e -> e.getId().equals(employeeId)).findFirst()
                .orElseThrow(() -> new AccessDeniedException("This person isn't in your team, so you can't change their attendance."));
    }

    private void assertCanRead(Jwt jwt, UUID employeeId) {
        if (employeeId == null) throw new BusinessRuleException("Choose a person.", "EMPLOYEE_REQUIRED");
        if (employeeId.equals(callerEmployeeId(jwt))) return;
        boolean inTeam = team(jwt).stream().anyMatch(e -> e.getId().equals(employeeId));
        if (!inTeam) throw new AccessDeniedException("You can see only your own attendance and your team's.");
    }

    static UUID callerEmployeeId(Jwt jwt) {
        String e = jwt.getClaimAsString("employee_id");
        return UUID.fromString(e != null ? e : jwt.getSubject());
    }

    private record Reviewer(UUID userId, UUID employeeId, String name) {}

    private Reviewer reviewer(Jwt jwt) {
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        UUID empId = null;
        String name = null;
        try {
            empId = callerEmployeeId(jwt);
            name = employees.findById(empId).map(AttendanceReviewService::name).orElse(null);
        } catch (Exception ignored) { /* no employee record */ }
        if (name == null || name.isBlank()) name = jwt.getClaimAsString("email");
        return new Reviewer(userId, empId, name);
    }

    private Map<UUID, String> departmentNames(List<Employee> list) {
        List<UUID> ids = list.stream().map(Employee::getDepartmentId).filter(Objects::nonNull).distinct().toList();
        Map<UUID, String> names = new HashMap<>();
        if (!ids.isEmpty()) departments.findAllById(ids).forEach(d -> names.put(d.getId(), d.getName()));
        return names;
    }

    static String name(Employee e) {
        return e == null ? null : AttendanceController.joinName(e.getFirstName(), e.getLastName());
    }

    /** [from, to] with defaults, swapped when reversed, clamped to {@link #MAX_RANGE_DAYS} and to today. */
    static LocalDate[] range(LocalDate from, LocalDate to, LocalDate defFrom, LocalDate today) {
        LocalDate f = from != null ? from : defFrom, t = to != null ? to : today;
        if (t.isAfter(today)) t = today;
        if (f.isAfter(t)) { LocalDate s = f; f = t; t = s; }
        if (f.isBefore(t.minusDays(MAX_RANGE_DAYS - 1L))) f = t.minusDays(MAX_RANGE_DAYS - 1L);
        return new LocalDate[]{f, t};
    }
}
