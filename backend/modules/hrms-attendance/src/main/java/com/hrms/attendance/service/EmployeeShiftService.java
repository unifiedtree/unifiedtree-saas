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
import com.hrms.core.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
        // Seed any missing standard shifts (not just when the list is empty).
        // A tenant that only has the legacy "Standard 9-6" should still get the
        // new "General 9-5" default so the admin has it available to assign.
        boolean added = seedMissingDefaults(companyId, policies);
        if (added) {
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
        ShiftPolicy p = new ShiftPolicy();
        p.setCompanyId(companyId);
        apply(p, req);
        p.setActive(true);
        return toPolicyResponse(policyRepo.save(p));
    }

    @Transactional
    public ShiftPolicyResponse updateShift(UUID shiftId, ShiftPolicyRequest req) {
        ShiftPolicy p = policyRepo.findById(shiftId)
                .orElseThrow(() -> new ResourceNotFoundException("ShiftPolicy", shiftId));
        apply(p, req);
        return toPolicyResponse(policyRepo.save(p));
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

        LocalDate from = req.effectiveFrom() != null ? req.effectiveFrom() : LocalDate.now();

        // Close any currently-open assignment(s) the day before the new one starts.
        List<EmployeeShiftAssignment> open = assignmentRepo.findByEmployeeIdAndEffectiveToIsNull(employeeId);
        for (EmployeeShiftAssignment a : open) {
            if (a.getShiftPolicyId().equals(policy.getId())) {
                // Already on this shift — no-op, return the existing one.
                return toEmployeeResponse(employeeId, a, policy);
            }
            a.setEffectiveTo(from.minusDays(1));
        }
        if (!open.isEmpty()) assignmentRepo.saveAll(open);

        EmployeeShiftAssignment fresh = new EmployeeShiftAssignment();
        fresh.setEmployeeId(employeeId);
        fresh.setShiftPolicyId(policy.getId());
        fresh.setEffectiveFrom(from);
        fresh.setEffectiveTo(null);
        EmployeeShiftAssignment saved = assignmentRepo.save(fresh);
        log.info("Assigned employee {} to shift {} ({}) from {}", employeeId, policy.getId(), policy.getName(), from);
        return toEmployeeResponse(employeeId, saved, policy);
    }

    @Transactional(readOnly = true)
    public EmployeeShiftResponse getCurrentShift(UUID employeeId) {
        EmployeeShiftAssignment a = assignmentRepo
                .findFirstByEmployeeIdAndEffectiveToIsNullOrderByEffectiveFromDesc(employeeId)
                .orElse(null);
        if (a == null) {
            return new EmployeeShiftResponse(employeeId, null, null, null, null, null, 0, null);
        }
        ShiftPolicy policy = policyRepo.findById(a.getShiftPolicyId()).orElse(null);
        return toEmployeeResponse(employeeId, a, policy);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

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

    private void create(UUID companyId, String name, ShiftType type, LocalTime start, LocalTime end, int grace) {
        ShiftPolicy p = new ShiftPolicy();
        p.setCompanyId(companyId);
        p.setName(name);
        p.setShiftType(type);
        p.setStartTime(start);
        p.setEndTime(end);
        p.setGracePeriodMinutes(grace);
        p.setWorkingHoursPerDay(8.0);
        p.setActive(true);
        policyRepo.save(p);
    }

    private static void apply(ShiftPolicy p, ShiftPolicyRequest req) {
        if (req.name() != null && !req.name().isBlank()) p.setName(req.name().trim());
        if (req.shiftType() != null) p.setShiftType(req.shiftType());
        if (req.startTime() != null) p.setStartTime(req.startTime());
        if (req.endTime() != null) p.setEndTime(req.endTime());
        if (req.gracePeriodMinutes() != null) p.setGracePeriodMinutes(req.gracePeriodMinutes());
        if (req.workingHoursPerDay() != null) p.setWorkingHoursPerDay(req.workingHoursPerDay());
    }

    private static ShiftPolicyResponse toPolicyResponse(ShiftPolicy p) {
        return new ShiftPolicyResponse(
                p.getId(), p.getName(), p.getShiftType(),
                p.getStartTime(), p.getEndTime(),
                p.getGracePeriodMinutes(), p.getWorkingHoursPerDay());
    }

    private static EmployeeShiftResponse toEmployeeResponse(UUID employeeId, EmployeeShiftAssignment a, ShiftPolicy p) {
        if (p == null) {
            return new EmployeeShiftResponse(employeeId, a.getShiftPolicyId(), null, null, null, null, 0, a.getEffectiveFrom());
        }
        return new EmployeeShiftResponse(
                employeeId, p.getId(), p.getName(), p.getShiftType(),
                p.getStartTime(), p.getEndTime(), p.getGracePeriodMinutes(), a.getEffectiveFrom());
    }

    private static LocalTime nullsafe(LocalTime t) {
        return t != null ? t : LocalTime.MIDNIGHT;
    }
}
