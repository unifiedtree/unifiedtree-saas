package com.hrms.leave.service;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.LeaveBalanceResponse;
import com.hrms.leave.dto.LeaveRequestResponse;
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
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.kafka.core.KafkaTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The redesign's additions to the leave responses (BW-38, BW-49) are additive:
 * the original fields keep their places and values, and the new ones are
 * filled where they come from or left null.
 */
class LeaveResponseShapeTest {

    private final UUID id = UUID.randomUUID(), employee = UUID.randomUUID(), type = UUID.randomUUID();

    @AfterEach void clear() { TenantContext.clear(); }

    @Test void theOriginalFifteenFieldsStayAndTheNewOnesStartEmpty() {
        LeaveRequestResponse r = new LeaveRequestResponse(id, employee, "Asha Rao", "E1", "Sales", type, "Casual",
                LocalDate.of(2026, 10, 5), LocalDate.of(2026, 10, 6), 2, "Trip", ApprovalStatus.PENDING, null, null,
                Instant.parse("2026-09-27T04:00:00Z"));
        assertEquals("Asha Rao", r.employeeName());
        assertNull(r.leaveTypeCode());
        assertNull(r.duration());
        assertNull(r.approverName());
        assertNull(r.conflicts());
        // The record's first fifteen components are unchanged, in order.
        var components = LeaveRequestResponse.class.getRecordComponents();
        assertEquals(List.of("id", "employeeId", "employeeName", "employeeCode", "departmentName", "leaveTypeId",
                        "leaveTypeName", "startDate", "endDate", "totalDays", "reason", "status", "approverComment",
                        "approvedAt", "createdAt"),
                java.util.Arrays.stream(components).limit(15).map(java.lang.reflect.RecordComponent::getName).toList());
    }

    @Test void theMapperFillsTheHalfDayPartAndTheLatestDecisionTime() {
        LeaveRequest e = new LeaveRequest();
        e.setId(id);
        e.setEmployeeId(employee);
        e.setLeaveTypeId(type);
        e.setDuration(LeaveDuration.HALF_DAY_MORNING);
        e.setStatus(ApprovalStatus.PENDING_L2);
        Instant l1 = Instant.parse("2026-09-20T05:00:00Z");
        e.setApprovedAt(l1);
        LeaveRequestResponse r = new LeaveRequestMapperImpl().toResponse(e);
        assertEquals(LeaveDuration.HALF_DAY_MORNING, r.duration());
        assertEquals(l1, r.decidedAt());
        assertNull(r.l2ApprovedAt());
        Instant l2 = Instant.parse("2026-09-21T05:00:00Z");
        e.setL2ApprovedAt(l2);
        e.setStatus(ApprovalStatus.APPROVED);
        r = new LeaveRequestMapperImpl().toResponse(e);
        assertEquals(l2, r.decidedAt());
        assertEquals(l2, r.l2ApprovedAt());
        // Filling the type name (as the service does) keeps them.
        LeaveRequestResponse named = r.withLeaveTypeName("Casual").withRequester("Asha", "E1", "Sales");
        assertEquals("Casual", named.leaveTypeName());
        assertEquals(LeaveDuration.HALF_DAY_MORNING, named.duration());
        assertEquals(l2, named.decidedAt());
        LeaveRequestResponse detailed = named.withDetails("CL", "CASUAL", 4.5, 12.0, "Dept Manager", "HR Manager",
                "HR Manager", "HR Manager", List.of());
        assertEquals("Asha", detailed.employeeName());
        assertEquals("CL", detailed.leaveTypeCode());
        assertEquals(4.5, detailed.balanceAvailable());
        assertEquals(l2, detailed.decidedAt());
    }

    @Test void balancesKeepTheirTenFieldsAndGainNotes() {
        LeaveBalanceResponse b = new LeaveBalanceResponse(id, employee, type, "Casual", 2026, 12, 2, 1, 3, 12);
        assertNull(b.nextCredit());
        assertNull(b.resetsOn());
        LeaveBalanceResponse noted = b.withNotes(new LeaveBalanceResponse.NextCredit(1, LocalDate.of(2026, 10, 1)),
                LocalDate.of(2027, 1, 1), 5);
        assertEquals(12.0, noted.available());
        assertEquals(5, noted.carryForwardCap());
    }

    @Test void myBalancesCarryTheNotesFromTheTypeAndThePerson() {
        TenantContext.setTenantId(UUID.randomUUID());
        LeaveTypeRepository types = mock(LeaveTypeRepository.class);
        LeaveBalanceRepository balances = mock(LeaveBalanceRepository.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        @SuppressWarnings("unchecked") KafkaTemplate<String, Object> kafka = mock(KafkaTemplate.class);
        LeaveService service = new LeaveService(types, balances, mock(LeaveRequestRepository.class),
                mock(HolidayCalendarRepository.class), kafka, new LeaveRequestMapperImpl(), new LeaveBalanceMapperImpl(),
                jdbc, mock(ApplicationEventPublisher.class), false);
        int year = LeaveAccrualService.todayIst().getYear();
        LeaveBalance b = new LeaveBalance();
        b.setEmployeeId(employee);
        b.setLeaveTypeId(type);
        b.setYear(year);
        b.setTotalEntitlement(9);
        when(balances.findByEmployeeIdAndYear(employee, year)).thenReturn(List.of(b));
        LeaveType t = new LeaveType();
        t.setId(type);
        t.setName("Earned leave");
        t.setAnnualEntitlement(12);
        t.setAccrualFrequency("YEARLY");
        t.setCarryForwardAllowed(true);
        t.setMaxCarryForwardDays(10);
        when(types.findById(type)).thenReturn(Optional.of(t));
        when(jdbc.query(contains("date_of_joining"), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());

        LeaveBalanceResponse r = service.getMyBalances(employee, year).get(0);
        assertEquals("Earned leave", r.leaveTypeName());
        assertEquals(9.0, r.available());
        assertNull(r.nextCredit(), "yearly types have no credit during the year");
        assertEquals(LocalDate.of(year + 1, 1, 1), r.resetsOn());
        assertEquals(10, r.carryForwardCap());
    }
}
