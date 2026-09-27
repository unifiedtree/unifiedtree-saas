package com.hrms.leave.service;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.LeavePreviewResponse;
import com.hrms.leave.dto.LeaveRequestRequest;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.entity.HolidayCalendar;
import com.hrms.leave.entity.LeaveBalance;
import com.hrms.leave.entity.LeaveRequest;
import com.hrms.leave.entity.LeaveType;
import com.hrms.leave.enums.LeaveDuration;
import com.hrms.leave.mapper.LeaveBalanceMapperImpl;
import com.hrms.leave.mapper.LeaveRequestMapperImpl;
import com.hrms.leave.repository.HolidayCalendarRepository;
import com.hrms.leave.repository.LeaveBalanceRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import com.hrms.leave.repository.LeaveTypeRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.kafka.core.KafkaTemplate;

import java.sql.Date;
import java.sql.ResultSet;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The leave preview (HRMS redesign BW-48) answers exactly what applying would:
 * the same working days, and as its first blocking reason the same code and
 * message applying refuses with. Each fixture runs both on the same data.
 */
class LeavePreviewMatchesApplyTest {

    private final UUID tenant = UUID.randomUUID(), employee = UUID.randomUUID(), company = UUID.randomUUID();
    private final UUID typeId = UUID.randomUUID(), approver = UUID.randomUUID();

    private LeaveTypeRepository types;
    private LeaveBalanceRepository balances;
    private LeaveRequestRepository requests;
    private HolidayCalendarRepository legacyHolidays;
    private JdbcTemplate jdbc;
    private LeaveAccrualService accrual;
    private LeaveService service;

    /** A Monday at least two weeks out whose fortnight stays in one year. */
    private LocalDate monday;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        types = mock(LeaveTypeRepository.class);
        balances = mock(LeaveBalanceRepository.class);
        requests = mock(LeaveRequestRepository.class);
        legacyHolidays = mock(HolidayCalendarRepository.class);
        jdbc = mock(JdbcTemplate.class);
        accrual = mock(LeaveAccrualService.class);
        @SuppressWarnings("unchecked") KafkaTemplate<String, Object> kafka = mock(KafkaTemplate.class);
        service = new LeaveService(types, balances, requests, legacyHolidays, kafka, new LeaveRequestMapperImpl(),
                new LeaveBalanceMapperImpl(), jdbc, mock(ApplicationEventPublisher.class), false);
        service.setAccrualService(accrual);
        when(requests.save(any(LeaveRequest.class))).thenAnswer(inv -> {
            LeaveRequest r = inv.getArgument(0);
            r.setId(UUID.randomUUID());
            return r;
        });
        when(balances.save(any(LeaveBalance.class))).thenAnswer(inv -> inv.getArgument(0));
        when(requests.findOverlapping(any(), any(), any(), any())).thenReturn(List.of());
        when(legacyHolidays.findByCompanyIdAndYear(any(), anyInt())).thenReturn(List.of());
        weekend(6, 7);
        holidays();
        type(true, 0, 0, 12, "YEARLY");
        balance(12, 0, 0, 0);
        LocalDate candidate = LocalDate.now().plusDays(14).with(TemporalAdjusters.next(DayOfWeek.MONDAY));
        if (candidate.getYear() != candidate.plusDays(13).getYear()) {
            candidate = LocalDate.of(candidate.getYear() + 1, 1, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY)).plusWeeks(1);
        }
        monday = candidate;
    }

    @AfterEach void clear() { TenantContext.clear(); }

    // ── fixtures ────────────────────────────────────────────────────────────

    private void type(boolean active, int minNotice, int maxConsecutive, double quota, String frequency) {
        LeaveType t = new LeaveType();
        t.setId(typeId);
        t.setCompanyId(company);
        t.setName("Casual leave");
        t.setCode("CL");
        t.setActive(active);
        t.setMinNoticeDays(minNotice);
        t.setMaxConsecutiveDays(maxConsecutive);
        t.setAnnualEntitlement(quota);
        t.setAccrualFrequency(frequency);
        when(types.findById(typeId)).thenReturn(Optional.of(t));
    }

    private void balance(double total, double used, double pending, double carry) {
        LeaveBalance b = new LeaveBalance();
        b.setEmployeeId(employee);
        b.setLeaveTypeId(typeId);
        b.setTotalEntitlement(total);
        b.setUsed(used);
        b.setPending(pending);
        b.setCarryForward(carry);
        when(balances.findByEmployeeIdAndLeaveTypeIdAndYear(eq(employee), eq(typeId), anyInt())).thenReturn(Optional.of(b));
    }

    private void noBalance() {
        when(balances.findByEmployeeIdAndLeaveTypeIdAndYear(eq(employee), eq(typeId), anyInt())).thenReturn(Optional.empty());
    }

    private void weekend(Integer... isoDays) {
        doAnswer(inv -> isoDays).when(jdbc).query(contains("weekend_days"), any(ResultSetExtractor.class), any(Object[].class));
    }

    private void holidays(LocalDate... dates) {
        doAnswer(inv -> {
            RowCallbackHandler handler = inv.getArgument(1);
            LocalDate from = ((Date) inv.getArgument(3)).toLocalDate();
            LocalDate to = ((Date) inv.getArgument(4)).toLocalDate();
            for (LocalDate d : dates) {
                if (d.isBefore(from) || d.isAfter(to)) continue;
                ResultSet rs = mock(ResultSet.class);
                when(rs.getDate("holiday_date")).thenReturn(Date.valueOf(d));
                handler.processRow(rs);
            }
            return null;
        }).when(jdbc).query(contains("holiday_calendar"), any(RowCallbackHandler.class), any(), any(), any());
    }

    private LeaveRequestRequest req(LocalDate start, LocalDate end, LeaveDuration duration) {
        return new LeaveRequestRequest(typeId, start, end, duration, "Family function");
    }

    /**
     * Runs the preview, then applying, on the same data, and checks they agree.
     * Returns the preview for any extra checks.
     */
    private LeavePreviewResponse sameAnswer(LeaveRequestRequest request) {
        clearInvocations(requests, balances);
        LeavePreviewResponse preview = service.previewLeave(employee, company, request);
        verify(requests, never()).save(any());
        verify(balances, never()).save(any());
        try {
            LeaveRequestResponse applied = service.applyLeave(employee, company, request, approver);
            assertTrue(preview.canApply(), () -> "apply accepted what the preview refused: " + preview.blockingReasons());
            assertTrue(preview.blockingReasons().isEmpty());
            assertEquals(applied.totalDays(), preview.workingDays());
            assertEquals(ApprovalStatus.PENDING, applied.status());
        } catch (HrmsException e) {
            assertFalse(preview.canApply(), () -> "the preview accepted what apply refused with " + e.getErrorCode());
            assertEquals(e.getErrorCode(), preview.blockingReasons().get(0).code());
            assertEquals(e.getMessage(), preview.blockingReasons().get(0).message());
        }
        return preview;
    }

    // ── counting ────────────────────────────────────────────────────────────

    @Test void aWorkingWeekCountsFiveDaysAndShowsTheBalanceAfter() {
        LeavePreviewResponse p = sameAnswer(req(monday, monday.plusDays(4), LeaveDuration.FULL_DAY));
        assertEquals(5.0, p.workingDays());
        assertEquals(12.0, p.balanceAvailable());
        assertEquals(7.0, p.balanceAfter());
        assertEquals("Casual leave", p.leaveTypeName());
    }

    @Test void weeklyOffsAndHolidaysAreSkippedAsApplyingSkipsThem() {
        holidays(monday.plusDays(2));
        assertEquals(6.0, sameAnswer(req(monday, monday.plusDays(8), LeaveDuration.FULL_DAY)).workingDays());
        // A Friday + Saturday weekly off (no holidays).
        holidays();
        weekend(5, 6);
        assertEquals(5.0, sameAnswer(req(monday, monday.plusDays(6), LeaveDuration.FULL_DAY)).workingDays());
    }

    @Test void aHalfDayCountsHalf() {
        assertEquals(0.5, sameAnswer(req(monday, monday, LeaveDuration.HALF_DAY_AFTERNOON)).workingDays());
    }

    @Test void withoutABalanceRowItCountsTheEntitlementApplyingWouldCreate() {
        noBalance();
        LeavePreviewResponse p = sameAnswer(req(monday, monday.plusDays(1), LeaveDuration.FULL_DAY));
        assertEquals(12.0, p.balanceAvailable());
        assertEquals(10.0, p.balanceAfter());
    }

    @Test void bothTopUpTheMonthlyCreditFirst() {
        service.previewLeave(employee, company, req(monday, monday, LeaveDuration.FULL_DAY));
        verify(accrual).topUpEmployee(employee, monday.getYear());
    }

    // ── refusals: the first reason is applying's answer ─────────────────────

    @Test void anUnknownType() {
        when(types.findById(typeId)).thenReturn(Optional.empty());
        assertEquals("RESOURCE_NOT_FOUND", sameAnswer(req(monday, monday, LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void anInactiveType() {
        type(false, 0, 0, 12, "YEARLY");
        assertEquals("LEAVE_TYPE_INACTIVE", sameAnswer(req(monday, monday, LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void theEndBeforeTheStart() {
        LeavePreviewResponse p = sameAnswer(req(monday.plusDays(2), monday, LeaveDuration.FULL_DAY));
        assertEquals("INVALID_LEAVE_DATES", p.blockingReasons().get(0).code());
        assertNull(p.workingDays());
    }

    @Test void aHalfDayOverSeveralDays() {
        assertEquals("HALF_DAY_MULTI_DAY",
                sameAnswer(req(monday, monday.plusDays(1), LeaveDuration.HALF_DAY_MORNING)).blockingReasons().get(0).code());
    }

    @Test void leaveAcrossTwoYears() {
        LocalDate dec30 = LocalDate.of(LocalDate.now().getYear() + 1, 12, 30);
        assertEquals("LEAVE_CROSS_YEAR", sameAnswer(req(dec30, dec30.plusDays(4), LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void aStartInThePast() {
        LocalDate past = LocalDate.now().minusDays(3);
        LocalDate end = past.getYear() == LocalDate.now().getYear() ? past.plusDays(1) : past;
        assertEquals("LEAVE_START_IN_PAST", sameAnswer(req(past, end, LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void anOverlappingRequest() {
        when(requests.findOverlapping(eq(employee), any(), any(), any())).thenReturn(List.of(new LeaveRequest()));
        assertEquals("LEAVE_DATES_OVERLAP", sameAnswer(req(monday, monday, LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void tooLittleNotice() {
        type(true, 60, 0, 12, "YEARLY");
        assertEquals("INSUFFICIENT_NOTICE", sameAnswer(req(monday, monday, LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void startingOnAWeeklyOffOrAHoliday() {
        LocalDate saturday = monday.minusDays(2);
        assertEquals("LEAVE_START_ON_NON_WORKING_DAY",
                sameAnswer(req(saturday, saturday.plusDays(1), LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
        holidays(monday.plusDays(1));
        assertEquals("LEAVE_START_ON_NON_WORKING_DAY",
                sameAnswer(req(monday.plusDays(1), monday.plusDays(1), LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void moreDaysInARowThanTheTypeAllows() {
        type(true, 0, 5, 30, "YEARLY");
        balance(30, 0, 0, 0);
        assertEquals("EXCEEDS_CONSECUTIVE_DAYS",
                sameAnswer(req(monday, monday.plusDays(7), LeaveDuration.FULL_DAY)).blockingReasons().get(0).code());
    }

    @Test void moreThanTheBalanceIsRefusedWithTheRealNumbers() {
        balance(12, 9, 2, 0);
        LeavePreviewResponse p = sameAnswer(req(monday, monday.plusDays(1), LeaveDuration.FULL_DAY));
        assertEquals("INSUFFICIENT_LEAVE_BALANCE", p.blockingReasons().get(0).code());
        assertEquals(1.0, p.balanceAvailable());
        assertEquals(-1.0, p.balanceAfter());
    }

    @Test void thePreviewListsEveryReasonApplyingWouldMeetInOrder() {
        type(false, 60, 0, 12, "YEARLY");
        balance(1, 0, 0, 0);
        LeavePreviewResponse p = sameAnswer(req(monday, monday.plusDays(1), LeaveDuration.FULL_DAY));
        List<String> codes = new ArrayList<>();
        p.blockingReasons().forEach(r -> codes.add(r.code()));
        assertEquals(List.of("LEAVE_TYPE_INACTIVE", "INSUFFICIENT_NOTICE", "INSUFFICIENT_LEAVE_BALANCE"), codes);
    }

    @Test void theApproverIsAddedFirstWhenItBlocks() {
        LeavePreviewResponse p = service.previewLeave(employee, company, req(monday, monday, LeaveDuration.FULL_DAY))
                .withApprover(null, new LeavePreviewResponse.Refusal("NO_APPROVER_AVAILABLE", "No approver available"));
        assertFalse(p.canApply());
        assertEquals("NO_APPROVER_AVAILABLE", p.blockingReasons().get(0).code());
        LeavePreviewResponse ok = service.previewLeave(employee, company, req(monday, monday, LeaveDuration.FULL_DAY))
                .withApprover("Dept Manager", null);
        assertTrue(ok.canApply());
        assertEquals("Dept Manager", ok.approverName());
    }

    @Test void legacyHolidaysCountToo() {
        HolidayCalendar h = new HolidayCalendar();
        h.setHolidayDate(monday.plusDays(3));
        when(legacyHolidays.findByCompanyIdAndYear(company, monday.getYear())).thenReturn(List.of(h));
        assertEquals(4.0, sameAnswer(req(monday, monday.plusDays(4), LeaveDuration.FULL_DAY)).workingDays());
    }
}
