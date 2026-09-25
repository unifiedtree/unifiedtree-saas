package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.dto.ShiftDtos.EmployeeShiftResponse;
import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyResponse;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.enums.ShiftType;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Shift-definition management + per-employee shift assignment
 * (attendance.shift_policies + attendance.employee_shift_assignments).
 *
 * <p>Definitions are per-company. The first time a company's shift list is
 * requested and none exist, a sensible default set (General / Morning /
 * Afternoon / Night) is seeded so onboarding has something to pick immediately —
 * this avoids a DB migration on a Flyway-disabled deployment.
 *
 * <p>Assignment is open-ended: the current shift is the row with
 * {@code effective_to IS NULL}. Reassigning closes the previous row and opens a
 * new one, preserving history — which also lets attendance late-calc pick the
 * shift that was in force on any given date.
 */
@Service
public class EmployeeShiftService {

    private static final Logger log = LoggerFactory.getLogger(EmployeeShiftService.class);

    private final ShiftPolicyRepository policyRepo;
    private final EmployeeShiftAssignmentRepository assignmentRepo;

    public EmployeeShiftService(ShiftPolicyRepository policyRepo,
                                EmployeeShiftAssignmentRepository assignmentRepo) {
        this.policyRepo = policyRepo;
        this.assignmentRepo = assignmentRepo;
    }

    // ── Shift definitions ────────────────────────────────────────────────────

    @Transactional
    public List<ShiftPolicyResponse> listShifts(UUID companyId) {
        if (companyId == null) {
            throw new BusinessRuleException("companyId is required", "COMPANY_REQUIRED");
        }
        List<ShiftPolicy> policies = policyRepo.findByCompanyIdAndActiveTrue(companyId);
        // The standard shifts are seeded once, for a company that has never had
        // any. Seeding whenever a default name was missing from the ACTIVE list
        // brought back every default an admin archived or renamed, on the next
        // read by anyone.
        if (policies.isEmpty() && policyRepo.countByCompanyId(companyId) == 0) {
            if (seedMissingDefaults(companyId, policies)) {
                policies = policyRepo.findByCompanyIdAndActiveTrue(companyId);
            }
        } else if (addGeneralForLegacyOnly(companyId)) {
            policies = policyRepo.findByCompanyIdAndActiveTrue(companyId);
        }
        return policies.stream()
                .sorted((a, b) -> nullsafe(a.getStartTime()).compareTo(nullsafe(b.getStartTime())))
                .map(EmployeeShiftService::toPolicyResponse)
                .toList();
    }

    @Transactional
    public ShiftPolicyResponse createShift(UUID companyId, ShiftPolicyRequest req) {
        if (companyId == null) {
            throw new BusinessRuleException("companyId is required", "COMPANY_REQUIRED");
        }
        if (req.name() == null || req.name().isBlank()) {
            throw new BusinessRuleException("Shift name is required", "SHIFT_NAME_REQUIRED");
        }
        validateShiftWindow(req.shiftType(), req.startTime(), req.endTime());
        ShiftPolicy p = new ShiftPolicy();
        p.setCompanyId(companyId);
        apply(p, req);
        applyRules(p, req);
        p.setActive(true);
        return toPolicyResponse(policyRepo.save(p));
    }

    @Transactional
    public ShiftPolicyResponse updateShift(UUID shiftId, ShiftPolicyRequest req) {
        ShiftPolicy p = policyRepo.findById(shiftId)
                .orElseThrow(() -> new ResourceNotFoundException("ShiftPolicy", shiftId));
        // Cross-field validation runs against the effective (post-merge) window,
        // so a caller who only PATCHes the endTime is still checked against the
        // stored startTime — matching what actually lands in the DB.
        LocalTime start = req.startTime() != null ? req.startTime() : p.getStartTime();
        LocalTime end   = req.endTime()   != null ? req.endTime()   : p.getEndTime();
        ShiftType type  = req.shiftType() != null ? req.shiftType() : p.getShiftType();
        validateShiftWindow(type, start, end);
        apply(p, req);
        applyRules(p, req);
        return toPolicyResponse(policyRepo.save(p));
    }

    /**
     * Soft-delete a shift definition. Refuses (409 SHIFT_IN_USE) when at least
     * one employee still has an open-ended assignment to it — reassign them
     * first, otherwise the late-mark logic loses its shift window mid-day and
     * every subsequent punch downgrades to "no shift assigned". Idempotent for
     * already-inactive shifts.
     */
    @Transactional
    public void deleteShift(UUID shiftId) {
        ShiftPolicy p = policyRepo.findById(shiftId)
                .orElseThrow(() -> new ResourceNotFoundException("ShiftPolicy", shiftId));
        long inUse = assignmentRepo.countByShiftPolicyIdAndEffectiveToIsNull(shiftId);
        if (inUse > 0) {
            // 409 CONFLICT — the resource can't be deleted in its current state.
            // BusinessRuleException maps to 422 which UI treats as validation;
            // we want the delete button to render a "reassign first" prompt.
            throw new HrmsException(
                    "Shift has " + inUse + " active assignment(s); reassign employees before deleting.",
                    HttpStatus.CONFLICT, "SHIFT_IN_USE");
        }
        if (p.isActive()) {
            p.setActive(false);
            policyRepo.save(p);
            log.info("Soft-deleted shift policy {} ({})", p.getId(), p.getName());
        }
    }

    /**
     * Reject nonsensical windows. FIXED shifts must have endTime strictly after
     * startTime; NIGHT is allowed to wrap past midnight (start > end); either
     * type still rejects start == end since a zero-length window makes the late-
     * mark math divide by zero. FLEXIBLE / ROTATIONAL are permissive — start/end
     * are informational and the enforcement lives elsewhere.
     */
    private static void validateShiftWindow(ShiftType type, LocalTime start, LocalTime end) {
        if (type == null || start == null || end == null) {
            return; // partial payload — the null-guarded @Column defaults will fill in
        }
        if (start.equals(end)) {
            throw new BusinessRuleException(
                    "Shift start and end time must differ.", "SHIFT_WINDOW_ZERO_LENGTH");
        }
        if (type == ShiftType.FIXED && !end.isAfter(start)) {
            throw new BusinessRuleException(
                    "FIXED shift endTime must be after startTime (use NIGHT for wrap-past-midnight).",
                    "SHIFT_WINDOW_INVALID");
        }
        // NIGHT: end < start is expected (22:00 → 06:00). No further check.
    }

    // ── Assignment ───────────────────────────────────────────────────────────

    /** Assign (or reassign) {@code employeeId} to a shift. Closes any open assignment first. */
    @Transactional
    public EmployeeShiftResponse assignShift(UUID employeeId, AssignShiftRequest req) {
        if (employeeId == null || req.shiftPolicyId() == null) {
            throw new BusinessRuleException("employeeId and shiftPolicyId are required", "SHIFT_ASSIGN_INVALID");
        }
        ShiftPolicy policy = policyRepo.findById(req.shiftPolicyId())
                .orElseThrow(() -> new ResourceNotFoundException("ShiftPolicy", req.shiftPolicyId()));

        if (!policy.isActive()) throw new BusinessRuleException("Choose an active shift", "SHIFT_INACTIVE");
        LocalDate from = req.effectiveFrom() != null ? req.effectiveFrom() : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        String note = assignmentNote(req.note());

        // Close any currently-open assignment(s) the day before the new one starts.
        List<EmployeeShiftAssignment> open = assignmentRepo.findByEmployeeIdAndEffectiveToIsNull(employeeId);
        for (EmployeeShiftAssignment a : open) {
            if (from.isBefore(a.getEffectiveFrom())) {
                throw new BusinessRuleException("New assignment cannot precede the current assignment", "SHIFT_DATE_INVALID");
            }
            if (a.getShiftPolicyId().equals(policy.getId())) {
                // Already on this shift — no-op, return the existing one.
                return toEmployeeResponse(employeeId, a, policy);
            }
            if (from.equals(a.getEffectiveFrom())) {
                // Daily assignments have one effective policy per day. Replacing
                // today's choice must not create a period ending before it starts.
                a.setShiftPolicyId(policy.getId());
                a.setNote(note);
                return toEmployeeResponse(employeeId, assignmentRepo.save(a), policy);
            }
            a.setEffectiveTo(from.minusDays(1));
        }
        if (!open.isEmpty()) assignmentRepo.saveAll(open);

        EmployeeShiftAssignment fresh = new EmployeeShiftAssignment();
        fresh.setEmployeeId(employeeId);
        fresh.setShiftPolicyId(policy.getId());
        fresh.setEffectiveFrom(from);
        fresh.setEffectiveTo(null);
        fresh.setNote(note);
        EmployeeShiftAssignment saved = assignmentRepo.save(fresh);
        log.info("Assigned employee {} to shift {} ({}) from {}", employeeId, policy.getId(), policy.getName(), from);
        return toEmployeeResponse(employeeId, saved, policy);
    }

    @Transactional(readOnly = true)
    public EmployeeShiftResponse getCurrentShift(UUID employeeId) {
        LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        // "In force today", not "open": assignShift closes the old row the day
        // before a future-dated change starts, so the only OPEN row can be one
        // that has not begun yet. Reporting that as current made the profile,
        // roster and change-request baseline jump to the new shift the moment
        // HR scheduled it — the schedule SQL, which is date-aware, disagreed.
        EmployeeShiftAssignment inForce = assignmentRepo.findEffectiveOn(employeeId, today)
                .stream().findFirst().orElse(null);
        EmployeeShiftAssignment upcoming = assignmentRepo
                .findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(employeeId, today)
                .orElse(null);
        ShiftPolicy upcomingPolicy = upcoming == null ? null
                : policyRepo.findById(upcoming.getShiftPolicyId()).orElse(null);
        if (inForce == null) {
            return new EmployeeShiftResponse(employeeId, null, null, null, null, null, 0, null, null,
                    upcoming == null ? null : upcoming.getShiftPolicyId(),
                    upcomingPolicy == null ? null : upcomingPolicy.getName(),
                    upcoming == null ? null : upcoming.getEffectiveFrom());
        }
        ShiftPolicy policy = policyRepo.findById(inForce.getShiftPolicyId()).orElse(null);
        return toEmployeeResponse(employeeId, inForce, policy, upcoming, upcomingPolicy);
    }

    /** The shift policy in force for {@code employeeId} on {@code date}, or null when none is. */
    @Transactional(readOnly = true)
    public UUID shiftPolicyIdOn(UUID employeeId, LocalDate date) {
        return assignmentRepo.findEffectiveOn(employeeId, date).stream()
                .findFirst()
                .map(EmployeeShiftAssignment::getShiftPolicyId)
                .orElse(null);
    }

    /**
     * Start date of the first assignment beginning after {@code date}, or null.
     * {@link #assignShift} cannot place a new assignment before one of these
     * (SHIFT_DATE_INVALID), so callers that take a date from a person check
     * this first and can say which date is blocking.
     */
    @Transactional(readOnly = true)
    public LocalDate nextAssignmentStartAfter(UUID employeeId, LocalDate date) {
        return assignmentRepo.findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(employeeId, date)
                .map(EmployeeShiftAssignment::getEffectiveFrom)
                .orElse(null);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Longest note kept with an assignment (column width, V143.25). */
    static final int NOTE_MAX = 500;

    /**
     * The note to keep with an assignment: trimmed, line breaks and other
     * control characters turned into spaces, cut to {@value #NOTE_MAX}
     * characters. Null when blank.
     */
    static String assignmentNote(String raw) {
        if (raw == null) return null;
        String s = raw.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
        if (s.isEmpty()) return null;
        return s.length() > NOTE_MAX ? s.substring(0, NOTE_MAX) : s;
    }

    /**
     * Add any missing standard shifts (case-insensitive by name). Returns true
     * if at least one was created. 9-5 General is the client-chosen default;
     * admin can edit it (or add more) from Settings → Shift Timings.
     */
    private boolean seedMissingDefaults(UUID companyId, List<ShiftPolicy> existing) {
        Set<String> have = existing.stream()
                .map(sp -> sp.getName() == null ? "" : sp.getName().trim().toLowerCase())
                .collect(Collectors.toSet());
        boolean added = false;
        if (!have.contains("general")) {
            create(companyId, "General", ShiftType.FIXED, LocalTime.of(9, 0), LocalTime.of(17, 0), 15);
            added = true;
        }
        if (!have.contains("morning")) {
            create(companyId, "Morning", ShiftType.FIXED, LocalTime.of(6, 0), LocalTime.of(14, 0), 15);
            added = true;
        }
        if (!have.contains("afternoon")) {
            create(companyId, "Afternoon", ShiftType.FIXED, LocalTime.of(14, 0), LocalTime.of(22, 0), 15);
            added = true;
        }
        if (!have.contains("night")) {
            create(companyId, "Night", ShiftType.NIGHT, LocalTime.of(22, 0), LocalTime.of(6, 0), 15);
            added = true;
        }
        if (added) {
            log.info("Seeded missing default shift policies for company {}", companyId);
        }
        return added;
    }

    /**
     * A company whose only shift was the signup "Standard 9-6" (every shift it
     * ever had is named that) gets the standard "General" shift once, so the
     * shift pickers offer it. V143.23 does the same for existing companies;
     * this covers workspaces created after it. Returns true when added.
     */
    boolean addGeneralForLegacyOnly(UUID companyId) {
        List<ShiftPolicy> all = policyRepo.findByCompanyId(companyId);
        if (all.isEmpty()) return false;
        boolean onlyLegacy = all.stream().allMatch(sp -> sp.getName() != null
                && LEGACY_SIGNUP_SHIFT.equals(sp.getName().trim().toLowerCase(java.util.Locale.ROOT)));
        if (!onlyLegacy) return false;
        ShiftPolicy general = create(companyId, "General", ShiftType.FIXED, LocalTime.of(9, 0), LocalTime.of(17, 0), 15);
        boolean codeFree = all.stream().noneMatch(sp -> sp.isActive() && "GEN".equalsIgnoreCase(sp.getCode()));
        if (codeFree && general != null) {
            general.setCode("GEN");
            policyRepo.save(general);
        }
        log.info("Added the General shift for company {} (it only had the signup Standard 9-6 shift)", companyId);
        return true;
    }

    static final String LEGACY_SIGNUP_SHIFT = "standard 9-6";

    // ── V143.23: code, core hours, weekly offs ───────────────────────────────

    private static final java.util.regex.Pattern CODE = java.util.regex.Pattern.compile("^[A-Z0-9_-]{1,20}$");

    /**
     * Code, core hours and weekly offs. Each is optional (null = keep); the
     * checks run on the values the shift will end up with.
     */
    void applyRules(ShiftPolicy p, ShiftPolicyRequest req) {
        if (req.code() != null) {
            String code = req.code().trim().toUpperCase(java.util.Locale.ROOT);
            if (code.isEmpty()) {
                p.setCode(null);
            } else {
                if (!CODE.matcher(code).matches()) {
                    throw new BusinessRuleException(
                            "Use up to 20 letters, digits, - or _ for the shift code.", "SHIFT_CODE_INVALID");
                }
                boolean taken = p.getCompanyId() != null && policyRepo.findByCompanyIdAndActiveTrue(p.getCompanyId()).stream()
                        .anyMatch(o -> !java.util.Objects.equals(o.getId(), p.getId()) && code.equalsIgnoreCase(o.getCode()));
                if (taken) {
                    throw new HrmsException("Another shift already uses the code " + code + ".",
                            HttpStatus.CONFLICT, "SHIFT_CODE_DUPLICATE");
                }
                p.setCode(code);
            }
        }
        if (req.weeklyOffDays() != null) {
            p.setWeeklyOffDays(weeklyOffCsv(req.weeklyOffDays()));
        }
        if (req.coreStartTime() != null || req.coreEndTime() != null) {
            if (req.coreStartTime() == null || req.coreEndTime() == null) {
                throw new BusinessRuleException("Give both the start and the end of the core hours.", "SHIFT_CORE_INCOMPLETE");
            }
            p.setCoreStartTime(req.coreStartTime());
            p.setCoreEndTime(req.coreEndTime());
        }
        if (p.getShiftType() != ShiftType.FLEXIBLE) {
            // Core hours only mean something on a flexible shift.
            p.setCoreStartTime(null);
            p.setCoreEndTime(null);
        } else if (p.getCoreStartTime() != null) {
            validateCoreHours(p.getStartTime(), p.getEndTime(), p.getCoreStartTime(), p.getCoreEndTime());
        }
    }

    /** Core hours run forwards within one day and sit inside a same-day shift window. */
    static void validateCoreHours(LocalTime start, LocalTime end, LocalTime coreStart, LocalTime coreEnd) {
        if (!coreEnd.isAfter(coreStart)) {
            throw new BusinessRuleException("Core hours must end after they start.", "SHIFT_CORE_INVALID");
        }
        boolean sameDay = start != null && end != null && end.isAfter(start);
        if (sameDay && (coreStart.isBefore(start) || coreEnd.isAfter(end))) {
            throw new BusinessRuleException(
                    "Core hours must sit inside the shift (%s to %s).".formatted(start, end), "SHIFT_CORE_OUTSIDE");
        }
    }

    /** ISO days to "6,7" (sorted, no repeats); an empty list clears them. At least one working day. */
    static String weeklyOffCsv(List<Integer> days) {
        java.util.TreeSet<Integer> set = new java.util.TreeSet<>();
        for (Integer d : days) {
            if (d == null || d < 1 || d > 7) {
                throw new BusinessRuleException("Weekly off days are 1 (Monday) to 7 (Sunday).", "SHIFT_WEEKLY_OFF_INVALID");
            }
            set.add(d);
        }
        if (set.size() == 7) {
            throw new BusinessRuleException("A shift needs at least one working day.", "SHIFT_WEEKLY_OFF_INVALID");
        }
        return set.isEmpty() ? null : set.stream().map(String::valueOf).collect(Collectors.joining(","));
    }

    /** "6,7" to [6, 7]; null or junk gives null. */
    static List<Integer> weeklyOffList(String csv) {
        if (csv == null || csv.isBlank()) return null;
        List<Integer> out = new java.util.ArrayList<>();
        for (String tok : csv.split(",")) {
            try {
                int d = Integer.parseInt(tok.trim());
                if (d >= 1 && d <= 7 && !out.contains(d)) out.add(d);
            } catch (NumberFormatException ignored) { /* skip junk */ }
        }
        return out.isEmpty() ? null : out;
    }

    private ShiftPolicy create(UUID companyId, String name, ShiftType type, LocalTime start, LocalTime end, int grace) {
        ShiftPolicy p = new ShiftPolicy();
        p.setCompanyId(companyId);
        p.setName(name);
        p.setShiftType(type);
        p.setStartTime(start);
        p.setEndTime(end);
        p.setGracePeriodMinutes(grace);
        p.setWorkingHoursPerDay(8.0);
        p.setActive(true);
        return policyRepo.save(p);
    }

    private static void apply(ShiftPolicy p, ShiftPolicyRequest req) {
        if (req.name() != null && !req.name().isBlank()) p.setName(req.name().trim());
        if (req.shiftType() != null) p.setShiftType(req.shiftType());
        if (req.startTime() != null) p.setStartTime(req.startTime());
        if (req.endTime() != null) p.setEndTime(req.endTime());
        if (req.gracePeriodMinutes() != null) p.setGracePeriodMinutes(req.gracePeriodMinutes());
        if (req.workingHoursPerDay() != null) p.setWorkingHoursPerDay(req.workingHoursPerDay());
        if (req.overtimeApplicable() != null) p.setOvertimeApplicable(req.overtimeApplicable());
        if (req.overtimeMultiplier() != null) p.setOvertimeMultiplier(req.overtimeMultiplier());
    }

    private static ShiftPolicyResponse toPolicyResponse(ShiftPolicy p) {
        return new ShiftPolicyResponse(
                p.getId(), p.getName(), p.getShiftType(),
                p.getStartTime(), p.getEndTime(),
                p.getGracePeriodMinutes(), p.getWorkingHoursPerDay(),
                p.isOvertimeApplicable(), p.getOvertimeMultiplier(),
                p.getCode(), p.getCoreStartTime(), p.getCoreEndTime(), weeklyOffList(p.getWeeklyOffDays()));
    }

    private static EmployeeShiftResponse toEmployeeResponse(UUID employeeId, EmployeeShiftAssignment a, ShiftPolicy p) {
        return toEmployeeResponse(employeeId, a, p, null, null);
    }

    private static EmployeeShiftResponse toEmployeeResponse(UUID employeeId, EmployeeShiftAssignment a, ShiftPolicy p,
                                                            EmployeeShiftAssignment upcoming, ShiftPolicy upcomingPolicy) {
        UUID upcomingId = upcoming == null ? null : upcoming.getShiftPolicyId();
        String upcomingName = upcomingPolicy == null ? null : upcomingPolicy.getName();
        LocalDate upcomingFrom = upcoming == null ? null : upcoming.getEffectiveFrom();
        if (p == null) {
            return new EmployeeShiftResponse(employeeId, a.getShiftPolicyId(), null, null, null, null, 0,
                    a.getEffectiveFrom(), a.getEffectiveTo(), upcomingId, upcomingName, upcomingFrom);
        }
        return new EmployeeShiftResponse(
                employeeId, p.getId(), p.getName(), p.getShiftType(),
                p.getStartTime(), p.getEndTime(), p.getGracePeriodMinutes(),
                a.getEffectiveFrom(), a.getEffectiveTo(), upcomingId, upcomingName, upcomingFrom);
    }

    private static LocalTime nullsafe(LocalTime t) {
        return t != null ? t : LocalTime.MIDNIGHT;
    }
}
