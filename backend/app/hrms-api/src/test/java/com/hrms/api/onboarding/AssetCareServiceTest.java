package com.hrms.api.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.hiring.FakeJdbc;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.OnboardingAsset;
import com.hrms.employee.entity.OnboardingTemplate;
import com.hrms.employee.service.OnboardingService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * BW-69 / BW-70: holder-name privacy on the asset list, confirmations (and
 * their one-time backfill), problem reports and their notification, and the
 * answers while V143.59 is missing.
 */
class AssetCareServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final OnboardingService onboarding = mock(OnboardingService.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final AuditService audit = mock(AuditService.class);

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); TenantContext.setUserId(UUID.randomUUID()); }
    @AfterEach void clear() { TenantContext.clear(); }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static OnboardingAsset asset(String status, UUID employeeId) {
        OnboardingAsset a = new OnboardingAsset();
        a.setId(UUID.randomUUID());
        a.setCompanyId(UUID.randomUUID());
        a.setAssetTag("LAP-" + a.getId().toString().substring(0, 4));
        a.setAssetName("Laptop");
        a.setAssetType("Laptop");
        a.setStatus(status);
        a.setEmployeeId(employeeId);
        return a;
    }

    private AssetCareService service(FakeJdbc db) {
        return new AssetCareService(db.jdbc, onboarding, events, audit);
    }

    private static final Map<String, Boolean> READY = Map.of(AssetCareService.CONFIRMATIONS, true, AssetCareService.ISSUES, true);

    // ── holder names: privacy ───────────────────────────────────────────────

    @Test void withoutEmployeeReadNoNameIsReadOrReturned() {
        UUID holder = UUID.randomUUID();
        OnboardingAsset withSomeone = asset("ASSIGNED", holder);
        OnboardingAsset back = asset("RETURNED", UUID.randomUUID());
        when(onboarding.listAssets(null)).thenReturn(List.of(withSomeone, back));
        FakeJdbc db = new FakeJdbc().tables(READY);
        List<OnboardingViews.AssetView> rows = service(db).listAssets(null, false);
        assertTrue(db.callsContaining("FROM hrms.employees").isEmpty(), "names are never even read");
        rows.forEach(r -> { assertNull(r.getHolderName()); assertNull(r.getLastHolderName()); });
        assertEquals(holder, rows.get(0).getAsset().getEmployeeId(), "the id the list always had is still there");
    }

    @Test void withEmployeeReadTheHolderAndTheLastHolderAreNamed() {
        UUID holder = UUID.randomUUID(), previous = UUID.randomUUID();
        OnboardingAsset withSomeone = asset("ASSIGNED", holder);
        OnboardingAsset back = asset("RETURNED", previous);
        OnboardingAsset spare = asset("AVAILABLE", null);
        when(onboarding.listAssets(null)).thenReturn(List.of(withSomeone, back, spare));
        FakeJdbc db = new FakeJdbc().tables(READY)
                .on("FROM hrms.employees", List.of(row("id", holder, "name", "Asha Rao"), row("id", previous, "name", "Vikram Das")));
        List<OnboardingViews.AssetView> rows = service(db).listAssets(null, true);
        assertEquals("Asha Rao", rows.get(0).getHolderName());
        assertNull(rows.get(0).getLastHolderName());
        assertNull(rows.get(1).getHolderName());
        assertEquals("Vikram Das", rows.get(1).getLastHolderName());
        assertNull(rows.get(2).getHolderName());
        assertNull(rows.get(2).getLastHolderName());
        assertEquals(tenant, db.callsContaining("FROM hrms.employees").get(0).args().get(0), "names are tenant-scoped");
    }

    @Test void theControllerAsksForNamesOnlyWhenTheTokenCarriesEmployeeRead() {
        var jwtWith = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("t").header("alg", "none")
                .claim("permissions", List.of("hrms.onboarding.asset.read", "hrms.employee.read")).build();
        var jwtWithout = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("t").header("alg", "none")
                .claim("permissions", List.of("hrms.onboarding.asset.read")).build();
        AssetCareService care = mock(AssetCareService.class);
        OnboardingController controller = new OnboardingController(onboarding, null, mock(OnboardingOverviewService.class), care);
        controller.listAssets(null, jwtWith);
        verify(care).listAssets(null, true);
        controller.listAssets(null, jwtWithout);
        verify(care).listAssets(null, false);
        assertFalse(OnboardingController.holds(null, "hrms.employee.read"));
    }

    // ── confirmations on HR's list ──────────────────────────────────────────

    @Test void theListShowsConfirmedWaitingAndNothingToConfirm() {
        UUID a1 = UUID.randomUUID();
        OnboardingAsset confirmed = asset("ASSIGNED", UUID.randomUUID());
        OnboardingAsset waiting = asset("ASSIGNED", UUID.randomUUID());
        OnboardingAsset legacy = asset("ASSIGNED", UUID.randomUUID());
        when(onboarding.listAssets(null)).thenReturn(List.of(confirmed, waiting, legacy));
        Instant at = Instant.parse("2026-09-20T05:00:00Z");
        FakeJdbc db = new FakeJdbc().tables(READY)
                .on("LEFT JOIN hrms.asset_confirmations", List.of(
                        row("asset_id", confirmed.getId(), "confirmed_at", java.sql.Timestamp.from(at), "source", "EMPLOYEE"),
                        row("asset_id", waiting.getId(), "confirmed_at", null, "source", null)))
                .on("FROM hrms.asset_issue_reports", List.of(row("id", a1, "asset_id", waiting.getId(), "kind", "DAMAGED", "note", "Cracked",
                        "reported_at", java.sql.Timestamp.from(at))));
        List<OnboardingViews.AssetView> rows = service(db).listAssets(null, false);
        assertEquals(at, rows.get(0).getConfirmedAt());
        assertEquals("EMPLOYEE", rows.get(0).getConfirmationSource());
        assertEquals(false, rows.get(0).getConfirmationPending());
        assertEquals(true, rows.get(1).getConfirmationPending());
        assertEquals("DAMAGED", rows.get(1).getOpenIssue().kind());
        assertEquals(false, rows.get(2).getConfirmationPending(), "handed over before hand-overs were recorded");
    }

    @Test void withoutTheNewTablesTheListIsAsBefore() {
        when(onboarding.listAssets(null)).thenReturn(List.of(asset("ASSIGNED", UUID.randomUUID())));
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        var r = service(db).listAssets(null, false).get(0);
        assertNull(r.getConfirmedAt());
        assertNull(r.getConfirmationPending());
        assertNull(r.getOpenIssue());
        assertTrue(db.callsContaining("asset_confirmations").isEmpty());
        assertTrue(db.callsContaining("FROM hrms.asset_issue_reports").isEmpty());
    }

    @Test void theAssetRowKeepsEveryFieldItHadAndAddsTheNewOnes() throws Exception {
        OnboardingAsset a = asset("ASSIGNED", UUID.randomUUID());
        a.setAssignedAt(LocalDate.of(2026, 9, 1));
        ObjectMapper json = new ObjectMapper().findAndRegisterModules();
        JsonNode before = json.valueToTree(a);
        JsonNode after = json.valueToTree(new OnboardingViews.AssetView(a, "Asha Rao", null, null, null, true, null));
        before.fieldNames().forEachRemaining(f -> assertEquals(before.get(f), after.get(f), f));
        assertEquals("Asha Rao", after.get("holderName").asText());
        assertTrue(after.get("confirmationPending").asBoolean());
        assertFalse(after.has("asset"), "the entity is unwrapped, not nested");

        OnboardingTemplate t = new OnboardingTemplate();
        t.setId(UUID.randomUUID());
        t.setName("Engineering");
        JsonNode tBefore = json.valueToTree(t);
        JsonNode tAfter = json.valueToTree(new OnboardingViews.TemplateView(t, 3));
        tBefore.fieldNames().forEachRemaining(f -> assertEquals(tBefore.get(f), tAfter.get(f), f));
        assertEquals(3, tAfter.get("usedBy").asInt());
    }

    // ── confirm ─────────────────────────────────────────────────────────────

    private static final String HELD = "FOR UPDATE OF a";

    @Test void theHolderConfirmsTheirOpenHandOverOnce() {
        UUID me = UUID.randomUUID(), assetId = UUID.randomUUID(), allocation = UUID.randomUUID();
        FakeJdbc db = new FakeJdbc().tables(READY)
                .on(HELD, List.of(row("id", assetId, "asset_tag", "LAP-1", "asset_name", "Laptop", "allocation_id", allocation)));
        service(db).confirm(me, assetId);
        var insert = db.callsContaining("INSERT INTO hrms.asset_confirmations");
        assertEquals(1, insert.size());
        assertTrue(insert.get(0).sql().contains("ON CONFLICT (allocation_id) DO NOTHING"), "confirming twice changes nothing");
        assertEquals(List.of(tenant, allocation, assetId, me), insert.get(0).args());
        var held = db.callsContaining(HELD).get(0);
        assertTrue(held.sql().contains("a.status = 'ASSIGNED' AND a.employee_id = ?"), "only the person it is with now");
        assertEquals(List.of(tenant, assetId, me), held.args());
    }

    @Test void someoneTheAssetIsNotWithCannotConfirmIt() {
        FakeJdbc db = new FakeJdbc().tables(READY).on(HELD, List.of());
        HrmsException e = assertThrows(HrmsException.class, () -> service(db).confirm(UUID.randomUUID(), UUID.randomUUID()));
        assertEquals("ASSET_NOT_WITH_YOU", e.getErrorCode());
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertTrue(db.callsContaining("INSERT").isEmpty());
    }

    @Test void aHandOverFromBeforeTheHistoryHasNothingToConfirm() {
        UUID assetId = UUID.randomUUID();
        FakeJdbc db = new FakeJdbc().tables(READY)
                .on(HELD, List.of(row("id", assetId, "asset_tag", "LAP-1", "asset_name", "Laptop", "allocation_id", null)));
        HrmsException e = assertThrows(HrmsException.class, () -> service(db).confirm(UUID.randomUUID(), assetId));
        assertEquals("ASSET_NOTHING_TO_CONFIRM", e.getErrorCode());
    }

    @Test void confirmingIsNotReadyWithoutTheTable() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        assertThrows(FeatureNotReady.class, () -> service(db).confirm(UUID.randomUUID(), UUID.randomUUID()));
        assertTrue(db.callsContaining(HELD).isEmpty());
    }

    // ── the one-time backfill (V143.59) ─────────────────────────────────────

    @Test void theBackfillRunsOnlyWhenTheTableIsCreatedAndOnlyForOpenHandOvers() throws Exception {
        String sql = Files.readString(Path.of("../hrms-app/src/main/resources/db/canonical/V143_59__hiring_history_offer_email_asset_care.sql"));
        int guard = sql.indexOf("IF to_regclass('hrms.asset_confirmations') IS NULL THEN");
        int create = sql.indexOf("CREATE TABLE hrms.asset_confirmations");
        int backfill = sql.indexOf("INSERT INTO hrms.asset_confirmations");
        int endIf = sql.indexOf("END IF;", backfill);
        int rls = sql.indexOf("ALTER TABLE hrms.asset_confirmations ENABLE ROW LEVEL SECURITY");
        assertTrue(guard > 0 && guard < create && create < backfill && backfill < endIf,
                "created and backfilled together, inside the 'table does not exist yet' guard");
        assertTrue(endIf < rls, "backfilled before row-level security is switched on");
        String insert = sql.substring(backfill, endIf);
        assertTrue(insert.contains("'BACKFILL'"));
        assertTrue(insert.contains("al.returned_at IS NULL"), "only hand-overs still open");
        assertTrue(insert.contains("a.status = 'ASSIGNED'") && insert.contains("a.employee_id = al.employee_id"),
                "only assets still with that person");
        assertFalse(sql.contains("CREATE TABLE IF NOT EXISTS hrms.asset_confirmations"), "no second path that skips the guard");
    }

    // ── report a problem ────────────────────────────────────────────────────

    private FakeJdbc reportDb(UUID assetId, UUID allocation, long openAlready, List<UUID> managers) {
        UUID issueId = UUID.randomUUID();
        return new FakeJdbc().tables(READY)
                .on(HELD, List.of(row("id", assetId, "asset_tag", "LAP-1", "asset_name", "Dell Latitude", "allocation_id", allocation)))
                .on("SELECT count(*) FROM hrms.asset_issue_reports", (int) openAlready)
                .on("INSERT INTO hrms.asset_issue_reports", issueId)
                .on("FROM rbac.user_roles", managers)
                .on("FROM hrms.asset_issue_reports r", List.of(row("id", issueId, "asset_id", assetId, "asset_tag", "LAP-1",
                        "asset_name", "Dell Latitude", "asset_type", "Laptop", "employee_id", UUID.randomUUID(),
                        "employee_name", "Asha Rao", "kind", "DAMAGED", "note", "Cracked screen", "status", "OPEN",
                        "reported_at", java.sql.Timestamp.from(Instant.now()))));
    }

    @Test void aReportIsSavedAndTheAssetManagersButNotTheReporterAreTold() {
        UUID me = UUID.randomUUID(), hr = UUID.randomUUID(), assetId = UUID.randomUUID();
        FakeJdbc db = reportDb(assetId, UUID.randomUUID(), 0, List.of(hr, me));
        var issue = service(db).report(me, assetId, "damaged", "  Cracked screen ");
        assertEquals("OPEN", issue.status());
        var insert = db.callsContaining("INSERT INTO hrms.asset_issue_reports").get(0);
        assertEquals("DAMAGED", insert.args().get(4));
        assertEquals("Cracked screen", insert.args().get(5));
        assertTrue(db.callsContaining("FROM rbac.user_roles").get(0).args().contains(AssetCareService.MANAGE_PERMISSION),
                "recipients by permission, never by role name");
        var captor = org.mockito.ArgumentCaptor.forClass(AssetIssueReportedEvent.class);
        verify(events).publishEvent(captor.capture());
        assertEquals(List.of(hr), captor.getValue().recipients());
        assertEquals("Dell Latitude (LAP-1)", captor.getValue().assetLabel());
        verify(audit).record(eq("onboarding"), eq("ASSET_ISSUE_REPORTED"), eq("asset"), eq(assetId), any());
    }

    @Test void aSecondOpenReportOnTheSameAssetIsRefused() {
        UUID assetId = UUID.randomUUID();
        FakeJdbc db = reportDb(assetId, UUID.randomUUID(), 1, List.of());
        HrmsException e = assertThrows(HrmsException.class, () -> service(db).report(UUID.randomUUID(), assetId, "LOST", null));
        assertEquals("ASSET_ISSUE_ALREADY_OPEN", e.getErrorCode());
        assertTrue(db.callsContaining("INSERT").isEmpty());
        verifyNoInteractions(events);
    }

    @Test void anUnknownKindOrALongNoteIsRefusedBeforeAnythingIsRead() {
        FakeJdbc db = new FakeJdbc().tables(READY);
        BusinessRuleException kind = assertThrows(BusinessRuleException.class,
                () -> service(db).report(UUID.randomUUID(), UUID.randomUUID(), "STOLEN_BY_ALIENS", null));
        assertEquals("ASSET_ISSUE_KIND_INVALID", kind.getErrorCode());
        BusinessRuleException note = assertThrows(BusinessRuleException.class,
                () -> service(db).report(UUID.randomUUID(), UUID.randomUUID(), "OTHER", "x".repeat(1001)));
        assertEquals("ASSET_ISSUE_NOTE_TOO_LONG", note.getErrorCode());
        assertTrue(db.calls.isEmpty());
    }

    @Test void reportingIsNotReadyWithoutTheTable() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        assertThrows(FeatureNotReady.class, () -> service(db).report(UUID.randomUUID(), UUID.randomUUID(), "LOST", null));
        verifyNoInteractions(events);
    }

    @Test void theNotificationFillsTheCatalogsPlaceholders() {
        var e = new AssetIssueReportedEvent(tenant, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "Asha Rao",
                "Dell Latitude (LAP-1)", "NOT_WORKING", "Won't boot", List.of());
        Map<String, String> v = AssetIssueNotifier.values(e);
        assertEquals("Asha Rao", v.get("employeeName"));
        assertEquals("Dell Latitude (LAP-1)", v.get("assetName"));
        assertEquals("not working", v.get("problem"));
        assertEquals(" Note: Won't boot", v.get("noteText"));
        assertEquals("", AssetIssueNotifier.values(new AssetIssueReportedEvent(tenant, UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), "Asha", "Laptop", "LOST", null, List.of())).get("noteText"));
    }

    // ── HR: list and resolve ────────────────────────────────────────────────

    @Test void theIssueListHidesTheReportersNameWithoutEmployeeRead() {
        FakeJdbc db = new FakeJdbc().tables(READY);
        service(db).issues(null, null, false);
        var q = db.callsContaining("FROM hrms.asset_issue_reports r").get(0);
        assertEquals(false, q.args().get(0), "the name column is switched off in SQL");
        assertEquals(List.of(false, tenant, "OPEN"), q.args(), "OPEN by default");
    }

    @Test void anUnknownStatusFilterIsRefused() {
        FakeJdbc db = new FakeJdbc().tables(READY);
        assertThrows(BusinessRuleException.class, () -> service(db).issues("MAYBE", null, true));
    }

    @Test void aResolvedProblemCannotBeResolvedAgain() {
        FakeJdbc db = new FakeJdbc().tables(READY).on("FOR UPDATE", List.of("RESOLVED"));
        HrmsException e = assertThrows(HrmsException.class, () -> service(db).resolve(UUID.randomUUID(), null, "HR", true));
        assertEquals("ASSET_ISSUE_ALREADY_RESOLVED", e.getErrorCode());
        assertTrue(db.callsContaining("UPDATE hrms.asset_issue_reports").isEmpty());
    }

    @Test void listingAndResolvingAreNotReadyWithoutTheTable() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        assertThrows(FeatureNotReady.class, () -> service(db).issues(null, null, true));
        assertThrows(FeatureNotReady.class, () -> service(db).resolve(UUID.randomUUID(), null, "HR", true));
    }
}
