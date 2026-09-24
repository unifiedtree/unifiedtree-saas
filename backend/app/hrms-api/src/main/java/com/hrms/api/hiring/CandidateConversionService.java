package com.hrms.api.hiring;

import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.hrms.hiring.dto.CandidateConversionFacts;
import com.hrms.hiring.dto.CandidateResponse;
import com.hrms.hiring.service.HiringService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;

/**
 * Candidate → employee conversion: "I hired this candidate — why must I type
 * them in again?" (HRMS_IMPLEMENTATION_PLAN §10, AT-3).
 *
 * <p>One transaction: lock the HIRED candidate, create the employee through
 * the ordinary {@link WorkforceEmployeeService#create} (so the workspace seat
 * quota, validation, employee-code generation and designation auto-creation
 * all apply exactly as for a hand-typed hire), then record the link on the
 * candidate. Any failure — seat limit, duplicate email, invalid data — rolls
 * the whole thing back, and the candidate lock makes a double click produce
 * one employee, not two.
 *
 * <p>Carried over: name, email, phone (candidate); company, department,
 * employment type (requisition); role title as designation, joining date and
 * annual CTC (the accepted offer, when one exists). Nothing is invented:
 * fields the hiring side does not know stay empty for HR to complete on the
 * profile or in the onboarding wizard.
 */
@Service
public class CandidateConversionService {

    private final HiringService hiring;
    private final WorkforceEmployeeService employees;

    public CandidateConversionService(HiringService hiring, WorkforceEmployeeService employees) {
        this.hiring = hiring;
        this.employees = employees;
    }

    public record ConversionResult(CandidateResponse candidate, WorkforceEmployeeResponse employee) {}

    @Transactional
    public ConversionResult convert(UUID candidateId) {
        CandidateConversionFacts f = hiring.beginConversion(candidateId);
        String[] name = splitName(f.fullName());
        CreateWorkforceEmployeeRequest request = new CreateWorkforceEmployeeRequest(
                f.companyId(), null, name[0], null, name[1],
                blankToNull(f.email()), blankToNull(f.phone()), null, null,
                f.departmentId(), null, null, null, null, null,
                employmentType(f.employmentType()), f.joiningDate(), f.offeredCtc(),
                null, null, null,
                null, null, null, null,
                null, null, null, null,
                blankToNull(f.roleTitle()),
                null, null, null, null,
                null, null, null,
                null);
        WorkforceEmployeeResponse employee = employees.create(request);
        CandidateResponse candidate = hiring.completeConversion(candidateId, employee.id());
        return new ConversionResult(candidate, employee);
    }

    /** "Priya Raghavan" → ["Priya", "Raghavan"]; "Priya" → ["Priya", null]; extra words stay in the last name. */
    static String[] splitName(String fullName) {
        String[] parts = fullName == null ? new String[0] : fullName.trim().split("\\s+");
        if (parts.length == 0 || parts[0].isEmpty()) return new String[] {"Candidate", null};
        if (parts.length == 1) return new String[] {parts[0], null};
        return new String[] {parts[0], String.join(" ", Arrays.copyOfRange(parts, 1, parts.length))};
    }

    /** Requisition employment type is free text ("Full-time", "FULL_TIME"); unknown values stay unset. */
    static WorkforceEmployee.EmploymentType employmentType(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String key = raw.trim().toUpperCase(Locale.ROOT).replaceAll("[\\s-]+", "_");
        for (WorkforceEmployee.EmploymentType t : WorkforceEmployee.EmploymentType.values()) {
            if (t.name().equals(key)) return t;
        }
        return null;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
