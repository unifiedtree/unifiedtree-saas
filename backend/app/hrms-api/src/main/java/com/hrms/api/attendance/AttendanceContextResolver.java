package com.hrms.api.attendance;

import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.repository.WorkforceBranchRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Component
public class AttendanceContextResolver {

    private static final Logger log = LoggerFactory.getLogger(AttendanceContextResolver.class);

    record Context(
            UUID employeeId,
            UUID companyId,
            UUID branchId,
            UUID departmentId,
            Double branchLat,
            Double branchLon,
            int geoFenceRadius,
            String branchName
    ) {}

    private final EmployeeRepository employeeRepository;
    private final WorkforceBranchRepository branchRepository;

    public AttendanceContextResolver(EmployeeRepository employeeRepository,
                                     WorkforceBranchRepository branchRepository) {
        this.employeeRepository = employeeRepository;
        this.branchRepository = branchRepository;
    }

    @Transactional(readOnly = true)
    public Context resolve(UUID employeeId) {
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));

        UUID branchId = employee.getBranchId();
        Double branchLat = null;
        Double branchLon = null;
        int geoFenceRadius = 100;
        String branchName = null;

        if (branchId != null) {
            Branch branch = branchRepository.findById(branchId).orElse(null);
            if (branch != null) {
                branchLat = branch.getLatitude() != null ? branch.getLatitude().doubleValue() : null;
                branchLon = branch.getLongitude() != null ? branch.getLongitude().doubleValue() : null;
                geoFenceRadius = branch.getGeoFenceRadiusMeters() != null ? branch.getGeoFenceRadiusMeters() : 100;
                branchName = branch.getName();
            }
        } else {
            // Pick HQ or first active branch for the company
            List<Branch> branches = branchRepository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(employee.getCompanyId());
            if (!branches.isEmpty()) {
                Branch hq = branches.stream()
                        .filter(Branch::isHeadquarters)
                        .findFirst()
                        .orElse(branches.get(0));
                branchId = hq.getId();
                branchLat = hq.getLatitude() != null ? hq.getLatitude().doubleValue() : null;
                branchLon = hq.getLongitude() != null ? hq.getLongitude().doubleValue() : null;
                geoFenceRadius = hq.getGeoFenceRadiusMeters() != null ? hq.getGeoFenceRadiusMeters() : 100;
                branchName = hq.getName();
            }
        }

        log.debug("Resolved context for employee={}: companyId={}, branchId={}, lat={}, lon={}",
                employeeId, employee.getCompanyId(), branchId, branchLat, branchLon);

        return new Context(
                employee.getId(),
                employee.getCompanyId(),
                branchId,
                employee.getDepartmentId(),
                branchLat,
                branchLon,
                geoFenceRadius,
                branchName
        );
    }
}
