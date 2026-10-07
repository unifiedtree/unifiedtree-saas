package com.hrms.api;

import com.hrms.api.access.RecordCompanyGuard;
import com.hrms.api.advance.AdvanceController;
import com.hrms.api.advance.AdvanceReadService;
import com.hrms.api.attendance.ShiftController;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.document.DocumentController;
import com.hrms.api.employee.EmployeeRecordAccess;
import com.hrms.api.expense.ExpenseClaimDetails;
import com.hrms.api.expense.ExpenseController;
import com.hrms.api.expense.ExpenseReceipts;
import com.hrms.api.fnf.FnfController;
import com.hrms.api.fnf.FnfReadService;
import com.hrms.api.hiring.HiringController;
import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.api.leave.EmployeeLeaveController;
import com.hrms.api.leave.LeaveController;
import com.hrms.api.letters.LetterController;
import com.hrms.api.letters.LetterDistributionController;
import com.hrms.api.letters.LetterDistributionService;
import com.hrms.api.letters.LetterExtras;
import com.hrms.api.workforce.EmployeeRecordQueries;
import com.hrms.api.workforce.WorkforceController;
import com.hrms.advance.service.AdvanceService;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.attendance.service.ShiftChangeRequestService;
import com.hrms.attendance.service.EmployeeShiftService;
import com.hrms.attendance.service.ShiftHistoryService;
import com.unifiedtree.audit.AuditService;
import com.hrms.core.dto.ListDateRange;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.GlobalExceptionHandler;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.document.service.DocumentService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.expense.enums.ExpenseStatus;
import com.hrms.expense.service.ExpensePolicyService;
import com.hrms.expense.service.ExpenseService;
import com.hrms.fnf.enums.FnfStatus;
import com.hrms.fnf.service.FnfService;
import com.hrms.hiring.service.HiringService;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.LeaveTypeService;
import com.hrms.letters.service.LetterGenerationService;
import com.hrms.api.letters.LetterIssueService;
import com.hrms.letters.service.LetterTemplateService;
import com.unifiedtree.rbac.company.CompanyAccessService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Calendar everywhere (owner + client, 7 Oct 2026): the paged lists take an optional
 * {@code ?from=&to=} (India days, both included). For each list: without them it is today's
 * call exactly; with them the range reaches the right query (and the right date); a broken
 * range is a 400 with a plain message before anything is read; the company and team scope
 * the list had is kept.
 */
class ListDateRangeParamsTest {

    static final String FROM = "2026-10-01", TO = "2026-10-07";
    static final LocalDate F = LocalDate.of(2026, 10, 1), T = LocalDate.of(2026, 10, 7);
    /** 1 Oct 00:00 IST and 8 Oct 00:00 IST. */
    static final Instant START = Instant.parse("2026-09-30T18:30:00Z"), END = Instant.parse("2026-10-07T18:30:00Z");

    final UUID tenant = UUID.randomUUID(), me = UUID.randomUUID(), company = UUID.randomUUID(), person = UUID.randomUUID();
    final Pageable page = PageRequest.of(0, 20);

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    static <T> PageResponse<T> none() { return new PageResponse<>(List.of(), 0, 20, 0, 0, true); }

    Jwt jwt(String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).claim("permissions", List.of(permissions)).build();
    }

    /** A broken range: 400 INVALID_DATE_RANGE with this message. */
    static void refused(String message, Executable call) {
        HrmsException e = assertThrows(HrmsException.class, call);
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals(ListDateRange.ERROR_CODE, e.getErrorCode());
        assertEquals(message, e.getMessage());
    }

    static final String BACKWARDS = "The start date must be on or before the end date.";
    static final String TOO_LONG = "Pick 366 days or fewer. This range is 367 days.";

    // ── Leave ───────────────────────────────────────────────────────────────

    @Nested class Leave {
        final LeaveService leave = mock(LeaveService.class);
        final LeaveController controller = new LeaveController(leave, mock(LeaveTypeService.class), mock(EmployeeRepository.class),
                mock(WorkforceDepartmentRepository.class), mock(ApproverFallbackResolver.class));
        final Authentication hr = new TestingAuthenticationToken("hr", null, "hrms.leave.approve.l1", "hrms.leave.approve.l2");
        final Authentication manager = new TestingAuthenticationToken("m", null, "hrms.leave.approve.l1");

        @BeforeEach void stubs() {
            when(leave.getMyLeaves(any(), any())).thenReturn(none());
            when(leave.getMyLeaves(any(), any(), any(), any())).thenReturn(none());
            when(leave.getAllDecided(any(Pageable.class))).thenReturn(none());
            when(leave.getAllDecided(any(), any(), any())).thenReturn(none());
            when(leave.getDecidedApprovalsForManager(any(), any(Pageable.class))).thenReturn(none());
            when(leave.getDecidedOverlapping(any(), any(), any(), any(), any(), any())).thenReturn(none());
        }

        @Test void myRequestsWithoutARangeAreAsBefore() {
            controller.myLeaves(jwt(), page, null, null);
            verify(leave).getMyLeaves(me, page);
            verify(leave, never()).getMyLeaves(any(), any(), any(), any());
        }

        @Test void myRequestsKeepToLeaveOverlappingTheRange() {
            controller.myLeaves(jwt(), page, FROM, TO);
            verify(leave).getMyLeaves(me, F, T, page);
            verify(leave, never()).getMyLeaves(any(), any(Pageable.class));
        }

        @Test void myRequestsRefuseABrokenRange() {
            refused(BACKWARDS, () -> controller.myLeaves(jwt(), page, TO, FROM));
            refused(TOO_LONG, () -> controller.myLeaves(jwt(), page, "2026-01-01", "2027-01-02"));
            verifyNoInteractions(leave);
        }

        @Test void decidedWithoutARangeIsAsBefore() {
            controller.approvalsHistory(jwt(), hr, page, null, null, null);
            verify(leave).getAllDecided(page);
            verify(leave).decidedCounts(null);
            verify(leave, never()).getDecidedOverlapping(any(), any(), any(), any(), any(), any());
        }

        @Test void decidedForHrKeepsTheWorkspaceAndTheStatus() {
            controller.approvalsHistory(jwt(), hr, page, "APPROVED", FROM, TO);
            verify(leave).getDecidedOverlapping(null, null, com.hrms.core.enums.ApprovalStatus.APPROVED, F, T, page);
            verify(leave).decidedCountsOverlapping(null, null, F, T);
            verify(leave, never()).getAllDecided(any(Pageable.class));
        }

        @Test void decidedForACompanyScopedHrApproverKeepsTheirCompany() {
            CompanyAccessService access = mock(CompanyAccessService.class);
            when(access.scopedViewCompanyId()).thenReturn(company);
            ReflectionTestUtils.setField(controller, "companyAccess", access);
            controller.approvalsHistory(jwt(), hr, page, null, FROM, TO);
            verify(leave).getDecidedOverlapping(null, company, null, F, T, page);
            verify(leave).decidedCountsOverlapping(null, company, F, T);
        }

        @Test void decidedForAManagerKeepsTheirTeam() {
            controller.approvalsHistory(jwt(), manager, page, null, FROM, TO);
            verify(leave).getDecidedOverlapping(me, null, null, F, T, page);
            verify(leave).decidedCountsOverlapping(me, null, F, T);
        }

        @Test void decidedCountsThatFailLeaveTheListWorking() {
            when(leave.decidedCountsOverlapping(any(), any(), any(), any()))
                    .thenThrow(new org.springframework.dao.DataRetrievalFailureException("x"));
            var body = controller.approvalsHistory(jwt(), hr, page, null, FROM, TO).getBody();
            assertNotNull(body);
            assertNull(body.counts());
        }

        @Test void decidedRefusesABrokenRange() {
            refused(BACKWARDS, () -> controller.approvalsHistory(jwt(), hr, page, null, TO, FROM));
            refused("Pick both a start date and an end date, or neither.",
                    () -> controller.approvalsHistory(jwt(), hr, page, null, FROM, null));
            verifyNoInteractions(leave);
        }
    }

    @Nested class EmployeeLeave {
        final LeaveService leave = mock(LeaveService.class);
        final EmployeeRepository employees = mock(EmployeeRepository.class);
        final EmployeeRecordAccess access = mock(EmployeeRecordAccess.class);
        final EmployeeLeaveController controller = new EmployeeLeaveController(leave, employees, access);
        final Authentication auth = new TestingAuthenticationToken("hr", null, "hrms.leave.employee.read");
        final Pageable newestFirst = PageRequest.of(0, 10, Sort.by(Sort.Order.desc("startDate"), Sort.Order.desc("createdAt")));

        @BeforeEach void stubs() {
            when(employees.findById(person)).thenReturn(Optional.of(new Employee()));
            when(leave.getMyLeaves(any(), any())).thenReturn(none());
            when(leave.getMyLeaves(any(), any(), any(), any())).thenReturn(none());
        }

        @Test void withoutARangeAsBefore() {
            controller.requests(person, 0, 10, null, null, jwt(), auth);
            verify(leave).getMyLeaves(person, newestFirst);
        }

        @Test void aRangeKeepsTheOrderAndOverlaps() {
            controller.requests(person, 0, 10, FROM, TO, jwt(), auth);
            verify(leave).getMyLeaves(person, F, T, newestFirst);
        }

        @Test void whoMaySeeWhomIsCheckedAsBefore() {
            doThrow(new AccessDeniedException("no")).when(access).assertCanView(eq(person), any(), any(), any(), any());
            assertThrows(AccessDeniedException.class, () -> controller.requests(person, 0, 10, FROM, TO, jwt(), auth));
            verifyNoInteractions(leave);
        }

        @Test void aBrokenRangeIsRefused() {
            refused(TOO_LONG, () -> controller.requests(person, 0, 10, "2026-01-01", "2027-01-02", jwt(), auth));
            verifyNoInteractions(leave);
        }
    }

    // ── Expenses ────────────────────────────────────────────────────────────

    @Nested class Expenses {
        final ExpenseService expense = mock(ExpenseService.class);
        final ExpenseController controller;
        {
            ExpenseClaimDetails passThrough = mock(ExpenseClaimDetails.class);
            when(passThrough.add(anyList())).thenAnswer(inv -> inv.getArgument(0));
            controller = new ExpenseController(expense, mock(ExpensePolicyService.class), mock(EmployeeRepository.class),
                    mock(ExpenseReceipts.class), mock(EmployeeRecordAccess.class), passThrough, mock(AuditService.class));
        }
        final List<ExpenseStatus> both = List.of(ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED);

        @BeforeEach void stubs() {
            when(expense.getMyClaims(any(), any())).thenReturn(none());
            when(expense.getMyClaims(any(), any(), any(), any())).thenReturn(none());
            when(expense.getByStatuses(any(), any())).thenReturn(none());
            when(expense.getByStatuses(any(), any(), any(), any())).thenReturn(none());
            when(expense.getPendingForApprover(any(), any(), any())).thenReturn(none());
            when(expense.getPendingForApprover(any(), any(), any(), any(), any())).thenReturn(none());
        }

        @Test void myClaims() {
            controller.myClaims(jwt(), page, null, null);
            verify(expense).getMyClaims(me, page);
            controller.myClaims(jwt(), page, FROM, TO);
            verify(expense).getMyClaims(me, START, END, page);
            refused(BACKWARDS, () -> controller.myClaims(jwt(), page, TO, FROM));
            verifyNoMoreInteractions(expense);
        }

        @Test void approvalsKeepTheirScope() {
            controller.pendingApprovals(jwt("hrms.expense.reimbursement"), null, page, null, null);
            verify(expense).getByStatuses(both, page);
            // Finance / admin: the workspace; a plain approver: the claims routed to them.
            controller.pendingApprovals(jwt("hrms.expense.reimbursement"), List.of(ExpenseStatus.APPROVED), page, FROM, TO);
            verify(expense).getByStatuses(List.of(ExpenseStatus.APPROVED), START, END, page);
            controller.pendingApprovals(jwt("hrms.expense.claim.approve"), null, page, FROM, TO);
            verify(expense).getPendingForApprover(me, both, START, END, page);
            refused(TOO_LONG, () -> controller.pendingApprovals(jwt("hrms.expense.claim.approve"), null, page, "2026-01-01", "2027-01-02"));
            verifyNoMoreInteractions(expense);
        }
    }

    // ── Advances ────────────────────────────────────────────────────────────

    @Nested class Advances {
        final AdvanceService advances = mock(AdvanceService.class);
        final AdvanceReadService reads = mock(AdvanceReadService.class);
        final AdvanceController controller = new AdvanceController(advances, mock(EmployeeRepository.class),
                mock(com.hrms.api.advance.AdvanceRecoveryService.class), mock(ApproverFallbackResolver.class), reads,
                mock(WorkforceDepartmentRepository.class), mock(com.hrms.api.payroll.PayrollService.class), mock(JdbcTemplate.class));

        @Test void withoutARangeTheListIsAsBefore() {
            when(advances.getPendingForApprover(any(), any(), any())).thenReturn(none());
            controller.listRequests(null, null, null, page, jwt("hrms.advance.read"), null, null);
            verify(advances).getPendingForApprover(eq(me), any(), eq(page));
            verifyNoInteractions(reads);
        }

        @Test void aRangeGoesThroughTheFilteredListInTheSameScope() {
            when(reads.filteredIds(any(), any(), any(), any(), any(), any(), anyInt(), anyInt()))
                    .thenReturn(new AdvanceReadService.IdPage(List.of(), 0));
            ArgumentCaptor<ListDateRange> range = ArgumentCaptor.forClass(ListDateRange.class);
            controller.listRequests(null, null, null, page, jwt("hrms.advance.read"), FROM, TO);
            verify(reads).filteredIds(eq(tenant), eq(me), isNull(), isNull(), isNull(), range.capture(), eq(0), eq(20));
            assertEquals(new ListDateRange(F, T), range.getValue());
            controller.listRequests(com.hrms.advance.enums.AdvanceStatus.REQUESTED, null, null, page,
                    jwt("hrms.advance.read", "hrms.advance.disburse"), FROM, TO);
            verify(reads).filteredIds(eq(tenant), isNull(), eq(List.of("REQUESTED")), isNull(), isNull(), any(), eq(0), eq(20));
            verify(advances, never()).getPendingForApprover(any(), any(), any());
            verify(advances, never()).getByStatuses(any(), any());
        }

        @Test void aBrokenRangeIsRefused() {
            refused(BACKWARDS, () -> controller.listRequests(null, null, null, page, jwt("hrms.advance.read"), TO, FROM));
            verifyNoInteractions(reads, advances);
        }

        @Test void theSqlKeepsToTheRequestDayInIndia() {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
            new AdvanceReadService(jdbc).filteredIds(tenant, me, null, null, null, new ListDateRange(F, T), 0, 20);
            ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
            ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
            verify(jdbc).queryForObject(sql.capture(), eq(Long.class), args.capture());
            assertTrue(sql.getValue().contains("AND ar.created_at >= ? AND ar.created_at < ?"), sql.getValue());
            Object[] bound = args.getValue();
            assertEquals(START, ((OffsetDateTime) bound[bound.length - 2]).toInstant());
            assertEquals(END, ((OffsetDateTime) bound[bound.length - 1]).toInstant());
        }

        @Test void theSqlWithoutARangeIsUnchanged() {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
            new AdvanceReadService(jdbc).filteredIds(tenant, me, null, AdvanceReadService.Phase.RECOVERING, null, 0, 20);
            ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
            verify(jdbc).queryForObject(sql.capture(), eq(Long.class), any(Object[].class));
            assertFalse(sql.getValue().contains("created_at >="), sql.getValue());
        }
    }

    // ── Full & final ────────────────────────────────────────────────────────

    @Nested class FullAndFinal {
        final FnfService fnf = mock(FnfService.class);
        final RecordCompanyGuard guard = mock(RecordCompanyGuard.class);
        final FnfController controller = new FnfController(fnf, mock(EmployeeRepository.class), mock(FnfReadService.class),
                mock(WorkforceDepartmentRepository.class), mock(JdbcTemplate.class));

        @BeforeEach void stubs() {
            ReflectionTestUtils.setField(controller, "recordGuard", guard);
            when(fnf.getSettlements(any(), any(), any())).thenReturn(none());
            when(fnf.getSettlements(any(), any(), any(), any(), any())).thenReturn(none());
        }

        @Test void byLastWorkingDay() {
            controller.list(null, null, page, null, null);
            verify(fnf).getSettlements(null, null, page);
            controller.list(List.of(FnfStatus.PAID), person, page, FROM, TO);
            verify(fnf).getSettlements(List.of(FnfStatus.PAID), person, F, T, page);
            // The person must still be in a company the caller may work in.
            verify(guard).checkEmployee(person);
            refused(BACKWARDS, () -> controller.list(null, null, page, TO, FROM));
            verifyNoMoreInteractions(fnf);
        }
    }

    // ── Exits ───────────────────────────────────────────────────────────────

    @Nested class Exits {
        final EmployeeRecordQueries queries = mock(EmployeeRecordQueries.class);
        final CompanyAccessService access = mock(CompanyAccessService.class);
        final WorkforceController controller = new WorkforceController(null, null, null, null, null, null, null, null, null, null, null);

        @BeforeEach void wire() {
            ReflectionTestUtils.setField(controller, "recordQueries", queries);
            ReflectionTestUtils.setField(controller, "companyAccess", access);
            when(access.listCompanyId(isNull())).thenReturn(company);   // the selected company (X-Company-Id)
        }

        @Test void byLastWorkingDayInTheSelectedCompany() {
            controller.employeeExits(null, "EXITED", "asha", 0, 50, null, null);
            verify(queries).exits(company, "EXITED", "asha", 0, 50);
            controller.employeeExits(null, "EXITED", "asha", 0, 50, FROM, TO);
            verify(queries).exits(company, "EXITED", "asha", new ListDateRange(F, T), 0, 50);
            refused(TOO_LONG, () -> controller.employeeExits(null, null, null, 0, 50, "2026-01-01", "2027-01-02"));
            verifyNoMoreInteractions(queries);
        }

        @Test @SuppressWarnings("unchecked") void theSqlBindsTheDaysLastInBothQueries() {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            when(jdbc.queryForObject(startsWith("SELECT count(*)"), eq(Long.class), any(Object[].class))).thenReturn(0L);
            when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
            new EmployeeRecordQueries(jdbc).exits(null, "EXITED", null, new ListDateRange(F, T), 0, 50);
            ArgumentCaptor<String> count = ArgumentCaptor.forClass(String.class);
            ArgumentCaptor<Object[]> countArgs = ArgumentCaptor.forClass(Object[].class);
            verify(jdbc).queryForObject(count.capture(), eq(Long.class), countArgs.capture());
            assertTrue(count.getValue().contains("AND e.last_working_day BETWEEN ? AND ?"), count.getValue());
            assertArrayEquals(new Object[]{tenant, null, null, null, null, null, null, "EXITED", F, T}, countArgs.getValue());
            ArgumentCaptor<String> rows = ArgumentCaptor.forClass(String.class);
            ArgumentCaptor<Object[]> rowArgs = ArgumentCaptor.forClass(Object[].class);
            verify(jdbc).query(rows.capture(), any(RowMapper.class), rowArgs.capture());
            assertTrue(rows.getValue().contains("AND e.last_working_day BETWEEN ? AND ?"), rows.getValue());
            assertArrayEquals(new Object[]{tenant, null, null, null, null, null, null, "EXITED", F, T, 50, 0L}, rowArgs.getValue());
        }

        @Test @SuppressWarnings("unchecked") void theSqlWithoutARangeIsUnchanged() {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            when(jdbc.queryForObject(startsWith("SELECT count(*)"), eq(Long.class), any(Object[].class))).thenReturn(0L);
            when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
            new EmployeeRecordQueries(jdbc).exits(null, "EXITED", null, 0, 50);
            ArgumentCaptor<String> count = ArgumentCaptor.forClass(String.class);
            verify(jdbc).queryForObject(count.capture(), eq(Long.class), any(Object[].class));
            assertFalse(count.getValue().contains("last_working_day BETWEEN"), count.getValue());
        }
    }

    // ── Hiring ──────────────────────────────────────────────────────────────

    @Nested class Hiring {
        final HiringService hiring = mock(HiringService.class);
        final CompanyAccessService access = mock(CompanyAccessService.class);
        final HiringController controller = new HiringController(hiring, mock(EmployeeRepository.class),
                mock(com.hrms.employee.workforce.repository.WorkforceCompanyRepository.class),
                mock(com.hrms.api.hiring.CandidateConversionService.class), mock(com.hrms.api.hiring.ConversionOnboardingStarter.class));

        @BeforeEach void wire() {
            ReflectionTestUtils.setField(controller, "companyAccess", access);
            when(access.listCompanyId(isNull())).thenReturn(company);
            when(hiring.getOffers(any(), any())).thenReturn(none());
            when(hiring.getOffers(any(), any(), any(), any())).thenReturn(none());
            when(hiring.getRequisitions(any(), any())).thenReturn(none());
            when(hiring.getRequisitions(any(), any(), any(), any())).thenReturn(none());
        }

        @Test void offersByTheDayTheyWereMadeInTheSelectedCompany() {
            controller.listOffers(null, page, null, null);
            verify(hiring).getOffers(company, page);
            controller.listOffers(null, page, FROM, TO);
            verify(hiring).getOffers(company, START, END, page);
            refused(BACKWARDS, () -> controller.listOffers(null, page, TO, FROM));
            verifyNoMoreInteractions(hiring);
        }

        @Test void requisitionsByTheDayTheyWereOpenedInTheSelectedCompany() {
            controller.listRequisitions(null, page, null, null);
            verify(hiring).getRequisitions(company, page);
            controller.listRequisitions(null, page, FROM, TO);
            verify(hiring).getRequisitions(company, START, END, page);
            refused(TOO_LONG, () -> controller.listRequisitions(null, page, "2026-01-01", "2027-01-02"));
            verifyNoMoreInteractions(hiring);
        }
    }

    // ── Letters ─────────────────────────────────────────────────────────────

    @Nested class Letters {
        final LetterGenerationService generation = mock(LetterGenerationService.class);
        final LetterController letters = new LetterController(mock(LetterTemplateService.class), generation,
                mock(LetterIssueService.class), mock(LetterExtras.class));
        final LetterDistributionService distributions = mock(LetterDistributionService.class);
        final LetterDistributionController jobs = new LetterDistributionController(distributions,
                mock(com.hrms.api.letters.DistributionScheduleService.class));

        @Test void generatedByTheDayTheyWereGenerated() {
            letters.listGenerated(null, page, null, null);
            verify(generation).listGenerated(page);
            letters.listGenerated(null, page, FROM, TO);
            verify(generation).listGenerated(null, START, END, page);
            letters.listGenerated(person, page, FROM, TO);   // one person's (the employee workspace)
            verify(generation).listGenerated(person, START, END, page);
            refused(BACKWARDS, () -> letters.listGenerated(null, page, TO, FROM));
            verifyNoMoreInteractions(generation);
        }

        @Test void distributionsByTheDayTheyWereStarted() {
            jobs.list(page, null, null);
            verify(distributions).list(page);
            jobs.list(page, FROM, TO);
            verify(distributions).list(START, END, page);
            refused(TOO_LONG, () -> jobs.list(page, "2026-01-01", "2027-01-02"));
            verifyNoMoreInteractions(distributions);
        }

        @Test void aBrokenRangeIsA400WithAPlainMessage() throws Exception {
            MockMvc mvc = MockMvcBuilders.standaloneSetup(jobs).setControllerAdvice(new GlobalExceptionHandler())
                    .setCustomArgumentResolvers(new org.springframework.data.web.PageableHandlerMethodArgumentResolver()).build();
            mvc.perform(get("/v1/letters/distributions").param("from", TO).param("to", FROM))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value(BACKWARDS));
            mvc.perform(get("/v1/letters/distributions").param("from", "07/10/2026").param("to", TO))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Dates must be written as yyyy-MM-dd, for example 2026-10-07."));
            verifyNoInteractions(distributions);
        }
    }

    // ── Documents ───────────────────────────────────────────────────────────

    @Nested class Documents {
        final DocumentService documents = mock(DocumentService.class);
        final RecordCompanyGuard guard = mock(RecordCompanyGuard.class);
        final DocumentController controller = new DocumentController(documents, mock(EmployeeRepository.class),
                mock(com.unifiedtree.settings.branding.DocumentStorage.class), mock(JdbcTemplate.class));

        @Test void byTheDayTheyWereUploadedForSomeoneInAnAllowedCompany() {
            ReflectionTestUtils.setField(controller, "recordGuard", guard);
            when(documents.getEmployeeDocuments(any(), any())).thenReturn(none());
            when(documents.getEmployeeDocuments(any(), any(), any(), any())).thenReturn(none());
            controller.employeeDocuments(person, page, null, null);
            verify(documents).getEmployeeDocuments(person, page);
            controller.employeeDocuments(person, page, FROM, TO);
            verify(documents).getEmployeeDocuments(person, START, END, page);
            verify(guard, times(2)).checkEmployee(person);
            doThrow(new AccessDeniedException("other company")).when(guard).checkEmployee(person);
            assertThrows(AccessDeniedException.class, () -> controller.employeeDocuments(person, page, FROM, TO));
            refused(BACKWARDS, () -> controller.employeeDocuments(person, page, TO, FROM));
            verifyNoMoreInteractions(documents);
        }
    }

    // ── Shift change requests, decided ──────────────────────────────────────

    @Nested class DecidedShiftRequests {
        final ShiftChangeRequestService requests = mock(ShiftChangeRequestService.class);
        final TeamEmployeeScope team = mock(TeamEmployeeScope.class);
        final ShiftController controller = new ShiftController(mock(EmployeeShiftService.class), requests, team, mock(ShiftHistoryService.class));
        final UUID teammate = UUID.randomUUID(), stranger = UUID.randomUUID();

        ShiftChangeRequestResponse decided(UUID employee) {
            return new ShiftChangeRequestResponse(UUID.randomUUID(), employee, "Team Member", "EMP-0001",
                    null, "General", UUID.randomUUID(), "Night",
                    "Evening classes", "APPROVED", me, "Fine", Instant.now(), Instant.now(), F, F, "HR Manager");
        }

        @Test void aRangeReplacesTheDaysBackWindowAndKeepsTheTeam() {
            Employee mate = new Employee();
            mate.setId(teammate);
            when(team.resolve(any(Jwt.class), isNull())).thenReturn(List.of(mate));
            when(requests.listDecided(F, T)).thenReturn(List.of(decided(teammate), decided(stranger)));
            var body = controller.decidedChangeRequests(jwt("attendance.regularization.approve"), 30, FROM, TO).getBody();
            assertEquals(1, body.size());
            assertEquals(teammate, body.get(0).employeeId());
            verify(requests, never()).listDecided(anyInt());
        }

        @Test void withoutARangeTheLastDaysAsBefore() {
            when(requests.listDecided(30)).thenReturn(List.of());
            controller.decidedChangeRequests(jwt("attendance.regularization.approve"), 30, null, null);
            verify(requests).listDecided(30);
            verify(requests, never()).listDecided(any(), any());
        }

        @Test void aBrokenRangeIsRefused() {
            refused(BACKWARDS, () -> controller.decidedChangeRequests(jwt("attendance.regularization.approve"), 30, TO, FROM));
            verifyNoInteractions(requests);
        }

        @Test void theSqlIsAboutTheEffectiveDate() {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            new ShiftChangeRequestService(jdbc, null, null).listDecided(F, T);
            ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
            verify(jdbc).query(sql.capture(), any(RowMapper.class), eq(tenant), eq(F), eq(T));
            assertTrue(sql.getValue().contains("COALESCE(scr.applied_effective_date, scr.requested_effective_date) BETWEEN ? AND ?"),
                    sql.getValue());
            assertTrue(sql.getValue().contains("LIMIT 200"), sql.getValue());
        }
    }
}
