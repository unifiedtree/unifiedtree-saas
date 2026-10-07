package com.hrms.employee.workforce.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * A new employee always has a joining date (7 Oct 2026): the one sent, else
 * today in India, the day the record is created. Users & Access invites, a hire
 * converted from an offer without a joining date and API callers that send none
 * used to save no date at all.
 */
class JoiningDateOnCreateTest {

    @Test void theDateSentIsKept() {
        assertEquals(LocalDate.of(2026, 9, 1), WorkforceEmployeeService.joiningDateOrToday(LocalDate.of(2026, 9, 1)));
    }

    @Test void noDateIsTodayInIndia() {
        LocalDate before = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        LocalDate got = WorkforceEmployeeService.joiningDateOrToday(null);
        LocalDate after = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        assertEquals(true, !got.isBefore(before) && !got.isAfter(after), "today (India): " + got);
    }
}
