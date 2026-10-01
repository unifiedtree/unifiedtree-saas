package com.hrms.api.ess.around;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * One dated thing on Home's "Around you" (BW-121): a colleague's birthday or
 * work anniversary, a holiday, a company notice, payday, or (for team
 * approvers) the end of someone's probation.
 *
 * @param kind           BIRTHDAY, WORK_ANNIVERSARY, RETIREMENT, HOLIDAY, NOTICE, PAYDAY or PROBATION_END
 * @param date           the day it happens; for a notice without an event date, the day it was posted
 * @param dateKind       ON (the day it happens) or POSTED (a notice without an event date)
 * @param title          plain words: "Kavya Menon’s birthday", "Gandhi Jayanti", a notice's title, "Payday"
 * @param detail         the sub-line: department, "3 years", the holiday's type, the start of a notice, the pay period
 * @param tag            a holiday's type (NATIONAL, FESTIVAL, …); null for the others
 * @param refId          the holiday, notice or payroll run; for people, the person
 * @param employeeId     birthdays, anniversaries and probation ends: who
 * @param departmentName for people: their department
 * @param years          work anniversaries: which one; retirements: the retirement age
 * @param link           a page that shows it, when there is one
 */
public record AroundItem(
        String kind,
        LocalDate date,
        String dateKind,
        String title,
        String detail,
        String tag,
        UUID refId,
        UUID employeeId,
        String departmentName,
        Integer years,
        String link) {

    /** The window asked for (both ends included), what is in it, and the sources that could not be read. */
    public record Response(LocalDate from, LocalDate to, List<AroundItem> items, List<String> included,
                           List<String> unavailable) {}
}
