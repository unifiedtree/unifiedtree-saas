package com.hrms.attendance.policy;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Time;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Reads and saves a company's {@link AttendanceTimingPolicy}.
 *
 * <p>The policy row lives in {@code attendance.timing_policies}; the company
 * grace and the work-week start live in {@code settings.hr_configuration}
 * (the mobile Work Time screen edits the grace there too), so both places are
 * read and the grace is written back to hr_configuration. A company with no
 * policy row gets {@link AttendanceTimingPolicy#defaults}; the GET endpoint
 * stores that row on first read so new workspaces have one.
 */
@Service
public class AttendancePolicyService {

    private final JdbcTemplate jdbc;

    public AttendancePolicyService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** What the settings page shows. */
    public record PolicyView(
            UUID companyId,
            int graceMinutes,
            String defaultStartTime,
            Integer halfDayLateMinutes,
            Double fullDayMinHours,
            Double halfDayMinHours,
            int earlyLeaveMinutes,
            int lateAllowanceCount,
            String lateAllowancePeriod,
            String afterAllowanceAction,
            Instant updatedAt,
            String updatedByName) {}

    /** The editable fields; every field is required on save (null clears an optional rule). */
    public record PolicyUpdate(
            Integer graceMinutes,
            String defaultStartTime,
            Integer halfDayLateMinutes,
            Double fullDayMinHours,
            Double halfDayMinHours,
            Integer earlyLeaveMinutes,
            Integer lateAllowanceCount,
            String lateAllowancePeriod,
            String afterAllowanceAction) {}

    /** The policy the status rules use; defaults when nothing is stored. Never writes. */
    @Transactional(readOnly = true)
    public AttendanceTimingPolicy forCompany(UUID companyId) {
        return forCompanies(List.of(companyId)).get(companyId);
    }

    /** Bulk version for rosters: one query per table. Missing companies get defaults. */
    @Transactional(readOnly = true)
    public Map<UUID, AttendanceTimingPolicy> forCompanies(Collection<UUID> companyIds) {
        Map<UUID, AttendanceTimingPolicy> out = new HashMap<>();
        List<UUID> ids = companyIds == null ? List.of() : companyIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return out;
        for (UUID id : ids) out.put(id, AttendanceTimingPolicy.defaults(id));
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        jdbc.query("SELECT company_id, default_start_time, half_day_late_minutes, full_day_min_hours, half_day_min_hours, "
                        + "early_leave_minutes, late_allowance_count, late_allowance_period, after_allowance_action "
                        + "FROM attendance.timing_policies WHERE company_id IN (" + in + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    UUID cid = (UUID) rs.getObject("company_id");
                    Time start = rs.getTime("default_start_time");
                    int hdl = rs.getInt("half_day_late_minutes");
                    Integer halfDayLate = rs.wasNull() ? null : hdl;
                    double fd = rs.getDouble("full_day_min_hours");
                    Double fullDay = rs.wasNull() ? null : fd;
                    double hd = rs.getDouble("half_day_min_hours");
                    Double halfDay = rs.wasNull() ? null : hd;
                    out.put(cid, new AttendanceTimingPolicy(cid, AttendanceTimingPolicy.DEFAULT_GRACE_MINUTES,
                            start != null ? start.toLocalTime() : null, halfDayLate, fullDay, halfDay,
                            rs.getInt("early_leave_minutes"), rs.getInt("late_allowance_count"),
                            parsePeriod(rs.getString("late_allowance_period")), parseAction(rs.getString("after_allowance_action")),
                            DayOfWeek.MONDAY));
                }, ids.toArray());
        jdbc.query("SELECT company_id, late_grace_minutes, workweek_start_day FROM settings.hr_configuration WHERE company_id IN (" + in + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    UUID cid = (UUID) rs.getObject("company_id");
                    int g = rs.getInt("late_grace_minutes");
                    int grace = rs.wasNull() ? AttendanceTimingPolicy.DEFAULT_GRACE_MINUTES : g;
                    int w = rs.getInt("workweek_start_day");
                    DayOfWeek start = rs.wasNull() || w < 1 || w > 7 ? DayOfWeek.MONDAY : DayOfWeek.of(w);
                    AttendanceTimingPolicy p = out.get(cid);
                    if (p != null) out.put(cid, p.withGraceAndWeekStart(grace, start));
                }, ids.toArray());
        return out;
    }

    /** The settings view; stores the default row the first time a company's policy is read. */
    @Transactional
    public PolicyView getOrCreate(UUID companyId) {
        requireCompany(companyId);
        jdbc.update("INSERT INTO attendance.timing_policies (tenant_id, company_id) VALUES (?, ?) "
                + "ON CONFLICT (tenant_id, company_id) DO NOTHING", TenantContext.getTenantId(), companyId);
        return view(companyId);
    }

    @Transactional
    public PolicyView update(UUID companyId, PolicyUpdate req, UUID actorUserId, String actorName) {
        requireCompany(companyId);
        validate(req);
        LocalTime start = LocalTime.parse(req.defaultStartTime().trim());
        jdbc.update("""
                INSERT INTO attendance.timing_policies (tenant_id, company_id, default_start_time, half_day_late_minutes,
                    full_day_min_hours, half_day_min_hours, early_leave_minutes, late_allowance_count,
                    late_allowance_period, after_allowance_action, updated_by_user_id, updated_by_name, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id, company_id) DO UPDATE SET
                    default_start_time = EXCLUDED.default_start_time,
                    half_day_late_minutes = EXCLUDED.half_day_late_minutes,
                    full_day_min_hours = EXCLUDED.full_day_min_hours,
                    half_day_min_hours = EXCLUDED.half_day_min_hours,
                    early_leave_minutes = EXCLUDED.early_leave_minutes,
                    late_allowance_count = EXCLUDED.late_allowance_count,
                    late_allowance_period = EXCLUDED.late_allowance_period,
                    after_allowance_action = EXCLUDED.after_allowance_action,
                    updated_by_user_id = EXCLUDED.updated_by_user_id,
                    updated_by_name = EXCLUDED.updated_by_name,
                    updated_at = now()
                """,
                TenantContext.getTenantId(), companyId, Time.valueOf(start), req.halfDayLateMinutes(),
                req.fullDayMinHours(), req.halfDayMinHours(), req.earlyLeaveMinutes(), req.lateAllowanceCount(),
                req.lateAllowancePeriod().toUpperCase(), req.afterAllowanceAction().toUpperCase(), actorUserId, actorName);
        // The grace is shared with HR Configuration and the mobile Work Time screen.
        // enable_late_auto_deduction mirrors "late past the allowance is loss of pay".
        boolean lop = "LOSS_OF_PAY".equalsIgnoreCase(req.afterAllowanceAction());
        jdbc.update("""
                INSERT INTO settings.hr_configuration (id, tenant_id, company_id, late_grace_minutes, enable_late_auto_deduction)
                VALUES (gen_random_uuid(), ?, ?, ?, ?)
                ON CONFLICT (tenant_id, company_id) DO UPDATE SET
                    late_grace_minutes = EXCLUDED.late_grace_minutes,
                    enable_late_auto_deduction = EXCLUDED.enable_late_auto_deduction,
                    updated_at = now(),
                    version = settings.hr_configuration.version + 1
                """, TenantContext.getTenantId(), companyId, req.graceMinutes(), lop);
        return view(companyId);
    }

    /** Checks a save request; every message is shown to the person saving. Package-visible for tests. */
    static void validate(PolicyUpdate r) {
        if (r == null) throw new BusinessRuleException("Send the attendance policy to save.", "POLICY_REQUIRED");
        if (r.graceMinutes() == null || r.graceMinutes() < 0 || r.graceMinutes() > 180)
            throw new BusinessRuleException("The grace period must be between 0 and 180 minutes.", "POLICY_GRACE");
        if (r.defaultStartTime() == null || r.defaultStartTime().isBlank())
            throw new BusinessRuleException("Enter the start time for people without a shift.", "POLICY_START");
        try {
            LocalTime.parse(r.defaultStartTime().trim());
        } catch (DateTimeParseException e) {
            throw new BusinessRuleException("The start time must look like 09:30.", "POLICY_START");
        }
        if (r.halfDayLateMinutes() != null) {
            if (r.halfDayLateMinutes() < 1 || r.halfDayLateMinutes() > 720)
                throw new BusinessRuleException("The half-day late limit must be between 1 and 720 minutes.", "POLICY_HALF_DAY_LATE");
            if (r.halfDayLateMinutes() <= r.graceMinutes())
                throw new BusinessRuleException("The half-day late limit must be more than the grace period, or every late arrival would be a half day.", "POLICY_HALF_DAY_LATE");
        }
        if (r.fullDayMinHours() != null && (r.fullDayMinHours() <= 0 || r.fullDayMinHours() > 24))
            throw new BusinessRuleException("Minimum hours for a full day must be more than 0 and at most 24.", "POLICY_FULL_DAY_HOURS");
        if (r.halfDayMinHours() != null && (r.halfDayMinHours() <= 0 || r.halfDayMinHours() > 24))
            throw new BusinessRuleException("Minimum hours for a half day must be more than 0 and at most 24.", "POLICY_HALF_DAY_HOURS");
        if (r.fullDayMinHours() != null && r.halfDayMinHours() != null && r.halfDayMinHours() >= r.fullDayMinHours())
            throw new BusinessRuleException("Minimum hours for a half day must be less than for a full day.", "POLICY_HOURS_ORDER");
        if (r.earlyLeaveMinutes() == null || r.earlyLeaveMinutes() < 0 || r.earlyLeaveMinutes() > 600)
            throw new BusinessRuleException("The early-leave threshold must be between 0 and 600 minutes.", "POLICY_EARLY_LEAVE");
        AttendanceTimingPolicy.AllowancePeriod period;
        try {
            period = AttendanceTimingPolicy.AllowancePeriod.valueOf(String.valueOf(r.lateAllowancePeriod()).toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BusinessRuleException("Choose whether the late allowance is per week or per month.", "POLICY_PERIOD");
        }
        int max = period == AttendanceTimingPolicy.AllowancePeriod.WEEK ? 7 : 31;
        if (r.lateAllowanceCount() == null || r.lateAllowanceCount() < 0 || r.lateAllowanceCount() > max)
            throw new BusinessRuleException("The late allowance must be between 0 and " + max + " per "
                    + period.name().toLowerCase() + ".", "POLICY_ALLOWANCE");
        try {
            AttendanceTimingPolicy.AfterAllowance.valueOf(String.valueOf(r.afterAllowanceAction()).toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BusinessRuleException("Choose what happens after the late allowance is used: keep as late, half day or loss of pay.", "POLICY_ACTION");
        }
    }

    private PolicyView view(UUID companyId) {
        AttendanceTimingPolicy p = forCompany(companyId);
        Object[] meta = jdbc.query("SELECT updated_at, updated_by_name FROM attendance.timing_policies WHERE company_id = ?",
                rs -> rs.next() ? new Object[]{rs.getTimestamp("updated_at"), rs.getString("updated_by_name")} : new Object[]{null, null},
                companyId);
        Timestamp at = meta == null ? null : (Timestamp) meta[0];
        return new PolicyView(companyId, p.graceMinutes(), p.defaultStartTime().toString(), p.halfDayLateMinutes(),
                p.fullDayMinHours(), p.halfDayMinHours(), p.earlyLeaveMinutes(), p.lateAllowanceCount(),
                p.lateAllowancePeriod().name(), p.afterAllowanceAction().name(),
                at != null ? at.toInstant() : null, meta == null ? null : (String) meta[1]);
    }

    private void requireCompany(UUID companyId) {
        if (companyId == null) throw new BusinessRuleException("Choose a company.", "COMPANY_REQUIRED");
        List<Integer> hit = new ArrayList<>(jdbc.query("SELECT 1 FROM org.companies WHERE id = ?", (rs, i) -> 1, companyId));
        if (hit.isEmpty()) throw new ResourceNotFoundException("Company", companyId);
    }

    private static AttendanceTimingPolicy.AllowancePeriod parsePeriod(String s) {
        try { return AttendanceTimingPolicy.AllowancePeriod.valueOf(s); } catch (Exception e) { return AttendanceTimingPolicy.AllowancePeriod.MONTH; }
    }

    private static AttendanceTimingPolicy.AfterAllowance parseAction(String s) {
        try { return AttendanceTimingPolicy.AfterAllowance.valueOf(s); } catch (Exception e) { return AttendanceTimingPolicy.AfterAllowance.KEEP_LATE; }
    }
}
