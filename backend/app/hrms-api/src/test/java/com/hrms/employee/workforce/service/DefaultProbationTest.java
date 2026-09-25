package com.hrms.employee.workforce.service;

import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.entity.WorkforceEmployee.EmploymentStatus;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/** HR Configuration's default probation length, applied when an employee is created (P0-2). */
class DefaultProbationTest {

    private static WorkforceEmployee hire(LocalDate joined) {
        WorkforceEmployee e = new WorkforceEmployee();
        e.setEmploymentStatus(EmploymentStatus.PROBATION);
        e.setDateOfJoining(joined);
        return e;
    }

    @Test void endDateIsJoiningPlusTheCompanyMonths() {
        WorkforceEmployee e = hire(LocalDate.of(2026, 9, 25));
        WorkforceEmployeeService.applyDefaultProbation(e, 6);
        assertEquals(LocalDate.of(2027, 3, 25), e.getProbationEndDate());
        assertEquals(EmploymentStatus.PROBATION, e.getEmploymentStatus());
    }

    @Test void monthEndsClampToTheShorterMonth() {
        WorkforceEmployee e = hire(LocalDate.of(2026, 8, 31));
        WorkforceEmployeeService.applyDefaultProbation(e, 3);
        assertEquals(LocalDate.of(2026, 11, 30), e.getProbationEndDate());
    }

    @Test void zeroMonthsMeansConfirmedFromTheFirstDay() {
        WorkforceEmployee e = hire(LocalDate.of(2026, 10, 1));
        WorkforceEmployeeService.applyDefaultProbation(e, 0);
        assertNull(e.getProbationEndDate());
        assertEquals(EmploymentStatus.ACTIVE, e.getEmploymentStatus());
        assertEquals(LocalDate.of(2026, 10, 1), e.getConfirmationDate());
    }

    @Test void aGivenEndDateIsKept() {
        WorkforceEmployee e = hire(LocalDate.of(2026, 9, 25));
        e.setProbationEndDate(LocalDate.of(2026, 12, 1));
        WorkforceEmployeeService.applyDefaultProbation(e, 6);
        assertEquals(LocalDate.of(2026, 12, 1), e.getProbationEndDate());
    }

    @Test void noJoiningDateNoProbationDate() {
        WorkforceEmployee e = hire(null);
        WorkforceEmployeeService.applyDefaultProbation(e, 6);
        assertNull(e.getProbationEndDate());
        assertEquals(EmploymentStatus.PROBATION, e.getEmploymentStatus());
    }

    @Test void defaultIsSixMonths() {
        assertEquals(6, WorkforceEmployeeService.DEFAULT_PROBATION_MONTHS);
    }
}
