package com.unifiedtree.attendance.api;

import com.unifiedtree.attendance.api.AttendanceApiDtos.EmployeeResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/employees")
@Profile("canonical-jdbc-api")
public class CanonicalEmployeeSelfController {
    private final CanonicalAttendanceService attendance;

    public CanonicalEmployeeSelfController(CanonicalAttendanceService attendance) {
        this.attendance = attendance;
    }

    @GetMapping("/me")
    @PreAuthorize("hasAuthority('hrms.ess.read')")
    public EmployeeResponse me() {
        return attendance.me();
    }
}
