package com.hrms.leave.service;

import com.hrms.leave.dto.LeaveEntitlementDtos.BelowZero;
import com.hrms.leave.dto.LeaveEntitlementDtos.Change;
import com.hrms.leave.service.LeaveEntitlementService.Holder;
import com.hrms.leave.service.LeaveEntitlementService.Plan;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * "Apply to all employees" on a leave type (4 Oct 2026): what each balance
 * becomes, pinned without a database. The nclever case: Annual Leave seeded at
 * 21 days, the type later set to fewer days, balances still at 21.
 */
class LeaveEntitlementPlanTest {

    private static final LocalDate OCT_4 = LocalDate.of(2026, 10, 4);

    private static Holder with(double total, double used, double pending) {
        return new Holder(UUID.randomUUID(), "P", "E1", LocalDate.of(2024, 1, 1), UUID.randomUUID(), total, 0, used, pending);
    }

    private static Holder without(LocalDate joined) {
        return new Holder(UUID.randomUUID(), "N", "E2", joined, null, 0, 0, 0, 0);
    }

    @Test void upfrontTypeSetsEveryBalanceToTheQuotaIncludingZero() {
        Plan plan = LeaveEntitlementService.plan(
                List.of(with(21, 0, 0), with(21, 2, 0), with(0, 0, 0), without(LocalDate.of(2026, 9, 1))),
                "YEARLY", 0, 2026, OCT_4);
        assertEquals(4, plan.people());
        assertEquals(2, plan.changing());
        assertEquals(1, plan.adding());
        assertEquals(1, plan.unchanged());
        assertEquals(List.of(new Change(21, 0, 2)), plan.changes());
        // The one who already took 2 days shows -2; nobody else goes below 0.
        assertEquals(1, plan.belowZero());
        BelowZero who = plan.belowZeroPeople(20).get(0);
        assertEquals(2.0, who.takenDays());
        assertEquals(-2.0, who.availableAfter());
        // A new balance gets the quota, whoever joined when (upfront is never pro-rated).
        assertEquals(0.0, plan.steps().stream().filter(LeaveEntitlementService.Step::adding).findFirst().orElseThrow().target());
    }

    @Test void pendingDaysCountTowardsGoingBelowZeroButCarriedDaysCushionIt() {
        Holder pending = with(21, 0, 3);
        Holder carried = new Holder(UUID.randomUUID(), "C", "E3", null, UUID.randomUUID(), 21, 5, 4, 0);
        Plan plan = LeaveEntitlementService.plan(List.of(pending, carried), "YEARLY", 1, 2026, OCT_4);
        assertEquals(2, plan.changing());
        // 1 - 3 pending = -2; 1 + 5 carried - 4 used = 2.
        assertEquals(1, plan.belowZero());
        assertEquals(-2.0, plan.belowZeroPeople(20).get(0).availableAfter());
    }

    @Test void monthlyTypeFollowsWhatIsDueByTodayFromJoining() {
        // 12 a year, monthly: Jan–Oct = 10 for someone here all year; joined in August = 3.
        Holder allYear = with(21, 0, 0);
        Holder august = new Holder(UUID.randomUUID(), "A", "E4", LocalDate.of(2026, 8, 20), UUID.randomUUID(), 3, 0, 0, 0);
        Plan plan = LeaveEntitlementService.plan(List.of(allYear, august, without(null)), "MONTHLY", 12, 2026, OCT_4);
        assertEquals(1, plan.changing());
        assertEquals(1, plan.unchanged());
        assertEquals(1, plan.adding());
        assertEquals(List.of(new Change(21, 10, 1)), plan.changes());
    }

    @Test void runningItAgainChangesNothing() {
        Plan plan = LeaveEntitlementService.plan(List.of(with(1, 0, 0), with(1.0001, 0, 0)), "YEARLY", 1, 2026, OCT_4);
        assertEquals(0, plan.steps().size());
        assertEquals(2, plan.unchanged());
        assertTrue(plan.changes().isEmpty());
    }

    @Test void changesAreGroupedMostPeopleFirstAndBelowZeroIsCapped() {
        List<Holder> many = new java.util.ArrayList<>();
        for (int i = 0; i < 30; i++) many.add(with(21, 5, 0));
        many.add(with(6, 0, 0));
        Plan plan = LeaveEntitlementService.plan(many, "YEARLY", 1, 2026, OCT_4);
        assertEquals(List.of(new Change(21, 1, 30), new Change(6, 1, 1)), plan.changes());
        assertEquals(30, plan.belowZero());
        assertEquals(LeaveEntitlementService.NAMED, plan.belowZeroPeople(LeaveEntitlementService.NAMED).size());
    }
}
