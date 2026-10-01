package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.policy.EffectiveDay;
import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.SelfPunchRules;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

/**
 * A person's own day, for "Your day" on Home (V143.53 redesign):
 * <ul>
 *   <li>{@link #myDay} (BW-27): today's record, the day's status and shift, the
 *       worked time so far, breaks, and what the person may do from the web;</li>
 *   <li>{@link #startBreak} / {@link #endBreak} (BW-26): breaks only pause the
 *       timer; worked hours, overtime and pay are unchanged;</li>
 *   <li>{@link #undoCheckOut} (BW-25): take back one's own check-out within 10
 *       minutes.</li>
 * </ul>
 * Starting a break and undoing a check-out are web actions, so they need the
 * company's "Allow web check-in" on (off by default). Ending a break never does:
 * a break someone is on can always be ended.
 */
@Service
public class SelfDayService {

    private static final Logger log = LoggerFactory.getLogger(SelfDayService.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("HH:mm").withZone(IST);

    private final AttendanceService attendance;
    private final PunchRulesService punchRules;
    private final AttendanceContextResolver contexts;
    @Autowired(required = false)
    private EffectiveDayStatusService days;
    @Autowired(required = false)
    private AuditService audit;

    public SelfDayService(AttendanceService attendance, PunchRulesService punchRules, AttendanceContextResolver contexts) {
        this.attendance = attendance;
        this.punchRules = punchRules;
        this.contexts = contexts;
    }

    /** The shift in force on the day. {@code start}/{@code end} are IST "HH:mm". */
    public record Shift(String name, String start, String end, Integer graceMinutes, Double workingHours,
                        Instant expectedStart, Instant expectedEnd) {}

    /**
     * "Your day". {@code record} is today's attendance record (or yesterday's while
     * a night shift is still open), in the shape /today returns. {@code status}
     * is the day's effective status (PRESENT, LATE, HALF_DAY, ABSENT, NOT_MARKED,
     * ON_LEAVE, HOLIDAY, WEEKLY_OFF, NOT_TRACKED). {@code workedMinutes} runs from
     * check-in to check-out (or to now); {@code activeMinutes} is that less the
     * breaks, the number "Your day" shows. Breaks never change stored hours.
     */
    public record MyDay(LocalDate date, AttendanceDto record, String status, String statusNote, Shift shift,
                        boolean checkedIn, boolean checkedOut, Integer workedMinutes, Integer activeMinutes,
                        boolean onBreak, Instant breakStartedAt, int breakMinutes, List<SelfPunchRules.BreakSpan> breaks,
                        boolean webPunchAllowed, boolean canUndoCheckOut, Instant undoCheckOutUntil) {}

    /** The day's breaks after a start or an end. */
    public record Breaks(boolean onBreak, Instant breakStartedAt, int breakMinutes, List<SelfPunchRules.BreakSpan> breaks) {
        static Breaks of(SelfPunchRules.BreakState s) {
            return new Breaks(s.onBreak(), s.openSince(), s.breakMinutes(), s.breaks());
        }
    }

    public MyDay myDay(UUID employeeId, Instant now) {
        UUID companyId = companyOf(employeeId);
        LocalDate today = now.atZone(IST).toLocalDate();
        AttendanceRecord rec = attendance.openRecord(employeeId, now)
                .orElseGet(() -> attendance.recordOn(employeeId, today).orElse(null));
        LocalDate date = rec != null ? rec.getAttendanceDate() : today;
        EffectiveDay day = days != null ? days.effectiveStatus(employeeId, date) : null;

        boolean in = rec != null && rec.getCheckInAt() != null;
        boolean out = in && rec.getCheckOutAt() != null;
        Integer worked = in ? minutesBetween(rec.getCheckInAt(), out ? rec.getCheckOutAt() : now) : null;
        SelfPunchRules.BreakState breaks = in ? attendance.breakState(rec, out ? rec.getCheckOutAt() : now)
                : SelfPunchRules.BreakState.NONE;
        Integer active = worked == null ? null : Math.max(0, worked - breaks.breakMinutes());

        boolean web = punchRules.webPunchAllowed(companyId) && punchRules.webMethodStorable();
        boolean canUndo = web && out && attendance.checkOutUndoable(rec, now);
        return new MyDay(date, attendance.toAttendanceDto(rec),
                day != null ? day.status() : null, day != null ? day.note() : null,
                shiftOf(employeeId, date, day),
                in, out, worked, active,
                breaks.onBreak(), breaks.openSince(), breaks.breakMinutes(), breaks.breaks(),
                web, canUndo, canUndo ? SelfPunchRules.undoUntil(rec) : null);
    }

    public Breaks startBreak(UUID employeeId, Instant now) {
        requireWeb(companyOf(employeeId), "Breaks are recorded from the web only where web check-in is switched on.");
        return Breaks.of(attendance.startBreak(employeeId, now));
    }

    public Breaks endBreak(UUID employeeId, Instant now) {
        return Breaks.of(attendance.endBreak(employeeId, now));
    }

    public AttendanceDto undoCheckOut(UUID employeeId, Instant now) {
        requireWeb(companyOf(employeeId), "Undo check-out is available only where web check-in is switched on.");
        AttendanceDto after = attendance.undoOwnCheckOut(employeeId, now);
        if (audit != null) {
            try {
                audit.record("attendance", "CHECKOUT_UNDONE", "employee", employeeId,
                        "The employee took back their own check-out on " + after.attendanceDate() + ", within 10 minutes.");
            } catch (RuntimeException e) {
                log.warn("Audit write failed for an undone check-out: {}", e.getMessage());
            }
        }
        return after;
    }

    /** Minutes from {@code from} to {@code to}, never negative. */
    static int minutesBetween(Instant from, Instant to) {
        if (from == null || to == null || to.isBefore(from)) return 0;
        return (int) Duration.between(from, to).toMinutes();
    }

    private Shift shiftOf(UUID employeeId, LocalDate date, EffectiveDay day) {
        if (day == null || day.shiftName() == null) return null;
        AttendanceService.ShiftProfile profile = attendance.getShiftProfile(employeeId, date);
        return new Shift(day.shiftName(),
                day.expectedStart() != null ? HHMM.format(day.expectedStart()) : null,
                day.expectedEnd() != null ? HHMM.format(day.expectedEnd()) : null,
                day.graceMinutes(),
                profile != null ? profile.dailyTargetHours() : null,
                day.expectedStart(), day.expectedEnd());
    }

    private void requireWeb(UUID companyId, String message) {
        if (!punchRules.webPunchAllowed(companyId)) {
            throw new BusinessRuleException(message, PunchRulesService.WEB_PUNCH_NOT_ALLOWED);
        }
    }

    private UUID companyOf(UUID employeeId) {
        try {
            return contexts.resolve(employeeId).companyId();
        } catch (IllegalArgumentException noEmployeeRecord) {
            throw new ResourceNotFoundException("Employee", employeeId);
        }
    }
}
