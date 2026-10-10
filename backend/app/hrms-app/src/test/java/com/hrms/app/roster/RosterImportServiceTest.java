package com.hrms.app.roster;

import com.hrms.api.roster.Actor;
import com.hrms.api.roster.PlannerScope;
import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.DraftBody;
import com.hrms.api.roster.RosterContract.ImportValidation;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RosterDetail;
import com.hrms.api.roster.RosterContract.RosterSource;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.api.roster.RosterDrafts;
import com.hrms.api.roster.RosterPlanning;
import com.hrms.api.roster.RosterService;
import com.hrms.api.roster.RosterStore;
import com.hrms.api.roster.RosterTables;
import com.hrms.api.roster.plan.PlanFacts;
import com.hrms.api.roster.plan.PlanFactsLoader;
import com.hrms.api.roster.plan.PlannerPeople;
import com.hrms.api.roster.plan.RosterPlanner;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.security.tenant.TenantContext;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.oauth2.jwt.Jwt;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static com.hrms.app.roster.ImportFixture.A;
import static com.hrms.app.roster.ImportFixture.B;
import static com.hrms.app.roster.ImportFixture.COMPANY;
import static com.hrms.app.roster.ImportFixture.HVAC;
import static com.hrms.app.roster.ImportFixture.JAN_1;
import static com.hrms.app.roster.ImportFixture.JAN_31;
import static com.hrms.app.roster.ImportFixture.MEERA;
import static com.hrms.app.roster.ImportFixture.PRAVEEN;
import static com.hrms.app.roster.ImportFixture.RAVI;
import static com.hrms.app.roster.ImportFixture.TECHNICAL;
import static com.hrms.app.roster.ImportFixture.januaryHeader;
import static com.hrms.app.roster.ImportFixture.januaryRow;
import static com.hrms.app.roster.ImportFixture.sheet;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Validate, apply (always a draft), template and export, with the store, scope and loader stood in for. */
class RosterImportServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
            .claim("permissions", List.of("attendance.roster.plan")).build();
    private final Actor hr = new Actor(UUID.randomUUID(), UUID.randomUUID(), "HR Admin", COMPANY, true, Set.of(), true);

    private PlannerScope scope;
    private RosterDrafts drafts;
    private RosterService rosters;
    private RosterStore store;
    private RosterTables tables;
    private RosterPlanning planning;
    private PlannerPeople people;
    private PlanFactsLoader loader;
    private RosterImportService service;
    private PlanFacts facts;

    private final RosterImportService.Scope january = new RosterImportService.Scope(COMPANY, JAN_1, JAN_31, TECHNICAL, null);

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        scope = mock(PlannerScope.class);
        drafts = mock(RosterDrafts.class);
        rosters = mock(RosterService.class);
        store = mock(RosterStore.class);
        tables = mock(RosterTables.class);
        planning = mock(RosterPlanning.class);
        people = mock(PlannerPeople.class);
        loader = mock(PlanFactsLoader.class);
        service = new RosterImportService(scope, drafts, rosters, store, tables, planning, people, loader);
        facts = ImportFixture.facts(ImportFixture.everyone(), Map.of(JAN_1.withDayOfMonth(26), "Republic Day"), Map.of());

        when(scope.actor(any(), eq(COMPANY))).thenReturn(hr);
        when(people.list(eq(tenant), eq(COMPANY), any(), any(), any(), eq(JAN_1), eq(JAN_31))).thenReturn(ImportFixture.everyone());
        when(loader.load(eq(tenant), eq(COMPANY), any(), anyCollection(), eq(JAN_1.minusDays(1)), eq(JAN_31))).thenAnswer(inv -> facts);
        when(store.scopeName(tenant, TECHNICAL, null)).thenReturn("Technical");
        when(drafts.create(eq(COMPANY), any(), any(), anyString())).thenAnswer(inv -> detail(UUID.randomUUID()));
        when(drafts.replace(any(), any(), any())).thenAnswer(inv -> detail(inv.getArgument(0)));
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private static MockMultipartFile file(List<List<Object>> rows) {
        return new MockMultipartFile("file", "roster.xlsx", RosterImportController.XLSX.toString(), ImportFixture.xlsx(rows));
    }

    private static MockMultipartFile good() {
        return file(sheet(januaryHeader(), List.of(januaryRow(RAVI, Map.of(1, "A", 2, "B", 3, "WO")),
                januaryRow(PRAVEEN, Map.of(1, "B", 26, "PH")))));
    }

    private static RosterDetail detail(UUID id) {
        RosterConfig config = new RosterConfig(null, List.of(), true, WeeklyOffMode.CUSTOM, StaggerMode.SAME, null, List.of(), List.of());
        return new RosterDetail(new RosterContract.RosterHeader(id, COMPANY, "January 2027 · Technical", PeriodType.MONTH, JAN_1, JAN_31,
                TECHNICAL, "Technical", null, null, RosterStatus.DRAFT, RosterSource.IMPORT, false, 0, 2, null, null, "HR Admin",
                Instant.now(), true, true, 1, config), List.of(), List.of(), List.of(), null);
    }

    private static RosterStore.Header header(UUID id, RosterStatus status, int version, LocalDate start, LocalDate end) {
        return new RosterStore.Header(id, COMPANY, "January plan", PeriodType.MONTH, start, end, TECHNICAL, "Technical", null, null,
                status, RosterSource.PLANNER, false, version, 3, null, null, null, null, Instant.now(), 2);
    }

    // ── validate ─────────────────────────────────────────────────────────────

    @Test
    void validateReturnsTheRowsTheProblemsAndThePlannersPreviewAndWritesNothing() {
        MockMultipartFile f = file(sheet(januaryHeader(), List.of(januaryRow(RAVI, Map.of(1, "A", 2, "zz")), januaryRow(MEERA, Map.of(1, "B")))));

        ImportValidation v = service.validate(jwt, f, january, null);

        assertThat(v.startDate()).isEqualTo(JAN_1);
        assertThat(v.sheetName()).isEqualTo("Roster");
        assertThat(v.headerRow()).isEqualTo(2);
        assertThat(v.rows()).hasSize(2);
        assertThat(v.summary()).isEqualTo(new RosterContract.ImportSummary(2, 1, 2, 0));   // unknown code + Meera outside Technical
        assertThat(v.problems()).extracting(RosterContract.ImportProblem::code).containsExactly("UNKNOWN_CODE", "E2");
        assertThat(v.plan()).isNotNull();
        assertThat(v.plan().rows()).singleElement().satisfies(r -> {
            assertThat(r.employeeName()).isEqualTo("Ravi Kumar");
            assertThat(r.cells().get(0).code()).isEqualTo("A");
            assertThat(r.cells().get(1).token()).isNull();
        });
        assertThat(v.plan().days().get(25).holidayName()).isEqualTo("Republic Day");
        verifyNoInteractions(drafts);
        verify(tables).require();
    }

    @Test
    void validateWithNobodyMatchedHasNoPreview() {
        List<Object> row = januaryRow(RAVI, Map.of(1, "A"));
        row.set(1, "NOPE-1");
        ImportValidation v = service.validate(jwt, file(sheet(januaryHeader(), List.of(row))), january, null);
        assertThat(v.plan()).isNull();
        assertThat(v.summary().matched()).isZero();
    }

    @Test
    void validateChecksTheCompanyEvenWhenItCameAsAFormField() {
        CompanyAccessService access = mock(CompanyAccessService.class);
        service.setCompanyAccess(access);
        doThrow(new HrmsException("You don't have access to this company.", HttpStatus.FORBIDDEN, "COMPANY_ACCESS_DENIED"))
                .when(access).checkBodyCompany(COMPANY);
        assertThatThrownBy(() -> service.validate(jwt, good(), january, null)).extracting("errorCode").isEqualTo("COMPANY_ACCESS_DENIED");
        verifyNoInteractions(people, loader);
    }

    @Test
    void aDepartmentHeadMustImportIntoADepartmentTheyHead() {
        Actor head = new Actor(UUID.randomUUID(), UUID.randomUUID(), "Head", COMPANY, false, Set.of(TECHNICAL), false);
        when(scope.actor(any(), eq(COMPANY))).thenReturn(head);
        RosterImportService.Scope admin = new RosterImportService.Scope(COMPANY, JAN_1, JAN_31, ImportFixture.ADMIN, null);
        doThrow(new HrmsException("Only HR can plan rosters outside the departments you head.", HttpStatus.FORBIDDEN, "ROSTER_SCOPE"))
                .when(scope).check(head, ImportFixture.ADMIN, List.of());
        assertThatThrownBy(() -> service.validate(jwt, good(), admin, null)).extracting("errorCode").isEqualTo("ROSTER_SCOPE");
        verifyNoInteractions(people, loader);
    }

    @Test
    void aPeriodLongerThanSixtyTwoDaysIsRefused() {
        RosterImportService.Scope tooLong = new RosterImportService.Scope(COMPANY, JAN_1, JAN_1.plusDays(62), TECHNICAL, null);
        assertThatThrownBy(() -> service.validate(jwt, good(), tooLong, null)).extracting("errorCode").isEqualTo("ROSTER_RANGE_INVALID");
    }

    @Test
    void everythingAnswersNotReadyWhileTheTablesAreMissing() {
        doThrow(new FeatureNotReady()).when(tables).require();
        assertThatThrownBy(() -> service.validate(jwt, good(), january, null)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> service.apply(jwt, good(), january, null, null, null)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> service.template(jwt, january)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> service.export(jwt, UUID.randomUUID(), false)).isInstanceOf(FeatureNotReady.class);
        verifyNoInteractions(drafts);
    }

    // ── apply ────────────────────────────────────────────────────────────────

    @Test
    void applyIsRefusedWhileTheFileHasErrors() {
        MockMultipartFile bad = file(sheet(januaryHeader(), List.of(januaryRow(RAVI, Map.of(1, "Q")))));
        assertThatThrownBy(() -> service.apply(jwt, bad, january, "January", null, null))
                .isInstanceOf(HrmsException.class)
                .hasMessage("The file still has 1 error. Fix it and upload the file again.")
                .extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
        verifyNoInteractions(drafts);
    }

    @Test
    void applyCreatesADraftFromTheImportAndNeverPublishes() {
        RosterImportService.Applied applied = service.apply(jwt, good(), january, "  January  2027 ", null, null);

        assertThat(applied.created()).isTrue();
        ArgumentCaptor<DraftBody> body = ArgumentCaptor.forClass(DraftBody.class);
        verify(drafts).create(eq(COMPANY), body.capture(), eq(hr), eq(RosterDrafts.SOURCE_IMPORT));
        verify(drafts, never()).replace(any(), any(), any());
        DraftBody b = body.getValue();
        assertThat(b.name()).isEqualTo("January 2027");
        assertThat(b.periodType()).isEqualTo(PeriodType.MONTH);
        assertThat(b.startDate()).isEqualTo(JAN_1);
        assertThat(b.endDate()).isEqualTo(JAN_31);
        assertThat(b.departmentId()).isEqualTo(TECHNICAL);
        assertThat(b.branchId()).isNull();
        assertThat(b.lockVersion()).isNull();
        assertThat(b.staffing()).isEmpty();
        assertThat(b.config().pattern()).isEmpty();
        assertThat(b.config().weeklyOffMode()).isEqualTo(WeeklyOffMode.CUSTOM);
        assertThat(b.config().staggerMode()).isEqualTo(StaggerMode.SAME);
        assertThat(b.config().shiftIds()).containsExactly(A.id(), B.id());
        assertThat(b.config().designationIds()).containsExactly(HVAC.toString());
        assertThat(b.members()).extracting(RosterContract.MemberIn::employeeId).containsExactly(RAVI.employeeId(), PRAVEEN.employeeId());
        assertThat(b.rows().get(0).cells().subList(0, 4)).containsExactly(A.id().toString(), B.id().toString(), RosterContract.WO, null);
        assertThat(b.rows().get(0).edited()).isEmpty();
        assertThat(b.rows().get(1).cells().get(25)).isNull();   // PH on the holiday: the holiday shows, no cell
    }

    @Test
    void aBlankNameLeavesTheDefaultToTheStore() {
        service.apply(jwt, good(), january, null, null, null);
        ArgumentCaptor<DraftBody> body = ArgumentCaptor.forClass(DraftBody.class);
        verify(drafts).create(eq(COMPANY), body.capture(), any(), any());
        assertThat(body.getValue().name()).isEmpty();
    }

    @Test
    void aRangeIsSavedAsARange() {
        LocalDate end = JAN_1.plusDays(9);
        when(people.list(eq(tenant), eq(COMPANY), any(), any(), any(), eq(JAN_1), eq(end))).thenReturn(ImportFixture.everyone());
        when(loader.load(eq(tenant), eq(COMPANY), any(), anyCollection(), eq(JAN_1.minusDays(1)), eq(end))).thenAnswer(inv -> facts);
        List<Object> header = new java.util.ArrayList<>(List.of("Employee", "Employee code"));
        for (int d = 1; d <= 10; d++) header.add(String.format("%02d Jan", d));
        MockMultipartFile f = file(List.of(header, List.of("Ravi Kumar", "TV-101", "A")));
        service.apply(jwt, f, new RosterImportService.Scope(COMPANY, JAN_1, end, TECHNICAL, null), "", null, null);
        ArgumentCaptor<DraftBody> body = ArgumentCaptor.forClass(DraftBody.class);
        verify(drafts).create(eq(COMPANY), body.capture(), any(), any());
        assertThat(body.getValue().periodType()).isEqualTo(PeriodType.RANGE);
        assertThat(body.getValue().rows().get(0).cells()).hasSize(10);
    }

    @Test
    void applyReplacesTheDaysOfADraftThatWasNeverPublished() {
        UUID id = UUID.randomUUID();
        RosterStore.Header draft = header(id, RosterStatus.DRAFT, 0, JAN_1, JAN_31);
        when(rosters.load(tenant, id, false)).thenReturn(draft);
        StaffingIn staffing = new StaffingIn(HVAC, A.id(), 2);
        when(store.staffing(tenant, id)).thenReturn(List.of(staffing));

        RosterImportService.Applied applied = service.apply(jwt, good(), january, " ", id, 3);

        assertThat(applied.created()).isFalse();
        verify(rosters).editor(jwt, draft);
        ArgumentCaptor<DraftBody> body = ArgumentCaptor.forClass(DraftBody.class);
        verify(drafts).replace(eq(id), body.capture(), eq(hr));
        verify(drafts, never()).create(any(), any(), any(), any());
        assertThat(body.getValue().lockVersion()).isEqualTo(3);
        assertThat(body.getValue().name()).isEqualTo("January plan");   // the draft keeps its name
        assertThat(body.getValue().staffing()).containsExactly(staffing);
    }

    @Test
    void validateWithATargetDraftUsesItsStaffingInThePreview() {
        UUID id = UUID.randomUUID();
        when(rosters.load(tenant, id, false)).thenReturn(header(id, RosterStatus.DRAFT, 0, JAN_1, JAN_31));
        when(store.staffing(tenant, id)).thenReturn(List.of(new StaffingIn(HVAC, A.id(), 2)));
        ImportValidation v = service.validate(jwt, good(), january, id);
        assertThat(v.plan().coverage()).anySatisfy(c -> {
            assertThat(c.shiftPolicyId()).isEqualTo(A.id());
            assertThat(c.designationId()).isEqualTo(HVAC);
            assertThat(c.perDay().get(0).required()).isEqualTo(2);
            assertThat(c.perDay().get(0).scheduled()).isEqualTo(1);
            assertThat(c.perDay().get(0).status()).isEqualTo(RosterContract.CoverageStatus.SHORT);
        });
    }

    @Test
    void aPublishedRosterIsNeverReplacedByAnImport() {
        UUID id = UUID.randomUUID();
        when(rosters.load(tenant, id, false)).thenReturn(header(id, RosterStatus.PUBLISHED, 1, JAN_1, JAN_31));
        assertThatThrownBy(() -> service.apply(jwt, good(), january, null, id, 3)).extracting("errorCode").isEqualTo("ROSTER_PUBLISHED");
        // a draft that was published once and has changes is still "published"
        when(rosters.load(tenant, id, false)).thenReturn(header(id, RosterStatus.DRAFT, 2, JAN_1, JAN_31));
        assertThatThrownBy(() -> service.apply(jwt, good(), january, null, id, 3)).extracting("errorCode").isEqualTo("ROSTER_PUBLISHED");
        verifyNoInteractions(drafts);
    }

    @Test
    void replacingADraftNeedsTheSamePeriodAndTheLockVersion() {
        UUID id = UUID.randomUUID();
        when(rosters.load(tenant, id, false)).thenReturn(header(id, RosterStatus.DRAFT, 0, JAN_1, JAN_1.plusDays(14)));
        assertThatThrownBy(() -> service.apply(jwt, good(), january, null, id, 3))
                .extracting("errorCode").isEqualTo("ROSTER_RANGE_INVALID");

        when(rosters.load(tenant, id, false)).thenReturn(header(id, RosterStatus.DRAFT, 0, JAN_1, JAN_31));
        assertThatThrownBy(() -> service.apply(jwt, good(), january, null, id, null))
                .hasMessageContaining("lockVersion").extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
        verifyNoInteractions(drafts);
    }

    // ── template and export ──────────────────────────────────────────────────

    @Test
    void theTemplateListsThePeopleInScope() throws IOException {
        when(people.list(tenant, COMPANY, TECHNICAL, null, null, JAN_1, JAN_31)).thenReturn(List.of(RAVI, PRAVEEN));
        RosterImportService.Download d = service.template(jwt, january);
        assertThat(d.fileName()).isEqualTo("roster-template-2027-01-01-to-2027-01-31.xlsx");
        try (XSSFWorkbook wb = new XSSFWorkbook(new ByteArrayInputStream(d.bytes()))) {
            var roster = wb.getSheet("Roster");
            assertThat(roster.getRow(0).getCell(0).getStringCellValue()).isEqualTo("Roster — January 2027 — Technical");
            assertThat(roster.getRow(3).getCell(0).getStringCellValue()).isEqualTo("Ravi Kumar");
            assertThat(roster.getRow(4).getCell(1).getStringCellValue()).isEqualTo("TV-102");
            assertThat(roster.getPhysicalNumberOfRows()).isEqualTo(5);   // title, headers, weekdays and the two people
            assertThat(wb.getSheet("Codes").getRow(1).getCell(0).getStringCellValue()).isEqualTo("A");
        }
        // the template's own people come back with no problems
        ImportValidation v = service.validate(jwt, new MockMultipartFile("file", d.fileName(), null, d.bytes()), january, null);
        assertThat(v.summary()).isEqualTo(new RosterContract.ImportSummary(2, 2, 0, 0));
    }

    @Test
    void aDepartmentHeadsTemplateHasOnlyTheirPeople() {
        Actor head = new Actor(UUID.randomUUID(), UUID.randomUUID(), "Head", COMPANY, false, Set.of(TECHNICAL), false);
        when(scope.actor(any(), eq(COMPANY))).thenReturn(head);
        service.template(jwt, january);
        verify(people).list(tenant, COMPANY, TECHNICAL, null, Set.of(TECHNICAL), JAN_1, JAN_31);
        verify(scope).check(head, TECHNICAL, List.of());
    }

    @Test
    void theExportWritesTheWorkingCopyAndImportsBackTheSame() {
        UUID id = UUID.randomUUID();
        RosterStore.Header h = header(id, RosterStatus.PUBLISHED, 1, JAN_1, JAN_31);
        when(rosters.load(tenant, id, false)).thenReturn(h);
        when(rosters.reader(jwt, h)).thenReturn(hr);
        when(store.members(tenant, id)).thenReturn(List.of(new RosterContract.MemberIn(RAVI.employeeId(), 0)));
        when(store.cells(tenant, id)).thenReturn(List.of(
                new RosterStore.Cell(RAVI.employeeId(), JAN_1, "SHIFT", A.id(), false),
                new RosterStore.Cell(RAVI.employeeId(), JAN_1.plusDays(1), "WO", null, true)));
        when(planning.plan(eq(tenant), eq(COMPANY), any(PlanRequest.class), eq(hr)))
                .thenAnswer(inv -> Optional.of(RosterPlanner.plan(inv.getArgument(2), facts)));

        RosterImportService.Download d = service.export(jwt, id, false);

        assertThat(d.fileName()).isEqualTo("January plan.xlsx");
        RosterSheetParser.ParsedSheet s = RosterSheetParser.parse(d.fileName(), d.bytes(), JAN_1, JAN_31);
        assertThat(s.rows()).singleElement().satisfies(r -> {
            assertThat(r.cells()).containsEntry(JAN_1, "A").containsEntry(JAN_1.plusDays(1), "WO").containsEntry(JAN_1.withDayOfMonth(26), "PH");
            assertThat(r.cells()).hasSize(3);
        });
        ImportValidation again = service.validate(jwt, new MockMultipartFile("file", d.fileName(), null, d.bytes()), january, null);
        assertThat(again.summary().errors()).isZero();
        assertThat(again.summary().warnings()).isZero();
        verify(store, never()).rosterDays(any(), any(), any(), anyBoolean());
    }

    @Test
    void theExportOfThePublishedDaysReadsThePublishedSchedule() {
        UUID id = UUID.randomUUID();
        RosterStore.Header h = header(id, RosterStatus.PUBLISHED, 1, JAN_1, JAN_31);
        when(rosters.load(tenant, id, false)).thenReturn(h);
        when(rosters.reader(jwt, h)).thenReturn(hr);
        when(store.members(tenant, id)).thenReturn(List.of());
        when(store.rosterDays(tenant, id, JAN_1, false)).thenReturn(List.of(
                new RosterStore.Day(PRAVEEN.employeeId(), JAN_1.plusDays(4), "SHIFT", B.id(), id, "January plan", 1)));
        when(planning.plan(eq(tenant), eq(COMPANY), any(PlanRequest.class), eq(hr)))
                .thenAnswer(inv -> Optional.of(RosterPlanner.plan(inv.getArgument(2), facts)));

        RosterImportService.Download d = service.export(jwt, id, true);

        assertThat(d.fileName()).isEqualTo("January plan (published).xlsx");
        RosterSheetParser.ParsedSheet s = RosterSheetParser.parse("x.xlsx", d.bytes(), JAN_1, JAN_31);
        assertThat(s.rows()).singleElement().satisfies(r -> {
            assertThat(r.employee()).isEqualTo("Praveen Rao");
            assertThat(r.cells()).containsEntry(JAN_1.plusDays(4), "B");
        });
        verify(store, never()).cells(any(), any());
    }

    @Test
    void theExportAnswersNotReadyWithoutThePlanner() {
        UUID id = UUID.randomUUID();
        RosterStore.Header h = header(id, RosterStatus.DRAFT, 0, JAN_1, JAN_31);
        when(rosters.load(tenant, id, false)).thenReturn(h);
        when(rosters.reader(jwt, h)).thenReturn(hr);
        when(planning.plan(any(), any(), any(), any())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.export(jwt, id, false)).isInstanceOf(FeatureNotReady.class);
    }

    @SuppressWarnings("unchecked")
    private static <T> org.springframework.beans.factory.ObjectProvider<T> none() {
        return mock(org.springframework.beans.factory.ObjectProvider.class);   // getIfAvailable() → null
    }

    @Test
    void withoutShiftPlanningsBeansTheAppStillStartsAndTheImportIsNotReady() {
        RosterImportService bare = new RosterImportService(none(), none(), none(), none(), none(), none(), none(), none());
        assertThatThrownBy(() -> bare.validate(jwt, good(), january, null)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> bare.apply(jwt, good(), january, null, null, null)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> bare.template(jwt, january)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> bare.export(jwt, UUID.randomUUID(), false)).isInstanceOf(FeatureNotReady.class);
        // and with the tables there but the store's drafts missing, apply still refuses cleanly
        RosterImportService noDrafts = new RosterImportService(scope, null, rosters, store, tables, planning, people, loader);
        assertThatThrownBy(() -> noDrafts.apply(jwt, good(), january, null, null, null)).isInstanceOf(FeatureNotReady.class);
    }

    @Test
    void fileNamesKeepOnlySafeCharacters() {
        assertThat(RosterImportService.fileName("October 2026 · Technical/HVAC")).isEqualTo("October 2026 Technical HVAC");
        assertThat(RosterImportService.fileName("··")).isEqualTo("Roster");
    }
}
