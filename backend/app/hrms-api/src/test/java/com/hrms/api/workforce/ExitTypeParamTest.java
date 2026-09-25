package com.hrms.api.workforce;

import com.hrms.employee.workforce.entity.WorkforceEmployee.ExitType;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;

/** The exit type HR records on Start notice / Mark exited (V143.13). */
class ExitTypeParamTest {

    @Test void acceptsEveryTypeTheDatabaseAllows() {
        for (ExitType t : ExitType.values()) assertEquals(t, WorkforceController.parseExitType(t.name()));
        assertEquals(ExitType.END_OF_CONTRACT, WorkforceController.parseExitType(" end_of_contract "));
        // Must stay in step with ck_employees_exit_type.
        assertEquals(7, ExitType.values().length);
    }

    @Test void blankMeansNotGiven() {
        assertNull(WorkforceController.parseExitType(null));
        assertNull(WorkforceController.parseExitType("  "));
    }

    @Test void anythingElseIsABadRequest() {
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> WorkforceController.parseExitType("FIRED"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
    }
}
