package com.hrms.api.learning;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Program edit rules: seats never below the enrollment, dates in order, closed programs kept as a record. */
class LearningProgramEditTest {

    private static LearningService.ProgramDto program(String status, String start, String end, Integer seats, int enrolled) {
        return new LearningService.ProgramDto(UUID.randomUUID(), UUID.randomUUID(), "React workshop", null, null, null,
                start, end, seats, enrolled, status, null, null, null);
    }

    private static LearningService.UpdateProgramRequest edit(String title, String start, String end, Integer seats,
                                                            String mode, Boolean unlimited, String status) {
        return new LearningService.UpdateProgramRequest(title, null, null, null, start, end, seats, status, mode, unlimited);
    }

    private static String code(Runnable r) {
        return assertThrows(BusinessRuleException.class, r::run).getErrorCode();
    }

    @Test void seatsCannotDropBelowThePeopleAlreadyEnrolled() {
        var p = program("PLANNED", null, null, 20, 12);
        assertEquals("CAPACITY_BELOW_ENROLLED", code(() -> LearningService.validateDetailEdit(p, edit(null, null, null, 11, null, null, null))));
        assertDoesNotThrow(() -> LearningService.validateDetailEdit(p, edit(null, null, null, 12, null, null, null)));
        assertDoesNotThrow(() -> LearningService.validateDetailEdit(p, edit(null, null, null, 5, null, true, null)),
                "unlimited seats ignores the number");
    }

    @Test void aProgramNeedsAtLeastOneSeat() {
        assertEquals("INVALID_CAPACITY", code(() -> LearningService.validateSeats(0, 0)));
        assertEquals("INVALID_CAPACITY", code(() -> LearningService.validateSeats(-3, 0)));
        assertEquals("INVALID_CAPACITY", code(() -> LearningService.validateSeats(LearningService.MAX_SEATS + 1, 0)));
        assertDoesNotThrow(() -> LearningService.validateSeats(null, 50), "no limit");
    }

    @Test void theEndDateIsCheckedAgainstTheStartDateAlreadySaved() {
        var p = program("ONGOING", "2026-10-10", "2026-10-20", null, 0);
        assertEquals("INVALID_DATE_RANGE", code(() -> LearningService.validateDetailEdit(p, edit(null, null, "2026-10-01", null, null, null, null))));
        assertEquals("INVALID_DATE_RANGE", code(() -> LearningService.validateDetailEdit(p, edit(null, "2026-10-25", null, null, null, null, null))));
        assertDoesNotThrow(() -> LearningService.validateDetailEdit(p, edit(null, "2026-10-01", "2026-10-02", null, null, null, null)));
        assertDoesNotThrow(() -> LearningService.validateDetailEdit(p, edit(null, null, "", null, null, null, null)), "clearing the end date");
        assertEquals("INVALID_DATE", code(() -> LearningService.validateDetailEdit(p, edit(null, "10/10/2026", null, null, null, null, null))));
    }

    @Test void completedAndCancelledProgramsKeepTheirDetails() {
        for (String closed : new String[] { "COMPLETED", "CANCELLED" }) {
            var p = program(closed, null, null, 10, 3);
            assertEquals("PROGRAM_CLOSED", code(() -> LearningService.validateDetailEdit(p, edit("New title", null, null, null, null, null, null))));
            assertDoesNotThrow(() -> LearningService.validateDetailEdit(p, edit(null, null, null, null, null, null, "CANCELLED")),
                    "a status-only request is left to the status rules");
        }
    }

    @Test void titleAndModeAreValidated() {
        var p = program("PLANNED", null, null, null, 0);
        assertEquals("TITLE_REQUIRED", code(() -> LearningService.validateDetailEdit(p, edit("   ", null, null, null, null, null, null))));
        assertEquals("TITLE_TOO_LONG", code(() -> LearningService.validateDetailEdit(p, edit("x".repeat(201), null, null, null, null, null, null))));
        assertEquals("INVALID_MODE", code(() -> LearningService.validateDetailEdit(p, edit(null, null, null, null, "CLASSROOM", null, null))));
        assertEquals("ONLINE", LearningService.normaliseMode("online"));
        assertEquals("SELF_PACED", LearningService.normaliseMode(" self_paced "));
        assertNull(LearningService.normaliseMode(""), "empty clears the mode");
    }
}
