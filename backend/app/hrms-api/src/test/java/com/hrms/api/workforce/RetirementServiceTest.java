package com.hrms.api.workforce;

import com.unifiedtree.notifications.events.RetirementDueEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Retirement age applied (P0-2): the 90 / 30-day alert rules, without a database. */
class RetirementServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final LocalDate today = LocalDate.of(2026, 9, 25);

    @AfterEach void clear() {
        com.unifiedtree.security.tenant.TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private RetirementService.RetirementDue due(UUID id, long daysLeft) {
        return new RetirementService.RetirementDue(id, "EMP-1", "Kiran Rao", "KR", "Engineering", "Lead",
                UUID.randomUUID(), "Acme", 60, today.plusDays(daysLeft), daysLeft);
    }

    @Test void thirtyDaysOrFewerGetsTheSecondAlertElseTheFirst() {
        assertEquals("RETIREMENT_90", RetirementService.kindFor(90));
        assertEquals("RETIREMENT_90", RetirementService.kindFor(31));
        assertEquals("RETIREMENT_30", RetirementService.kindFor(30));
        assertEquals("RETIREMENT_30", RetirementService.kindFor(0));
    }

    @Test void theRetiringPersonIsNotToldAboutThemselves() {
        UUID hr = UUID.randomUUID(), retiring = UUID.randomUUID();
        assertEquals(List.of(hr), RetirementService.recipientsFor(List.of(hr, retiring, hr), retiring));
    }

    @Test void recipientsAreCapped() {
        List<UUID> many = java.util.stream.IntStream.range(0, 40).mapToObj(i -> UUID.randomUUID()).toList();
        assertEquals(RetirementService.MAX_RECIPIENTS, RetirementService.recipientsFor(many, UUID.randomUUID()).size());
    }

    @SuppressWarnings("unchecked")
    @Test void eachAlertIsSentOnceToThePermissionHolders() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        UUID soon = UUID.randomUUID(), later = UUID.randomUUID(), alreadySent = UUID.randomUUID(), hr = UUID.randomUUID();
        when(jdbc.query(contains("FROM hrms.employees e"), any(RowMapper.class), any(Object[].class)))
                .thenReturn(List.of(due(soon, 12), due(later, 75), due(alreadySent, 40)));
        when(jdbc.queryForList(contains("rbac.role_permissions"), eq(UUID.class), eq(tenant), eq("hrms.retirement.alerts")))
                .thenReturn(List.of(hr));
        when(jdbc.update(contains("INSERT INTO notif.milestone_reminder_log"), eq(tenant), any(UUID.class), anyString(), any(LocalDate.class)))
                .thenAnswer(i -> alreadySent.equals(i.getArgument(2)) ? 0 : 1);

        int sent = new RetirementService(jdbc, events).alertForTenant(tenant, today);

        assertEquals(2, sent);
        ArgumentCaptor<RetirementDueEvent> ev = ArgumentCaptor.forClass(RetirementDueEvent.class);
        verify(events, times(2)).publishEvent(ev.capture());
        RetirementDueEvent first = ev.getAllValues().get(0);
        assertEquals(soon, first.employeeId());
        assertEquals(12, first.daysLeft());
        assertEquals(List.of(hr), first.recipientEmployeeIds());
        verify(jdbc).update(contains("INSERT INTO notif.milestone_reminder_log"), eq(tenant), eq(soon), eq("RETIREMENT_30"), eq(today.plusDays(12)));
        verify(jdbc).update(contains("INSERT INTO notif.milestone_reminder_log"), eq(tenant), eq(later), eq("RETIREMENT_90"), eq(today.plusDays(75)));
        assertEquals(later, ev.getAllValues().get(1).employeeId());
    }

    @SuppressWarnings("unchecked")
    @Test void withNobodyToTellNothingIsClaimed() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        UUID retiring = UUID.randomUUID();
        when(jdbc.query(contains("FROM hrms.employees e"), any(RowMapper.class), any(Object[].class)))
                .thenReturn(List.of(due(retiring, 20)));
        // The only permission holder is the retiring person.
        when(jdbc.queryForList(contains("rbac.role_permissions"), eq(UUID.class), eq(tenant), eq("hrms.retirement.alerts")))
                .thenReturn(List.of(retiring));
        assertEquals(0, new RetirementService(jdbc, events).alertForTenant(tenant, today));
        verify(jdbc, never()).update(contains("INSERT INTO notif.milestone_reminder_log"), any(), any(), any(), any());
        verifyNoInteractions(events);
    }
}
