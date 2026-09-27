package com.hrms.api.ess.requests;

import com.hrms.api.ess.ApproverChainService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * The name a waiting fix or shift change is "with". Those requests record no
 * approver until someone decides (anyone with attendance.regularization.approve
 * in scope may), so the name shown is the person their notification goes to,
 * the same answer as {@code GET /v1/me/approvers?for=correction|shift}.
 */
@Component
class NotifiedApprover {

    private final ApproverChainService chain;
    private final EmployeeRepository employees;

    NotifiedApprover(ApproverChainService chain, EmployeeRepository employees) {
        this.chain = chain;
        this.employees = employees;
    }

    /** Their full name, or null when nobody would be told (or the caller has no employee record). */
    String nameFor(UUID employeeId) {
        Employee me = employees.findById(employeeId).orElse(null);
        if (me == null) return null;
        ApproverChainService.Choice choice = chain.notificationApprover(me);
        if (choice == null) return null;
        return employees.findById(choice.approverId()).map(NotifiedApprover::fullName).orElse(null);
    }

    private static String fullName(Employee e) {
        String name = ((e.getFirstName() == null ? "" : e.getFirstName().trim()) + " "
                + (e.getLastName() == null ? "" : e.getLastName().trim())).trim();
        return name.isEmpty() ? null : name;
    }
}
