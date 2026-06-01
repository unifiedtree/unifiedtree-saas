package com.hrms.app.jobs;

import com.hrms.leave.service.LeaveService;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.entity.Employee;
import com.hrms.core.enums.EmploymentStatus;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

/**
 * Runs on the 1st of each month at 00:30 IST (19:00 UTC prior day).
 * Ensures every active employee has a leave balance row for the current year.
 * Also called programmatically on hire and exit events.
 */
@Component
@ConditionalOnBean(LeaveService.class)
@DisallowConcurrentExecution
public class LeaveAccrualJob implements Job {

    private static final Logger log = LoggerFactory.getLogger(LeaveAccrualJob.class);

    private final LeaveService leaveService;
    private final EmployeeRepository employeeRepository;

    public LeaveAccrualJob(LeaveService leaveService, EmployeeRepository employeeRepository) {
        this.leaveService = leaveService;
        this.employeeRepository = employeeRepository;
    }

    @Override
    @Transactional
    public void execute(JobExecutionContext context) {
        int year = LocalDate.now().getYear();
        log.info("LeaveAccrualJob: initialising leave balances for year={}", year);

        List<Employee> activeEmployees = employeeRepository
                .findByEmploymentStatus(EmploymentStatus.ACTIVE, org.springframework.data.domain.Pageable.unpaged())
                .getContent();

        int processed = 0;
        for (Employee employee : activeEmployees) {
            try {
                leaveService.initLeaveBalances(
                        employee.getId(),
                        employee.getCompanyId(),
                        employee.getTenantId(),
                        year);
                processed++;
            } catch (Exception e) {
                log.warn("LeaveAccrualJob: failed to init balances for employee={}: {}",
                        employee.getId(), e.getMessage());
            }
        }

        log.info("LeaveAccrualJob: completed — processed={} employees for year={}", processed, year);
    }
}
