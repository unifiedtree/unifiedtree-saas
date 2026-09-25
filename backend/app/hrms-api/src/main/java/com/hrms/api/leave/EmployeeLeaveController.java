package com.hrms.api.leave;

import com.hrms.api.employee.EmployeeRecordAccess;
import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.leave.dto.LeaveBalanceResponse;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.service.LeaveService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Another person's leave, for the employee workspace's Leave tab
 * (/hrms/employees/:id?tab=leave). Until now leave was only served for the
 * signed-in person (/v1/leave/my…), so HR could not see anyone's balances or
 * requests on their record.
 *
 * <p>Who sees whom ({@link EmployeeRecordAccess}): {@code hrms.leave.employee.read}
 * (HR / admin) reads anyone; a department manager ({@code hrms.leave.approve.l1})
 * reads their team; everyone reads themselves; anyone else gets 403.
 */
@RestController
@RequestMapping("/v1/leave/employees")
@Tag(name = "Leave", description = "Leave applications, approvals, balances, and policies")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeLeaveController {

    static final String ANYONE = "hrms.leave.employee.read";
    static final String TEAM = "hrms.leave.approve.l1";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final LeaveService leaveService;
    private final EmployeeRepository employeeRepository;
    private final EmployeeRecordAccess access;

    public EmployeeLeaveController(LeaveService leaveService, EmployeeRepository employeeRepository,
                                   EmployeeRecordAccess access) {
        this.leaveService = leaveService;
        this.employeeRepository = employeeRepository;
        this.access = access;
    }

    @Operation(summary = "An employee's leave balances for a year (HR / admin: anyone; managers: their team; else self)")
    @GetMapping("/{employeeId}/balances")
    @PreAuthorize("hasAnyAuthority('hrms.leave.employee.read','hrms.leave.approve.l1','leave.balance.read')")
    public List<LeaveBalanceResponse> balances(@PathVariable UUID employeeId,
                                               @RequestParam(required = false) Integer year,
                                               @AuthenticationPrincipal Jwt jwt,
                                               Authentication auth) {
        access.assertCanView(employeeId, jwt, auth, ANYONE, TEAM);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found"));
        // The leave year is the India calendar year, never the server's UTC one.
        int y = year != null ? year : LocalDate.now(IST).getYear();
        if (y < 2000 || y > 2100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Year is out of range");
        ensureBalances(employee, y);
        return leaveService.getMyBalances(employeeId, y);
    }

    @Operation(summary = "An employee's leave requests, newest first (HR / admin: anyone; managers: their team; else self)")
    @GetMapping("/{employeeId}/requests")
    @PreAuthorize("hasAnyAuthority('hrms.leave.employee.read','hrms.leave.approve.l1','leave.balance.read')")
    public PageResponse<LeaveRequestResponse> requests(@PathVariable UUID employeeId,
                                                       @RequestParam(defaultValue = "0") int page,
                                                       @RequestParam(defaultValue = "20") int size,
                                                       @AuthenticationPrincipal Jwt jwt,
                                                       Authentication auth) {
        access.assertCanView(employeeId, jwt, auth, ANYONE, TEAM);
        if (employeeRepository.findById(employeeId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
        }
        PageRequest pageable = PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 100),
                Sort.by(Sort.Order.desc("startDate"), Sort.Order.desc("createdAt")));
        return leaveService.getMyLeaves(employeeId, pageable);
    }

    /**
     * Same lazy creation the self endpoints do (LeaveController.ensureBalancesForEmployee):
     * an employee whose hire-time init never ran would otherwise show no balances
     * here while the Leave page creates them on their first visit. Best effort.
     */
    private void ensureBalances(Employee e, int year) {
        try {
            if (e.getCompanyId() != null && e.getTenantId() != null) {
                leaveService.initLeaveBalances(e.getId(), e.getCompanyId(), e.getTenantId(), year);
            }
        } catch (Exception ignore) {
            // Never break the read path.
        }
    }
}
