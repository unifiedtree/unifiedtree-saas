package com.unifiedtree.saas.billing;

import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Payment reminders: 3 days before the due date, every day until paid; grace 7 days after the due date. */
class BillingReminderJobTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 3);

    @Test
    void wordingSaysWhenItIsDueAndWhenGraceEnds() {
        var soon = new BillingReminderJob.Due(UUID.randomUUID(), UUID.randomUUID(), new BigDecimal("4000.00"), "DUE_SOON", LocalDate.of(2026, 11, 6));
        assertThat(BillingReminderJob.values(soon, TODAY))
                .containsEntry("amount", "₹4,000")
                .containsEntry("dueDate", "6 Nov 2026")
                .containsEntry("when", "in 3 days")
                .containsEntry("graceEndsOn", "13 Nov 2026");
        assertThat(BillingReminderJob.values(soon, LocalDate.of(2026, 11, 5))).containsEntry("when", "tomorrow");
        assertThat(BillingReminderJob.values(soon, LocalDate.of(2026, 11, 6))).containsEntry("when", "today");
        assertThat(BillingReminderJob.rupees(new BigDecimal("125000.50"))).isEqualTo("₹1,25,000.5");
        assertThat(BillingReminderJob.rupees(new BigDecimal("12345678"))).isEqualTo("₹1,23,45,678");
        assertThat(BillingReminderJob.rupees(new BigDecimal("999"))).isEqualTo("₹999");
        assertThat(BillingReminderJob.rupees(new BigDecimal("1000"))).isEqualTo("₹1,000");
        assertThat(BillingReminderJob.rupees(null)).isEqualTo("your plan amount");
    }

    @Test
    void nothingHappensUntilTheMigrationIsApplied() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        BillingReminderSchema schema = mock(BillingReminderSchema.class);
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        when(schema.ready()).thenReturn(false);

        assertThat(new BillingReminderJob(jdbc, schema, mock(TenantAdminLookup.class), dispatcher).runFor(TODAY)).isZero();
        verifyNoInteractions(jdbc, dispatcher);
    }

    @Test
    void eachAdminIsToldOnceADayAndAnAlreadyClaimedDayIsSkipped() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        BillingReminderSchema schema = mock(BillingReminderSchema.class);
        TenantAdminLookup admins = mock(TenantAdminLookup.class);
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        when(schema.ready()).thenReturn(true);

        UUID tenant = UUID.randomUUID();
        var overdue = new BillingReminderJob.Due(UUID.randomUUID(), tenant, new BigDecimal("4000"), "OVERDUE", LocalDate.of(2026, 11, 1));
        var already = new BillingReminderJob.Due(UUID.randomUUID(), tenant, new BigDecimal("900"), "DUE_SOON", LocalDate.of(2026, 11, 5));
        when(jdbc.query(contains("FROM platform.subscriptions"), any(RowMapper.class), eq(TODAY), eq(TODAY.plusDays(3))))
                .thenReturn(List.of(overdue, already));
        when(jdbc.update(contains("billing_reminders_sent"), eq(overdue.subscriptionId()), eq(TODAY), any(), anyString(), any()))
                .thenReturn(1);
        when(jdbc.update(contains("billing_reminders_sent"), eq(already.subscriptionId()), eq(TODAY), any(), anyString(), any()))
                .thenReturn(0);   // another instance already sent today's
        UUID owner = UUID.randomUUID();
        UUID superAdmin = UUID.randomUUID();
        when(admins.findAdminUsers(tenant)).thenReturn(List.of(
                new TenantAdminLookup.AdminUser(owner, "owner@acme.test", null),
                new TenantAdminLookup.AdminUser(superAdmin, "sa@acme.test", null),
                new TenantAdminLookup.AdminUser(owner, "owner.second.login@acme.test", null)));   // same person, 2nd login

        int sent = new BillingReminderJob(jdbc, schema, admins, dispatcher).runFor(TODAY);

        assertThat(sent).isEqualTo(1);
        verify(dispatcher).dispatch(eq(tenant), eq(owner), eq("billing.payment_overdue"), anyMap(), anyMap());
        verify(dispatcher).dispatch(eq(tenant), eq(superAdmin), eq("billing.payment_overdue"), anyMap(), anyMap());
        verify(dispatcher, never()).dispatch(any(), any(), eq("billing.payment_due"), anyMap(), anyMap());
        verify(dispatcher, times(2)).dispatch(any(), any(), anyString(), anyMap(), anyMap());
    }

    @Test
    void overdueWordingCountsGraceFromTheDueDate() {
        var overdue = new BillingReminderJob.Due(UUID.randomUUID(), UUID.randomUUID(), new BigDecimal("4000"), "OVERDUE", LocalDate.of(2026, 11, 6));
        Map<String, String> v = BillingReminderJob.values(overdue, LocalDate.of(2026, 11, 9));
        assertThat(v).containsEntry("dueDate", "6 Nov 2026").containsEntry("graceEndsOn", "13 Nov 2026");
    }
}
