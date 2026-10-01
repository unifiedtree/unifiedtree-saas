package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.CreateShiftChangeRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * BW-31 "Until" and BW-34 withdraw on a shift change request.
 *
 * <p>The request table is faked at the JDBC call level (what SQL ran, with what),
 * and the shift assignments run through the REAL {@link EmployeeShiftService}
 * over an in-memory assignment store, so "the old shift comes back the day after
 * the end date" is checked on the resulting assignment rows, not on mocks.
 */
class ShiftChangeUntilTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID approver = UUID.randomUUID();
    private final UUID general = UUID.randomUUID();
    private final UUID night = UUID.randomUUID();
    private final LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    private final FakeJdbc jdbc = new FakeJdbc();
    private final ShiftPolicyRepository policies = mock(ShiftPolicyRepository.class);
    private final EmployeeShiftAssignmentRepository assignments = mock(EmployeeShiftAssignmentRepository.class);
    private final List<EmployeeShiftAssignment> store = new ArrayList<>();
    private final EmployeeShiftService shifts = new EmployeeShiftService(policies, assignments);
    private final List<Object> events = new ArrayList<>();
    private final ShiftChangeRequestService service = new ShiftChangeRequestService(jdbc, shifts, events::add);

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        policy(general, "General", true);
        policy(night, "Night", true);
        // An in-memory employee_shift_assignments behind the repository methods EmployeeShiftService uses.
        when(assignments.save(any(EmployeeShiftAssignment.class))).thenAnswer(i -> {
            EmployeeShiftAssignment a = i.getArgument(0);
            if (store.stream().noneMatch(x -> x == a)) store.add(a);
            return a;
        });
        when(assignments.saveAll(any())).thenAnswer(i -> i.getArgument(0));
        when(assignments.findByEmployeeIdAndEffectiveToIsNull(employee))
                .thenAnswer(i -> store.stream().filter(a -> a.getEffectiveTo() == null).toList());
        when(assignments.findEffectiveOn(eq(employee), any(LocalDate.class))).thenAnswer(i -> {
            LocalDate d = i.getArgument(1);
            return store.stream().filter(a -> !a.getEffectiveFrom().isAfter(d) && (a.getEffectiveTo() == null || !a.getEffectiveTo().isBefore(d)))
                    .sorted(Comparator.comparing(EmployeeShiftAssignment::getEffectiveFrom).reversed()).toList();
        });
        when(assignments.findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(eq(employee), any(LocalDate.class))).thenAnswer(i -> {
            LocalDate d = i.getArgument(1);
            return store.stream().filter(a -> a.getEffectiveFrom().isAfter(d)).min(Comparator.comparing(EmployeeShiftAssignment::getEffectiveFrom));
        });
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private ShiftPolicy policy(UUID id, String name, boolean active) {
        ShiftPolicy p = new ShiftPolicy();
        p.setId(id);
        p.setName(name);
        p.setActive(active);
        when(policies.findById(id)).thenReturn(Optional.of(p));
        return p;
    }

    private void onShift(UUID policy, LocalDate from) {
        EmployeeShiftAssignment a = new EmployeeShiftAssignment();
        a.setEmployeeId(employee);
        a.setShiftPolicyId(policy);
        a.setEffectiveFrom(from);
        store.add(a);
    }

    private UUID shiftOn(LocalDate d) {
        return shifts.shiftPolicyIdOn(employee, d);
    }

    private ShiftChangeRequestResponse pending(LocalDate start, LocalDate end) {
        return new ShiftChangeRequestResponse(UUID.randomUUID(), employee, "Reader User", "EMP002", general, "General",
                night, "Night", "Night classes for a few weeks", "PENDING", null, null, null, Instant.now(),
                start, null, null, end);
    }

    // ── create ───────────────────────────────────────────────────────────────

    @Test void anEndDateIsSavedWithTheRequest() {
        onShift(general, today.minusDays(60));
        ShiftChangeRequestResponse saved = pending(today.plusDays(3), today.plusDays(9));
        jdbc.row = saved;

        service.create(employee, new CreateShiftChangeRequest(night, "Night classes for a few weeks", today.plusDays(3), today.plusDays(9)));

        String insert = jdbc.updates.stream().filter(s -> s.contains("INSERT")).findFirst().orElseThrow();
        assertTrue(insert.contains("requested_end_date"), insert);
        Object[] args = jdbc.updateArgs.get(jdbc.updates.indexOf(insert));
        assertEquals(today.plusDays(9), args[args.length - 1]);
    }

    @Test void withoutAnEndDateTheInsertIsExactlyTodaysEvenWhenTheColumnIsMissing() {
        onShift(general, today.minusDays(60));
        jdbc.endColumn = false;
        jdbc.row = pending(today.plusDays(3), null);

        service.create(employee, new CreateShiftChangeRequest(night, "Night classes for a few weeks", today.plusDays(3)));

        String insert = jdbc.updates.stream().filter(s -> s.contains("INSERT")).findFirst().orElseThrow();
        assertFalse(insert.contains("requested_end_date"), "a permanent change writes the row it always did");
        // Reads never name the missing column either.
        assertTrue(jdbc.selects.stream().allMatch(s -> !s.contains("scr.requested_end_date")), "reads leave the column out");
        assertTrue(jdbc.selects.stream().anyMatch(s -> s.contains("NULL::date AS requested_end_date")));
    }

    @Test void anEndDateWithoutTheColumnIsNotReadyAndNothingIsSaved() {
        onShift(general, today.minusDays(60));
        jdbc.endColumn = false;

        FeatureNotReady e = assertThrows(FeatureNotReady.class, () -> service.create(employee,
                new CreateShiftChangeRequest(night, "Night classes for a few weeks", today.plusDays(3), today.plusDays(9))));

        assertEquals(FeatureNotReady.CODE, e.getErrorCode());
        assertTrue(jdbc.updates.isEmpty(), "never saved as a permanent change");
    }

    @Test void theEndDateMustFollowAStartAndStayWithinAYear() {
        onShift(general, today.minusDays(60));
        assertEquals("SHIFT_CHANGE_END_BEFORE_START", assertThrows(BusinessRuleException.class, () -> service.create(employee,
                new CreateShiftChangeRequest(night, "Night classes for a few weeks", today.plusDays(5), today.plusDays(4)))).getErrorCode());
        assertEquals("SHIFT_CHANGE_END_NEEDS_START", assertThrows(BusinessRuleException.class, () -> service.create(employee,
                new CreateShiftChangeRequest(night, "Night classes for a few weeks", null, today.plusDays(4)))).getErrorCode());
        assertEquals("SHIFT_CHANGE_END_TOO_FAR", assertThrows(BusinessRuleException.class, () -> service.create(employee,
                new CreateShiftChangeRequest(night, "Night classes for a few weeks", today.plusDays(5), today.plusYears(1).plusDays(1)))).getErrorCode());
        assertTrue(jdbc.updates.isEmpty());
    }

    // ── approve ──────────────────────────────────────────────────────────────

    @Test void approvingATemporaryChangeBringsTheOldShiftBackTheDayAfter() {
        LocalDate start = today.plusDays(3), end = today.plusDays(9);
        onShift(general, today.minusDays(60));
        jdbc.row = pending(start, end);

        service.decide(jdbc.row.id(), approver, new ShiftChangeDecisionRequest(true, "Fine"));

        assertEquals(general, shiftOn(start.minusDays(1)), "the old shift until the change starts");
        assertEquals(night, shiftOn(start), "the new shift from the first day");
        assertEquals(night, shiftOn(end), "the new shift through the last day");
        assertEquals(general, shiftOn(end.plusDays(1)), "the old shift back the day after");
        assertEquals(general, shiftOn(end.plusDays(200)), "and it stays");
        assertEquals(3, store.size());
        EmployeeShiftAssignment back = store.get(2);
        assertNull(back.getEffectiveTo(), "the old shift is open-ended again");
        assertTrue(back.getNote().startsWith("Back from a temporary shift change"), back.getNote());
        String approve = jdbc.updates.stream().filter(s -> s.contains("SET status = ?")).findFirst().orElseThrow();
        assertEquals("APPROVED", jdbc.updateArgs.get(jdbc.updates.indexOf(approve))[0]);
    }

    @Test void withoutAnEndDateTheChangeIsPermanentAsBefore() {
        LocalDate start = today.plusDays(3);
        onShift(general, today.minusDays(60));
        jdbc.row = pending(start, null);

        service.decide(jdbc.row.id(), approver, new ShiftChangeDecisionRequest(true, null));

        assertEquals(night, shiftOn(start));
        assertEquals(night, shiftOn(start.plusDays(400)));
        assertEquals(2, store.size());
    }

    @Test void someoneWithNoShiftBeforeHasNoneAfterATemporaryChange() {
        LocalDate start = today.plusDays(3), end = today.plusDays(9);
        jdbc.row = pending(start, end);

        service.decide(jdbc.row.id(), approver, new ShiftChangeDecisionRequest(true, null));

        assertEquals(night, shiftOn(end));
        assertNull(shiftOn(end.plusDays(1)));
        assertEquals(1, store.size());
        assertEquals(end, store.get(0).getEffectiveTo());
    }

    @Test void anArchivedShiftToGoBackToStopsTheApprovalBeforeAnythingChanges() {
        LocalDate start = today.plusDays(3), end = today.plusDays(9);
        onShift(general, today.minusDays(60));
        jdbc.active.put(general, false);
        jdbc.row = pending(start, end);

        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> service.decide(jdbc.row.id(), approver, new ShiftChangeDecisionRequest(true, null)));

        assertEquals("SHIFT_CHANGE_RESTORE_INACTIVE", e.getErrorCode());
        assertTrue(jdbc.updates.isEmpty(), "the request stays pending");
        assertEquals(1, store.size(), "no assignment was made");
    }

    @Test void rejectingATemporaryChangeTouchesNoShift() {
        onShift(general, today.minusDays(60));
        jdbc.row = pending(today.plusDays(3), today.plusDays(9));

        service.decide(jdbc.row.id(), approver, new ShiftChangeDecisionRequest(false, "Not this month"));

        assertEquals(1, store.size());
        assertEquals(general, shiftOn(today.plusDays(5)));
    }

    // ── withdraw ─────────────────────────────────────────────────────────────

    @Test void theRequesterWithdrawsTheirWaitingRequest() {
        jdbc.row = pending(today.plusDays(3), null);

        service.withdraw(jdbc.row.id(), employee);

        assertEquals(1, jdbc.updates.size());
        String sql = jdbc.updates.get(0);
        assertTrue(sql.contains("status = 'CANCELLED'") && sql.contains("employee_id = ?") && sql.contains("status = 'PENDING'"), sql);
        assertEquals(List.of(jdbc.row.id(), tenant, employee), List.of(jdbc.updateArgs.get(0)));
        assertTrue(store.isEmpty(), "no shift is touched");
    }

    @Test void onlyTheRequesterAndOnlyWhileItWaits() {
        jdbc.row = pending(today.plusDays(3), null);
        assertEquals("SHIFT_CHANGE_NOT_YOURS",
                assertThrows(BusinessRuleException.class, () -> service.withdraw(jdbc.row.id(), UUID.randomUUID())).getErrorCode());

        ShiftChangeRequestResponse p = jdbc.row;
        jdbc.row = new ShiftChangeRequestResponse(p.id(), p.employeeId(), p.employeeName(), p.employeeCode(), p.currentShiftPolicyId(),
                p.currentShiftName(), p.requestedShiftPolicyId(), p.requestedShiftName(), p.reason(), "APPROVED", approver, null,
                Instant.now(), p.createdAt(), p.requestedEffectiveDate(), p.requestedEffectiveDate(), "Owner", null);
        assertEquals("SHIFT_CHANGE_NOT_PENDING",
                assertThrows(BusinessRuleException.class, () -> service.withdraw(p.id(), employee)).getErrorCode());
        assertTrue(jdbc.updates.isEmpty());

        jdbc.row = null;
        assertThrows(com.hrms.core.exception.ResourceNotFoundException.class, () -> service.withdraw(p.id(), employee));
    }

    @Test void anApproverActingAtTheSameMomentWins() {
        jdbc.row = pending(today.plusDays(3), null);
        jdbc.updateResult = 0; // the row was decided between the read and the update

        assertEquals("SHIFT_CHANGE_NOT_PENDING",
                assertThrows(BusinessRuleException.class, () -> service.withdraw(jdbc.row.id(), employee)).getErrorCode());
    }

    /** attendance.shift_change_requests at the JDBC call level. */
    static class FakeJdbc extends JdbcTemplate {
        boolean endColumn = true;
        ShiftChangeRequestResponse row;
        int updateResult = 1;
        final Map<UUID, Boolean> active = new HashMap<>();
        final List<String> selects = new ArrayList<>();
        final List<String> updates = new ArrayList<>();
        final List<Object[]> updateArgs = new ArrayList<>();

        @Override
        public <T> T queryForObject(String sql, Class<T> type) {
            if (sql.contains("pg_attribute")) return type.cast(endColumn);
            throw new AssertionError("unexpected " + sql);
        }

        @Override
        public <T> T queryForObject(String sql, Class<T> type, Object... args) {
            if (sql.contains("COUNT(*)")) return type.cast(0);
            throw new AssertionError("unexpected " + sql);
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> query(String sql, RowMapper<T> mapper, Object... args) {
            selects.add(sql);
            if (sql.contains("FOR UPDATE")) return List.of(); // nothing has expired
            return row == null ? List.of() : List.of((T) row);
        }

        @Override
        public int update(String sql, Object... args) {
            updates.add(sql);
            updateArgs.add(args);
            return updateResult;
        }

        @Override
        public <T> List<T> queryForList(String sql, Class<T> type, Object... args) {
            if (sql.contains("is_active")) return List.of(type.cast(active.getOrDefault((UUID) args[0], true)));
            throw new AssertionError("unexpected " + sql);
        }
    }
}
