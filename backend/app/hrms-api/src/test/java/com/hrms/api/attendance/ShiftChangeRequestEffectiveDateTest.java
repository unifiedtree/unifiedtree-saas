package com.hrms.api.attendance;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.dto.ShiftDtos.CreateShiftChangeRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.attendance.service.EmployeeShiftService;
import com.hrms.attendance.service.ShiftChangeRequestService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.notifications.events.ShiftChangeDecidedEvent;
import com.unifiedtree.notifications.events.ShiftChangeSubmittedEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.function.Executable;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Client acceptance case #2: a shift-change request starts on the date the
 * employee chose, not on the day someone approves it; one still pending after
 * that date expires (rejected, employee applies again).
 *
 * <p>Opt-in integration test: only run against a migrated, disposable recovery
 * database. The dates live in columns and the one-pending rule in an index, so
 * the SQL is real; the assignment service is a mock so each test states exactly
 * which date an approval hands it.
 */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class ShiftChangeRequestEffectiveDateTest {
    private final DriverManagerDataSource source = new DriverManagerDataSource(
            System.getenv("RECOVERY_TEST_JDBC_URL"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
    private final JdbcTemplate jdbc = new JdbcTemplate(source);
    private final TransactionTemplate tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    private final EmployeeShiftService shifts = mock(EmployeeShiftService.class);
    private final List<Object> events = new ArrayList<>();
    private final ShiftChangeRequestService service = new ShiftChangeRequestService(jdbc, shifts, events::add);

    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID approver = UUID.randomUUID();
    private final UUID general = UUID.randomUUID();
    private final UUID night = UUID.randomUUID();
    private final LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    @BeforeEach void seed() {
        TenantContext.setTenantId(tenant);
        UUID company = UUID.randomUUID();
        inTenant(() -> jdbc.update("""
                INSERT INTO attendance.shift_policies(id, tenant_id, company_id, name, shift_type, start_time, end_time)
                VALUES (?, ?, ?, 'General', 'FIXED', '09:00', '17:00'), (?, ?, ?, 'Night', 'NIGHT', '22:00', '06:00')
                """, general, tenant, company, night, tenant, company));
        when(shifts.shiftPolicyIdOn(any(), any())).thenReturn(general);
    }

    @AfterEach void cleanup() {
        inTenant(() -> {
            jdbc.update("DELETE FROM attendance.shift_change_requests WHERE tenant_id = ?", tenant);
            return jdbc.update("DELETE FROM attendance.shift_policies WHERE tenant_id = ?", tenant);
        });
        TenantContext.clear();
    }

    @Test void approvalAssignsTheShiftFromTheDateTheEmployeeChose() {
        LocalDate monday = today.plusDays(4);
        ShiftChangeRequestResponse created = request(monday);
        assertEquals(monday, created.requestedEffectiveDate());
        assertNull(created.appliedEffectiveDate());
        assertEquals("Night", created.requestedShiftName());
        assertEquals(monday, ((ShiftChangeSubmittedEvent) events.get(0)).effectiveDate());

        ShiftChangeRequestResponse approved = decide(created.id(), true);

        verify(shifts).assignShift(employee, new AssignShiftRequest(night, monday));
        assertEquals("APPROVED", approved.status());
        assertEquals(monday, approved.appliedEffectiveDate());
        assertEquals(monday, column(created.id(), "applied_effective_date"));
        assertEquals(monday, ((ShiftChangeDecidedEvent) events.get(1)).effectiveDate());
    }

    @Test void aRequestStillPendingAfterItsStartDateIsRejectedNotApproved() {
        LocalDate passed = today.minusDays(2);
        UUID id = insertPending(employee, passed);

        BusinessRuleException error = approveExpecting(id);

        assertEquals("SHIFT_CHANGE_EXPIRED", error.getErrorCode());
        assertEquals("REJECTED", status(id));
        assertTrue(note(id).startsWith("Expired: the start date (" + passed.getDayOfMonth() + " "), note(id));
        verify(shifts, never()).assignShift(any(), any());
        ShiftChangeDecidedEvent told = (ShiftChangeDecidedEvent) events.get(events.size() - 1);
        assertFalse(told.approved());
        assertEquals(note(id), told.comment());
    }

    @Test void decideKeepsTheExpiryWhenItReportsIt() throws Exception {
        // The rejection above must commit even though decide() throws: that is
        // the noRollbackFor on the real (proxied) method.
        Transactional tx = ShiftChangeRequestService.class
                .getMethod("decide", UUID.class, UUID.class, ShiftChangeDecisionRequest.class)
                .getAnnotation(Transactional.class);
        assertNotNull(tx);
        assertTrue(Arrays.asList(tx.noRollbackFor()).contains(ShiftChangeRequestService.RequestExpiredException.class));
    }

    @Test void theExpiryRunRejectsOnlyRequestsWhoseDateHasPassed() {
        UUID passed = insertPending(employee, today.minusDays(1));
        UUID dueToday = insertPending(UUID.randomUUID(), today);
        UUID future = insertPending(UUID.randomUUID(), today.plusDays(3));
        UUID undated = insertPending(UUID.randomUUID(), null);

        int expired = inTenant(() -> service.expirePassedForTenant(tenant));

        assertEquals(1, expired);
        assertEquals("REJECTED", status(passed));
        assertEquals("PENDING", status(dueToday));
        assertEquals("PENDING", status(future));
        assertEquals("PENDING", status(undated));
        assertEquals(1, events.size());
        assertFalse(((ShiftChangeDecidedEvent) events.get(0)).approved());
        assertEquals(0, (int) inTenant(() -> service.expirePassedForTenant(tenant)), "a second run finds nothing");
    }

    @Test void anExpiredRequestDoesNotBlockApplyingAgain() {
        UUID old = insertPending(employee, today.minusDays(3));
        ShiftChangeRequestResponse fresh = request(today.plusDays(2));
        assertEquals("PENDING", fresh.status());
        assertEquals("REJECTED", status(old));
    }

    @Test void theApproverQueueLeavesOutExpiredRequests() {
        insertPending(employee, today.minusDays(1));
        UUID live = insertPending(UUID.randomUUID(), today.plusDays(1));
        UUID undated = insertPending(UUID.randomUUID(), null);
        List<UUID> queue = inTenant(() -> service.listPending()).stream().map(ShiftChangeRequestResponse::id).toList();
        assertEquals(2, queue.size(), queue.toString());
        assertTrue(queue.containsAll(List.of(live, undated)));
    }

    @Test void requestsFromOlderAppBuildsStartOnTheDayTheyAreApproved() {
        UUID legacy = insertPending(employee, null);
        assertEquals(today, decide(legacy, true).appliedEffectiveDate());
        verify(shifts).assignShift(employee, new AssignShiftRequest(night, today));
    }

    @Test void datesOutsideTodayToAYearAheadAreRefused() {
        assertCode("SHIFT_CHANGE_DATE_PAST", () -> request(today.minusDays(1)));
        assertCode("SHIFT_CHANGE_DATE_TOO_FAR", () -> request(today.plusYears(1).plusDays(1)));
        assertEquals(0, count());
        assertEquals(today, request(today).requestedEffectiveDate());
    }

    @Test void aReasonOfTenToFiveHundredCharactersIsRequired() {
        for (String bad : Arrays.asList(null, "", "   ", "too short", "x".repeat(501))) {
            assertCode("SHIFT_CHANGE_REASON_INVALID", () -> inTenant(() ->
                    service.create(employee, new CreateShiftChangeRequest(night, bad, today.plusDays(1)))));
        }
        assertEquals(0, count());
        ShiftChangeRequestResponse ok = inTenant(() ->
                service.create(employee, new CreateShiftChangeRequest(night, "   Evening classes   ", today.plusDays(1))));
        assertEquals("Evening classes", ok.reason());
    }

    @Test void aDateBeforeAnAlreadyScheduledChangeIsRefusedWithThatDate() {
        LocalDate scheduled = today.plusDays(10);
        when(shifts.nextAssignmentStartAfter(employee, today.plusDays(3))).thenReturn(scheduled);
        BusinessRuleException refused = assertCode("SHIFT_CHANGE_DATE_CONFLICT", () -> request(today.plusDays(3)));
        assertTrue(refused.getMessage().contains(scheduled.getDayOfMonth() + " "), refused.getMessage());
        assertEquals(0, count());
    }

    @Test void aChangeScheduledAfterSubmissionBlocksApproval() {
        LocalDate asked = today.plusDays(3);
        UUID id = request(asked).id();
        // HR schedules another change later in the week after the request came in.
        when(shifts.nextAssignmentStartAfter(employee, asked)).thenReturn(today.plusDays(5));
        BusinessRuleException refused = assertCode("SHIFT_CHANGE_DATE_CONFLICT", () -> decide(id, true));
        assertTrue(refused.getMessage().contains("apply again"), refused.getMessage());
        assertEquals("PENDING", status(id));
        verify(shifts, never()).assignShift(any(), any());
    }

    @Test void theSameShiftCheckLooksAtTheShiftInForceOnTheStartDate() {
        LocalDate later = today.plusDays(6);
        when(shifts.shiftPolicyIdOn(employee, later)).thenReturn(night);
        assertCode("SHIFT_CHANGE_SAME", () -> request(later));
        // Stored "current" shift is the one the change replaces on that date.
        when(shifts.shiftPolicyIdOn(employee, later)).thenReturn(general);
        assertEquals("General", request(later).currentShiftName());
    }

    @Test void nobodyDecidesTheirOwnRequest() {
        UUID id = request(today.plusDays(2)).id();
        assertCode("SELF_APPROVAL_NOT_ALLOWED", () -> inTenant(() ->
                service.decide(id, employee, new ShiftChangeDecisionRequest(true, null))));
        assertEquals("PENDING", status(id));
    }

    @Test void rejectionAssignsNothingAndRecordsNoStartDate() {
        UUID id = request(today.plusDays(2)).id();
        ShiftChangeRequestResponse rejected = decide(id, false);
        assertEquals("REJECTED", rejected.status());
        assertNull(rejected.appliedEffectiveDate());
        verify(shifts, never()).assignShift(any(), any());
    }

    @Test void theDatabaseHoldsOnePendingRequestPerEmployee() {
        insertPending(employee, today.plusDays(1));
        assertThrows(DuplicateKeyException.class, () -> insertPending(employee, today.plusDays(2)));
        assertCode("SHIFT_CHANGE_PENDING_EXISTS", () -> request(today.plusDays(3)));
    }

    @Test void twoSubmitsRacingPastTheCountStillStoreOne() throws Exception {
        CountDownLatch inserted = new CountDownLatch(1);
        CompletableFuture<Void> other = holdOpen(() -> insertRow(employee, today.plusDays(1)), inserted);
        assertTrue(inserted.await(10, TimeUnit.SECONDS));
        long started = System.nanoTime();
        assertCode("SHIFT_CHANGE_PENDING_EXISTS", () -> request(today.plusDays(2)));
        other.get(10, TimeUnit.SECONDS);
        assertTrue(elapsedMillis(started) >= 1000, "second submit should have waited on the first");
        assertEquals(1, count());
    }

    @Test void twoApproversRacingOnlyOneWins() throws Exception {
        UUID id = request(today.plusDays(2)).id();
        CountDownLatch decided = new CountDownLatch(1);
        CompletableFuture<Void> other = holdOpen(() -> jdbc.update(
                "UPDATE attendance.shift_change_requests SET status = 'REJECTED', decided_at = now() WHERE id = ?", id),
                decided);
        assertTrue(decided.await(10, TimeUnit.SECONDS));
        long started = System.nanoTime();
        assertCode("SHIFT_CHANGE_NOT_PENDING", () -> decide(id, true));
        other.get(10, TimeUnit.SECONDS);
        assertTrue(elapsedMillis(started) >= 1000, "approval should have waited on the rejection");
        assertEquals("REJECTED", status(id));
        verify(shifts, never()).assignShift(any(), any());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private ShiftChangeRequestResponse request(LocalDate startDate) {
        return inTenant(() -> service.create(employee, new CreateShiftChangeRequest(night, "Family commitments", startDate)));
    }

    private ShiftChangeRequestResponse decide(UUID id, boolean approved) {
        return inTenant(() -> service.decide(id, approver, new ShiftChangeDecisionRequest(approved, null)));
    }

    /** Approve, committing when the request turns out expired — what noRollbackFor does in the app. */
    private BusinessRuleException approveExpecting(UUID id) {
        BusinessRuleException[] error = new BusinessRuleException[1];
        tx.executeWithoutResult(s -> {
            bind();
            try {
                service.decide(id, approver, new ShiftChangeDecisionRequest(true, null));
            } catch (ShiftChangeRequestService.RequestExpiredException e) {
                error[0] = e;
            }
        });
        assertNotNull(error[0], "expected the approval to be refused as expired");
        return error[0];
    }

    private UUID insertPending(UUID who, LocalDate requested) {
        return inTenant(() -> insertRow(who, requested));
    }

    private UUID insertRow(UUID who, LocalDate requested) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO attendance.shift_change_requests
                    (id, tenant_id, employee_id, current_shift_policy_id, requested_shift_policy_id, reason, status, requested_effective_date)
                VALUES (?, ?, ?, ?, ?, 'Family commitments', 'PENDING', ?)
                """, id, tenant, who, general, night, requested);
        return id;
    }

    /** Runs {@code work} in its own transaction, signals, then holds the transaction open for 2.5 s before committing. */
    private CompletableFuture<Void> holdOpen(Runnable work, CountDownLatch done) {
        return CompletableFuture.runAsync(() -> tx.executeWithoutResult(s -> {
            bind();
            work.run();
            done.countDown();
            try { Thread.sleep(2500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }));
    }

    private String status(UUID id) {
        return inTenant(() -> jdbc.queryForObject(
                "SELECT status FROM attendance.shift_change_requests WHERE id = ?", String.class, id));
    }

    private String note(UUID id) {
        return inTenant(() -> jdbc.queryForObject(
                "SELECT decision_note FROM attendance.shift_change_requests WHERE id = ?", String.class, id));
    }

    private LocalDate column(UUID id, String name) {
        return inTenant(() -> jdbc.queryForObject(
                "SELECT " + name + " FROM attendance.shift_change_requests WHERE id = ?", LocalDate.class, id));
    }

    private int count() {
        return inTenant(() -> jdbc.queryForObject(
                "SELECT count(*) FROM attendance.shift_change_requests WHERE tenant_id = ?", Integer.class, tenant));
    }

    private BusinessRuleException assertCode(String code, Executable call) {
        BusinessRuleException error = assertThrows(BusinessRuleException.class, call);
        assertEquals(code, error.getErrorCode(), error.getMessage());
        return error;
    }

    private <T> T inTenant(Supplier<T> work) {
        return tx.execute(s -> {
            bind();
            return work.get();
        });
    }

    private void bind() {
        jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenant.toString());
    }

    private static long elapsedMillis(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }
}
