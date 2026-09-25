package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** The Companies API stores the fiscal year in the same form HR Configuration does (D2, one source). */
class CompanyFiscalYearTest {

    @Test void monthNamesAreStoredUpperCase() {
        assertEquals("APRIL", CompanyService.fiscalMonth("April"));
        assertEquals("JULY", CompanyService.fiscalMonth(" july "));
        assertEquals("JANUARY", CompanyService.fiscalMonth("JANUARY"));
    }

    @Test void anythingElseIsRefused() {
        assertThrows(BusinessRuleException.class, () -> CompanyService.fiscalMonth("Apr"));
        assertThrows(BusinessRuleException.class, () -> CompanyService.fiscalMonth("Q1"));
        assertThrows(BusinessRuleException.class, () -> CompanyService.fiscalMonth(""));
    }
}
