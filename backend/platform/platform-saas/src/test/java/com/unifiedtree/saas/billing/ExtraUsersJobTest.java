package com.unifiedtree.saas.billing;

import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
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

/** Extra users at cycle end (owner, 7 Oct 2026): notice 3 days before, added to the next charge once. */
class ExtraUsersJobTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ExtraUsersService extras = mock(ExtraUsersService.class);
    private final TenantAdminLookup admins = mock(TenantAdminLookup.class);
    private final NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
    private final RazorpayClient razorpay = mock(RazorpayClient.class);
    private final RazorpayProperties props = mock(RazorpayProperties.class);
    private final ExtraUsersJob job = new ExtraUsersJob(jdbc, extras, admins, dispatcher, razorpay, props);

    private final UUID tenant = UUID.randomUUID();
    private final UUID sub = UUID.randomUUID();
    private final UUID owner = UUID.randomUUID();
    private final Instant charge = Instant.parse("2026-11-06T04:30:00Z");   // 6 Nov, 10:00 IST

    private ExtraUsersJob.Cycle cycle() {
        return new ExtraUsersJob.Cycle(sub, tenant, 10, new BigDecimal("400.00"), charge, null, "sub_rzp_1");
    }

    @BeforeEach
    void setUp() {
        when(props.isConfigured()).thenReturn(true);
        // Peak 13 on 20 Oct (Labs 9, Retail 4) with 10 seats -> 3 extras.
        UUID labs = UUID.randomUUID(), retail = UUID.randomUUID();
        when(extras.readings(eq(tenant), any(), any())).thenReturn(List.of(
                new ExtraUsers.DayCount(LocalDate.of(2026, 10, 20), labs, "Acme Labs", 9),
                new ExtraUsers.DayCount(LocalDate.of(2026, 10, 20), retail, "Acme Retail", 4)));
        when(admins.findAdminUsers(tenant)).thenReturn(List.of(
                new TenantAdminLookup.AdminUser(owner, "owner@acme.test", null),
                new TenantAdminLookup.AdminUser(owner, "owner.2@acme.test", null)));   // same person, two logins
    }

    private void noticeRowIsNew(boolean isNew) {
        when(jdbc.update(contains("INSERT INTO platform.extra_user_charges"), any(Object[].class))).thenReturn(isNew ? 1 : 0);
    }

    private void claim(boolean wins) {
        when(jdbc.update(contains("SET status = 'ADDING'"), eq(sub), any())).thenReturn(wins ? 1 : 0);
    }

    @Test
    void threeDaysBeforeTheOwnerIsToldOnceAndNothingIsChargedYet() {
        noticeRowIsNew(true);
        job.handle(cycle(), charge.minus(Duration.ofDays(3)));

        verify(dispatcher, times(1)).dispatch(eq(tenant), eq(owner), eq("billing.extra_users"), anyMap(), anyMap());
        verify(razorpay, never()).createSubscriptionAddon(anyString(), anyString(), anyString(), anyLong(), anyInt());
    }

    @Test
    void theNoticeIsNotRepeated() {
        noticeRowIsNew(false);
        job.handle(cycle(), charge.minus(Duration.ofDays(2)));
        verifyNoInteractions(dispatcher);
    }

    @Test
    void justBeforeTheChargeTheExtrasAreAddedToItOnce() {
        noticeRowIsNew(false);
        claim(true);
        when(razorpay.createSubscriptionAddon(anyString(), anyString(), anyString(), anyLong(), anyInt())).thenReturn("ao_1");

        job.handle(cycle(), charge.minus(Duration.ofMinutes(90)));

        // 3 extra users x ₹400.00 = 40000 paise each.
        verify(razorpay).createSubscriptionAddon(eq("sub_rzp_1"), eq("Extra users (3)"), anyString(), eq(40000L), eq(3));
        verify(jdbc).update(contains("by_company = ?::jsonb, status = ?"), any(Object[].class));
    }

    @Test
    void aCycleAlreadyAddedOrBeingAddedIsNeverChargedAgain() {
        noticeRowIsNew(false);
        claim(false);
        job.handle(cycle(), charge.minus(Duration.ofMinutes(30)));
        verify(razorpay, never()).createSubscriptionAddon(anyString(), anyString(), anyString(), anyLong(), anyInt());
    }

    @Test
    void aRazorpayFailureIsKeptForTheNextRun() {
        noticeRowIsNew(false);
        claim(true);
        when(razorpay.createSubscriptionAddon(anyString(), anyString(), anyString(), anyLong(), anyInt()))
                .thenThrow(new ResponseStatusException(org.springframework.http.HttpStatus.BAD_GATEWAY, "down"));

        job.handle(cycle(), charge.minus(Duration.ofMinutes(30)));   // no exception escapes
        verify(razorpay, times(1)).createSubscriptionAddon(anyString(), anyString(), anyString(), anyLong(), anyInt());
    }

    @Test
    void nothingRunsBeforeTheMigration() {
        when(extras.ready()).thenReturn(false);
        job.runAt(charge.minus(Duration.ofDays(1)));
        verifyNoInteractions(jdbc, dispatcher, razorpay);
    }
}
