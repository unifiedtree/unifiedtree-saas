package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.ManualAttendanceRequest;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * "Mark attendance" for several people at once (V143.53 redesign, BW-17): the
 * single manual entry ({@link AttendanceService#manualEntry}) for each person,
 * with the same fields, in ONE transaction. People who can't be marked (the
 * caller themself, someone not found, a repeat in the list) are skipped with a
 * reason and nothing is written for them; if anything else fails, nothing is
 * written for anyone. Each saved entry is event-logged by the single-entry path
 * (MANUAL_ENTRY) and audited by the controller after the commit.
 */
@Service
public class ManualEntryBulkService {

    static final int MAX_PEOPLE = 200;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final AttendanceService attendance;
    private final AttendanceContextResolver contexts;
    private final EmployeeRepository employees;

    public ManualEntryBulkService(AttendanceService attendance, AttendanceContextResolver contexts, EmployeeRepository employees) {
        this.attendance = attendance;
        this.contexts = contexts;
        this.employees = employees;
    }

    /** The one day, times, status and reason applied to everyone listed. */
    public record BulkRequest(LocalDate attendanceDate, Instant checkInAt, Instant checkOutAt, String attendanceType,
                              String attendanceStatus, String locationName, String reason, List<UUID> employeeIds) {}

    /** One person's result: SAVED (with the day as stored) or SKIPPED (with the code and reason). */
    public record Result(UUID employeeId, String employeeName, String outcome, String code, String message,
                         AttendanceDto attendance) {}

    public record BulkResult(int saved, int skipped, List<Result> results) {}

    /** The whole request is refused (422) before anything is written; null when it is fine. Package-visible for tests. */
    static BusinessRuleException invalid(BulkRequest r, LocalDate today) {
        if (r == null || r.attendanceDate() == null) return new BusinessRuleException("Choose the day.", "MANUAL_DATE_REQUIRED");
        if (r.attendanceDate().isAfter(today))
            return new BusinessRuleException("Attendance can't be marked for a day that hasn't happened yet.", "MANUAL_DATE_FUTURE");
        if (r.employeeIds() == null || r.employeeIds().isEmpty())
            return new BusinessRuleException("Choose at least one person.", "MANUAL_PEOPLE_REQUIRED");
        if (r.employeeIds().size() > MAX_PEOPLE)
            return new BusinessRuleException("Mark at most " + MAX_PEOPLE + " people at a time.", "MANUAL_PEOPLE_TOO_MANY");
        if (r.checkInAt() == null && r.checkOutAt() == null)
            return new BusinessRuleException("Manual entry needs at least check-in or check-out time", "MANUAL_TIME_REQUIRED");
        if (r.checkInAt() != null && r.checkOutAt() != null && r.checkOutAt().isBefore(r.checkInAt()))
            return new BusinessRuleException("The check-out time is before the check-in time.", "MANUAL_TIME_ORDER");
        String reason = r.reason() == null ? "" : r.reason().trim();
        if (reason.length() < 3)
            return new BusinessRuleException("Add a reason (at least 3 characters). It is kept with each day.", "MANUAL_REASON_REQUIRED");
        if (reason.length() > 255)
            return new BusinessRuleException("Keep the reason under 255 characters.", "MANUAL_REASON_TOO_LONG");
        return null;
    }

    @Transactional
    public BulkResult apply(BulkRequest request, UUID actorEmployeeId) {
        BusinessRuleException refused = invalid(request, LocalDate.now(IST));
        if (refused != null) throw refused;
        String reason = request.reason().trim();
        UUID tenant = TenantContext.getTenantId();
        List<Result> results = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        int saved = 0;
        for (UUID id : request.employeeIds()) {
            if (id == null) continue;
            if (!seen.add(id)) {
                results.add(new Result(id, null, "SKIPPED", "DUPLICATE", "Listed more than once; marked once.", null));
                continue;
            }
            Employee emp = employees.findById(id).orElse(null);
            if (emp == null) {
                results.add(new Result(id, null, "SKIPPED", "EMPLOYEE_NOT_FOUND", "This person wasn't found.", null));
                continue;
            }
            String name = AttendanceReviewService.name(emp);
            if (id.equals(actorEmployeeId)) {
                results.add(new Result(id, name, "SKIPPED", "MANUAL_ENTRY_SELF", "You can't mark your own attendance.", null));
                continue;
            }
            AttendanceContextResolver.Context target = contexts.resolve(id);
            AttendanceDto dto = attendance.manualEntry(
                    new ManualAttendanceRequest(id, request.attendanceDate(), request.checkInAt(), request.checkOutAt(),
                            request.attendanceType(), request.attendanceStatus(), null, null, request.locationName(), reason),
                    actorEmployeeId, tenant, target.companyId(), target.departmentId(), target.branchId());
            results.add(new Result(id, name, "SAVED", null, null, dto));
            saved++;
        }
        return new BulkResult(saved, results.size() - saved, results);
    }
}
