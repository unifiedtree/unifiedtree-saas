package com.hrms.api.attendance;

import com.hrms.attendance.service.AttendanceCalendar;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.prefs.NotificationPreferenceService;
import com.unifiedtree.notifications.prefs.NotificationPreferences;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * "Send a reminder" (redesign BW-10, DECISIONS 15): anyone with
 * attendance.team.read reminds people in their team (TeamEmployeeScope) who
 * haven't checked in today. It goes through the existing notification pipeline
 * (CHECKIN_REMINDER, in the app and on the phone, per each person's choices).
 * No new permission and no new table.
 *
 * <p><b>At most once per person, day and reason.</b> A reminder is looked up
 * in two places, both existing tables: the in-app notification it stored
 * (notif.notifications, as the contract says) and the audit event every
 * reminder writes (audit.events), which also covers people who switched the
 * in-app copy off and only get the push. Two senders at once are taken in turn
 * (an advisory lock per person, day and reason), so only one reminder goes out.
 */
@Service
public class AttendanceReminderService {

    private static final Logger log = LoggerFactory.getLogger(AttendanceReminderService.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    public static final String REASON_NOT_CHECKED_IN = "NOT_CHECKED_IN";
    static final Set<String> REASONS = Set.of(REASON_NOT_CHECKED_IN);
    static final String EVENT_KEY = "attendance.checkin_reminder";
    static final int MAX_PEOPLE = 200;

    private final TeamEmployeeScope teamScope;
    private final JdbcTemplate jdbc;
    private final NotificationDispatcher dispatcher;
    private final NotificationPreferenceService preferences;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public AttendanceReminderService(TeamEmployeeScope teamScope, JdbcTemplate jdbc, NotificationDispatcher dispatcher,
                                     NotificationPreferenceService preferences, AuditService audit,
                                     PlatformTransactionManager txManager) {
        this.teamScope = teamScope;
        this.jdbc = jdbc;
        this.dispatcher = dispatcher;
        this.preferences = preferences;
        this.audit = audit;
        this.tx = new TransactionTemplate(txManager);
    }

    public record SendRemindersRequest(LocalDate date, String reason, List<UUID> employeeIds) {
    }

    /** One person's result: SENT now, ALREADY_SENT earlier today, or SKIPPED with a plain reason. */
    public record ReminderResult(UUID employeeId, String outcome, String message) {
    }

    public record SentReminder(UUID employeeId, String reason, Instant sentAt, String sentByName) {
    }

    /** The marker written into each reminder's audit summary, so the throttle can find it. */
    static String marker(LocalDate date, String reason) {
        return "[checkin-reminder " + date + " " + reason + "]";
    }

    public List<ReminderResult> send(SendRemindersRequest req, Jwt jwt) {
        LocalDate today = LocalDate.now(IST);
        String reason = req == null || req.reason() == null ? "" : req.reason().trim();
        if (!REASONS.contains(reason)) {
            throw new HrmsException("Unknown reminder reason.", HttpStatus.BAD_REQUEST, "REMINDER_REASON_INVALID");
        }
        if (req.date() == null || !req.date().equals(today)) {
            throw new HrmsException("Reminders to check in can be sent for today only.", HttpStatus.UNPROCESSABLE_ENTITY,
                    "REMINDER_DATE_NOT_TODAY");
        }
        List<UUID> ids = req.employeeIds() == null ? List.of()
                : req.employeeIds().stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty() || ids.size() > MAX_PEOPLE) {
            throw new HrmsException("Choose between 1 and " + MAX_PEOPLE + " people.", HttpStatus.BAD_REQUEST,
                    "REMINDER_PEOPLE_INVALID");
        }
        UUID tenantId = TenantContext.requireTenantId();
        Set<UUID> team = team(jwt);
        UUID senderEmployee = employeeId(jwt);
        String senderName = tx.execute(s -> nameOf(tenantId, senderEmployee));

        List<ReminderResult> out = new ArrayList<>();
        for (UUID id : ids) {
            if (!team.contains(id)) {
                out.add(new ReminderResult(id, "SKIPPED", "Not in your team."));
                continue;
            }
            try {
                out.add(tx.execute(s -> sendOne(tenantId, id, today, reason, senderEmployee, senderName)));
            } catch (RuntimeException e) {
                log.warn("Check-in reminder to {} failed: {}", id, e.toString());
                out.add(new ReminderResult(id, "SKIPPED", "The reminder could not be sent. Try again."));
            }
        }
        return out;
    }

    private ReminderResult sendOne(UUID tenantId, UUID employeeId, LocalDate day, String reason,
                                   UUID senderEmployee, String senderName) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (ResultSetExtractor<Void>) rs -> null,
                "checkin-reminder:" + tenantId + ":" + employeeId + ":" + day + ":" + reason);

        Map<String, Object> person = jdbc.query("""
                SELECT e.company_id,
                       EXISTS (SELECT 1 FROM auth.user_credentials uc
                                WHERE uc.tenant_id = e.tenant_id AND uc.employee_id = e.id AND uc.is_active = TRUE) AS has_login,
                       EXISTS (SELECT 1 FROM attendance.records r
                                WHERE r.tenant_id = e.tenant_id AND r.employee_id = e.id AND r.attendance_date = ?
                                  AND r.check_in_at IS NOT NULL) AS checked_in,
                       EXISTS (SELECT 1 FROM leave_mgmt.leave_requests l
                                WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'APPROVED'
                                  AND l.start_date <= ? AND l.end_date >= ?) AS on_leave,
                       EXISTS (SELECT 1 FROM settings.holiday_calendar h
                                WHERE h.tenant_id = e.tenant_id AND h.company_id = e.company_id
                                  AND h.holiday_date = ? AND h.is_active = TRUE) AS holiday
                  FROM hrms.employees e
                 WHERE e.id = ? AND e.tenant_id = ?
                """, rs -> rs.next() ? Map.of(
                        "hasLogin", rs.getBoolean("has_login"), "checkedIn", rs.getBoolean("checked_in"),
                        "onLeave", rs.getBoolean("on_leave"), "holiday", rs.getBoolean("holiday")) : null,
                day, day, day, day, employeeId, tenantId);
        if (person == null) return new ReminderResult(employeeId, "SKIPPED", "Not in your team.");
        boolean weeklyOff = AttendanceCalendar.resolveWeeklyOffDays(jdbc, List.of(employeeId), day)
                .getOrDefault(employeeId, AttendanceCalendar.DEFAULT_OFF_DAYS).contains(day.getDayOfWeek().getValue());
        String skip = skipReason((Boolean) person.get("hasLogin"), (Boolean) person.get("checkedIn"),
                (Boolean) person.get("onLeave"), weeklyOff, (Boolean) person.get("holiday"));
        if (skip != null) return new ReminderResult(employeeId, "SKIPPED", skip);

        SentReminder earlier = sentFor(tenantId, List.of(employeeId), day, reason).get(employeeId);
        if (earlier != null) {
            return new ReminderResult(employeeId, "ALREADY_SENT", "Already reminded today"
                    + (earlier.sentByName() != null ? " by " + earlier.sentByName() : "") + ".");
        }
        var def = NotificationEventCatalog.byKey(EVENT_KEY).orElse(null);
        if (def != null && !NotificationPreferences.decide(def, preferences.recipient(tenantId, employeeId).prefs()).any()) {
            return new ReminderResult(employeeId, "SKIPPED", "They have switched these reminders off.");
        }

        Map<String, String> values = new HashMap<>();
        values.put("sentBy", senderName);
        values.put("date", LONG.format(day));
        Map<String, Object> data = new HashMap<>();
        data.put("type", AppNotificationType.CHECKIN_REMINDER.name());
        data.put("reminderDate", day.toString());
        data.put("reason", reason);
        data.put("sentByEmployeeId", senderEmployee.toString());
        data.put("sentByName", senderName);
        data.put("route", "/(tabs)");
        dispatcher.dispatch(tenantId, employeeId, EVENT_KEY, values, data);
        try {
            audit.record("attendance", "CHECKIN_REMINDER", "employee", employeeId,
                    senderName + " reminded " + nameOf(tenantId, employeeId) + " to check in for " + LONG.format(day)
                            + " " + marker(day, reason));
        } catch (Exception e) {
            log.warn("Audit of a check-in reminder failed (non-fatal): {}", e.getMessage());
        }
        return new ReminderResult(employeeId, "SENT", null);
    }

    /**
     * Why a reminder isn't sent to this person, or null to send it: no login to
     * read it, already checked in, on approved leave, or their weekly off or a
     * holiday (they aren't expected in).
     */
    static String skipReason(boolean hasLogin, boolean checkedIn, boolean onLeave, boolean weeklyOff, boolean holiday) {
        if (!hasLogin) return "They don't have a login yet.";
        if (checkedIn) return "Already checked in.";
        if (onLeave) return "On leave today.";
        if (weeklyOff) return "It's their weekly off.";
        if (holiday) return "It's a holiday.";
        return null;
    }

    /** Reminders already sent for the day to people in the caller's team, so "Reminder sent" survives a reload. */
    @Transactional(readOnly = true)
    public List<SentReminder> sent(LocalDate date, Jwt jwt) {
        if (date == null) throw new HrmsException("Choose a day.", HttpStatus.BAD_REQUEST, "REMINDER_DATE_REQUIRED");
        UUID tenantId = TenantContext.requireTenantId();
        Set<UUID> team = team(jwt);
        if (team.isEmpty()) return List.of();
        return new ArrayList<>(sentFor(tenantId, team, date, REASON_NOT_CHECKED_IN).values());
    }

    /** The first reminder for the day and reason per person, from the in-app notifications and the audit log. */
    Map<UUID, SentReminder> sentFor(UUID tenantId, Collection<UUID> employeeIds, LocalDate day, String reason) {
        String ids = employeeIds.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
        Map<UUID, SentReminder> out = new LinkedHashMap<>();
        RowCallbackHandler keepFirst = rs -> {
            UUID id = rs.getObject("employee_id", UUID.class);
            Instant at = rs.getTimestamp("sent_at").toInstant();
            SentReminder seen = out.get(id);
            if (seen == null || at.isBefore(seen.sentAt())) {
                out.put(id, new SentReminder(id, reason, at, rs.getString("sent_by")));
            }
        };
        jdbc.query("""
                SELECT n.user_id AS employee_id, n.created_at AS sent_at, n.data->>'sentByName' AS sent_by
                  FROM notif.notifications n
                 WHERE n.tenant_id = ? AND n.type = 'CHECKIN_REMINDER' AND n.user_id = ANY(CAST(? AS uuid[]))
                   AND n.data->>'reminderDate' = ? AND n.data->>'reason' = ?
                """, keepFirst, tenantId, ids, day.toString(), reason);
        // The audit row exists even when the person gets only the push. It is written on the day, so a
        // window around the day keeps the lookup on the audit table's recent partition.
        Timestamp since = Timestamp.from(day.minusDays(1).atStartOfDay(IST).toInstant());
        jdbc.query("""
                SELECT a.entity_id AS employee_id, a.occurred_at AS sent_at,
                       COALESCE(NULLIF(TRIM(COALESCE(se.first_name, '') || ' ' || COALESCE(se.last_name, '')), ''),
                                uc.display_name) AS sent_by
                  FROM audit.events a
                  LEFT JOIN auth.user_credentials uc ON uc.id = a.actor_user_id AND uc.tenant_id = a.tenant_id
                  LEFT JOIN hrms.employees se ON se.id = uc.employee_id AND se.tenant_id = a.tenant_id
                 WHERE a.tenant_id = ? AND a.module = 'attendance' AND a.action = 'CHECKIN_REMINDER'
                   AND a.entity_type = 'employee' AND a.entity_id = ANY(CAST(? AS uuid[]))
                   AND a.occurred_at >= ? AND strpos(a.summary, ?) > 0
                """, keepFirst, tenantId, ids, since, marker(day, reason));
        return out;
    }

    private Set<UUID> team(Jwt jwt) {
        try {
            return teamScope.resolve(jwt, null).stream().map(Employee::getId).collect(Collectors.toCollection(LinkedHashSet::new));
        } catch (IllegalArgumentException noEmployeeRecord) {
            return Set.of();
        }
    }

    private static UUID employeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    private String nameOf(UUID tenantId, UUID employeeId) {
        List<String> rows = jdbc.queryForList(
                "SELECT NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                String.class, employeeId, tenantId);
        return rows.isEmpty() || rows.get(0) == null ? "Your manager" : rows.get(0);
    }
}
