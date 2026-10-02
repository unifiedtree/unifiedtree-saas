package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.me.MyAssetsController;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.api.workforce.TimesheetService;
import com.hrms.core.exception.FeatureNotReady;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Needs-you sources over tables that came with other packages: assets to confirm
 * (read through GET /v1/me/assets' own code, canConfirm) and timesheet weeks sent
 * back (through TimesheetService). Each sits behind its endpoint's permission and
 * fails on its own.
 */
class ReleaseTwoNeedsYouSourcesTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID ME = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 1);

    private EssSourceRunner runner;
    private Jwt jwt;

    @BeforeEach
    void wire() {
        TenantModuleLookup modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), any())).thenReturn(true);
        runner = new EssSourceRunner(modules, TransactionOperations.withoutTransaction());
        jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString()).claim("employee_id", ME.toString()).build();
    }

    private EssCaller caller(String... perms) {
        return new EssCaller(TENANT, ME, Set.of(perms), jwt, TODAY);
    }

    private static TimesheetService.Week week(String status, LocalDate monday, String by, String note) {
        return new TimesheetService.Week(UUID.randomUUID(), ME, "Reader User", monday, status, 2400,
                Instant.parse("2026-09-28T05:00:00Z"), "SUBMITTED".equals(status) ? null : Instant.parse("2026-09-29T05:00:00Z"),
                by, note, "EMP002", null);
    }

    @Test void assetsToConfirmAreTheCanConfirmRowsOfMyAssets() {
        MyAssetsController assets = mock(MyAssetsController.class);
        UUID laptop = UUID.randomUUID();
        when(assets.mine(jwt)).thenReturn(List.of(
                new MyAssetsController.MyAsset(laptop, "LT-0042", "LAPTOP", "MacBook Pro 14", "SN1", TODAY.minusDays(3), null, null, true, null, true, null),
                new MyAssetsController.MyAsset(UUID.randomUUID(), "PH-1", "PHONE", "Pixel", "SN2", TODAY.minusDays(30), null, null, true,
                        Instant.parse("2026-09-01T00:00:00Z"), false, null),
                new MyAssetsController.MyAsset(UUID.randomUUID(), "MN-7", "MONITOR", null, null, TODAY.minusDays(90), TODAY.minusDays(10), "Returned",
                        false, null, false, null)));
        AssetsToConfirmSource s = new AssetsToConfirmSource(assets);
        assertEquals("ASSET_TO_CONFIRM", s.key());
        assertEquals("hrms", s.module());
        assertFalse(s.allowed(caller("hrms.ess.read")));
        assertTrue(s.allowed(caller("hrms.onboarding.asset.self")));

        NeedsYouItem.Response r = new NeedsYouService(List.of(s), runner).needsYou(caller("hrms.onboarding.asset.self"));
        assertEquals(1, r.items().size(), "only the asset waiting for my confirmation");
        NeedsYouItem item = r.items().get(0);
        assertEquals("Confirm you have the MacBook Pro 14", item.title());
        assertEquals(laptop, item.refId());
        assertEquals("/me/assets", item.link());
        assertEquals("LT-0042 · handed over 28 Sep", item.detail());

        assertTrue(new NeedsYouService(List.of(s), runner).needsYou(caller("hrms.ess.read")).items().isEmpty());
        verify(assets, times(1)).mine(any());
    }

    @Test void onlyWeeksSentBackNeedMe() {
        TimesheetService timesheets = mock(TimesheetService.class);
        LocalDate monday = LocalDate.of(2026, 9, 21);
        when(timesheets.myWeeks(ME, TODAY.minusWeeks(12), TODAY)).thenReturn(List.of(
                week("REJECTED", monday, "Dept Manager", "Add the project for Tuesday"),
                week("SUBMITTED", monday.minusWeeks(1), null, null),
                week("APPROVED", monday.minusWeeks(2), "Dept Manager", null)));
        TimesheetsSentBackSource s = new TimesheetsSentBackSource(timesheets);
        assertEquals("TIMESHEET_SENT_BACK", s.key());
        assertFalse(s.allowed(caller("hrms.ess.read")));
        assertTrue(s.allowed(caller("attendance.checkin.self")));

        NeedsYouItem.Response r = new NeedsYouService(List.of(s), runner).needsYou(caller("attendance.checkin.self"));
        assertEquals(1, r.items().size());
        assertEquals("Fix your timesheet for the week of 21 Sep", r.items().get(0).title());
        assertEquals("Sent back by Dept Manager · “Add the project for Tuesday”", r.items().get(0).detail());
        assertEquals(NeedsYouItem.GOLD, r.items().get(0).tone());
        assertEquals(monday, r.items().get(0).onDate());
    }

    @Test void aMissingTimesheetTableTakesOutOnlyThatSource() {
        TimesheetService timesheets = mock(TimesheetService.class);
        when(timesheets.myWeeks(any(), any(), any())).thenThrow(new FeatureNotReady());
        MyAssetsController assets = mock(MyAssetsController.class);
        when(assets.mine(any())).thenReturn(List.of());
        NeedsYouItem.Response r = new NeedsYouService(List.of(new TimesheetsSentBackSource(timesheets), new AssetsToConfirmSource(assets)), runner)
                .needsYou(caller("attendance.checkin.self", "hrms.onboarding.asset.self"));
        assertEquals(List.of("TIMESHEET_SENT_BACK"), r.unavailable());
        assertEquals(List.of("ASSET_TO_CONFIRM"), r.included());
    }
}
