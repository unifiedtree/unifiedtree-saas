package com.hrms.api.hiring;

import com.hrms.employee.workforce.entity.WorkforceEmployee;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** The two mappings conversion does on its own; everything else is carried over verbatim. */
class CandidateConversionServiceTest {

    @Test
    void splitsFullNameIntoFirstAndRest() {
        assertArrayEquals(new String[] {"Priya", "Raghavan"}, CandidateConversionService.splitName("Priya Raghavan"));
        assertArrayEquals(new String[] {"Priya", null}, CandidateConversionService.splitName("  Priya "));
        assertArrayEquals(new String[] {"Sai", "Teja Ungarala"}, CandidateConversionService.splitName("Sai  Teja Ungarala"));
        assertArrayEquals(new String[] {"Candidate", null}, CandidateConversionService.splitName("   "));
    }

    @Test
    void mapsRequisitionEmploymentTypeLeniently() {
        assertEquals(WorkforceEmployee.EmploymentType.FULL_TIME, CandidateConversionService.employmentType("Full-time"));
        assertEquals(WorkforceEmployee.EmploymentType.FULL_TIME, CandidateConversionService.employmentType("FULL_TIME"));
        assertEquals(WorkforceEmployee.EmploymentType.INTERN, CandidateConversionService.employmentType("intern"));
        assertNull(CandidateConversionService.employmentType("Freelance"));
        assertNull(CandidateConversionService.employmentType(null));
    }
}
