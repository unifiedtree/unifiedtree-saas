package com.hrms.app.reports;

import com.hrms.app.reports.WorkforceBreakdown.Breakdown;
import com.hrms.app.reports.WorkforceBreakdown.Group;
import com.hrms.app.reports.WorkforceBreakdown.Person;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Workforce Analytics' breakdowns: they add up to the headcount report's
 * buckets, missing values go last, bands keep their order, gender only with
 * the diversity permission, joiners per month have no gaps; the queries are
 * the headcount report's own and are tenant and company scoped.
 */
class WorkforceBreakdownTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final LocalDate AS_OF = LocalDate.of(2026, 10, 6);

    private static Person p(String bucket, String branch, String gender, LocalDate dob, LocalDate joined) {
        return new Person(bucket, branch, "Developer", "FULL_TIME", gender, dob, joined);
    }

    @Test
    void everyBreakdownAddsUpToTheHeadcountAndItsBuckets() {
        List<Person> people = List.of(
                p("ACTIVE", "Pune", "FEMALE", LocalDate.of(1990, 1, 1), LocalDate.of(2020, 1, 1)),
                p("PROBATION", "Pune", "MALE", LocalDate.of(2003, 5, 1), LocalDate.of(2026, 9, 1)),
                p("NOTICE", "Mumbai", null, null, LocalDate.of(2024, 3, 1)),
                p("OTHER", null, "FEMALE", LocalDate.of(1965, 1, 1), LocalDate.of(2010, 1, 1)));
        Breakdown b = WorkforceBreakdown.build(AS_OF, people, true);

        assertThat(b.total()).isEqualTo(4);
        assertThat(b.active()).isEqualTo(1);
        assertThat(b.probation()).isEqualTo(1);
        assertThat(b.onNotice()).isEqualTo(1);
        for (List<Group> g : List.of(b.byBranch(), b.byDesignation(), b.byEmploymentType(), b.byAgeBand(), b.byTenureBand(), b.byGender())) {
            assertThat(g.stream().mapToInt(Group::total).sum()).isEqualTo(4);
            assertThat(g.stream().mapToInt(Group::active).sum()).isEqualTo(1);
            assertThat(g.stream().mapToInt(Group::probation).sum()).isEqualTo(1);
            assertThat(g.stream().mapToInt(Group::onNotice).sum()).isEqualTo(1);
        }
    }

    @Test
    void namedGroupsBiggestFirstAndTheMissingOneLast() {
        List<Person> people = List.of(
                p("ACTIVE", null, null, null, AS_OF), p("ACTIVE", null, null, null, AS_OF), p("ACTIVE", null, null, null, AS_OF),
                p("ACTIVE", "Mumbai", null, null, AS_OF), p("ACTIVE", "Pune", null, null, AS_OF), p("ACTIVE", "Pune", null, null, AS_OF),
                p("ACTIVE", "  ", null, null, AS_OF));
        List<Group> g = WorkforceBreakdown.build(AS_OF, people, false).byBranch();
        assertThat(g).extracting(Group::name).containsExactly("Pune", "Mumbai", "No branch");
        assertThat(g).extracting(Group::total).containsExactly(2, 1, 4);
        assertThat(g.get(2).none()).isTrue();
        assertThat(g.get(0).none()).isFalse();
    }

    @Test
    void genderOnlyWithTheDiversityPermission() {
        List<Person> people = List.of(p("ACTIVE", "Pune", "FEMALE", null, AS_OF), p("ACTIVE", "Pune", "NOT_SPECIFIED", null, AS_OF));
        Breakdown without = WorkforceBreakdown.build(AS_OF, people, false);
        assertThat(without.genderIncluded()).isFalse();
        assertThat(without.byGender()).isNull();
        Breakdown with = WorkforceBreakdown.build(AS_OF, people, true);
        assertThat(with.genderIncluded()).isTrue();
        assertThat(with.byGender()).extracting(Group::name).containsExactly("Female", "Not specified");
    }

    @Test
    void employmentTypesReadInWords() {
        Person contract = new Person("ACTIVE", null, null, "CONTRACT", null, null, AS_OF);
        Person none = new Person("ACTIVE", null, null, null, null, null, AS_OF);
        assertThat(WorkforceBreakdown.build(AS_OF, List.of(contract, none), false).byEmploymentType())
                .extracting(Group::name).containsExactly("Contract", "Not set");
    }

    @Test
    void ageBandsOnTheDateInOrderWithEmptyBandsAndNotRecordedLast() {
        assertThat(WorkforceBreakdown.ageBand(LocalDate.of(2001, 10, 7), AS_OF)).isEqualTo("Under 25");   // 24 the day before the birthday
        assertThat(WorkforceBreakdown.ageBand(LocalDate.of(2001, 10, 6), AS_OF)).isEqualTo("25–34");      // 25 on the day
        assertThat(WorkforceBreakdown.ageBand(LocalDate.of(1991, 10, 6), AS_OF)).isEqualTo("35–44");
        assertThat(WorkforceBreakdown.ageBand(LocalDate.of(1981, 10, 6), AS_OF)).isEqualTo("45–54");
        assertThat(WorkforceBreakdown.ageBand(LocalDate.of(1971, 10, 6), AS_OF)).isEqualTo("55 and over");
        assertThat(WorkforceBreakdown.ageBand(null, AS_OF)).isNull();
        assertThat(WorkforceBreakdown.ageBand(AS_OF.plusDays(1), AS_OF)).isNull();

        List<Group> g = WorkforceBreakdown.build(AS_OF, List.of(p("ACTIVE", null, null, LocalDate.of(1990, 1, 1), AS_OF), p("ACTIVE", null, null, null, AS_OF)), false).byAgeBand();
        assertThat(g).extracting(Group::name).containsExactly("Under 25", "25–34", "35–44", "45–54", "55 and over", "Not recorded");
        assertThat(g).extracting(Group::total).containsExactly(0, 0, 1, 0, 0, 1);
        // Nobody without a date of birth: no "Not recorded" line.
        assertThat(WorkforceBreakdown.build(AS_OF, List.of(p("ACTIVE", null, null, LocalDate.of(1990, 1, 1), AS_OF)), false).byAgeBand())
                .hasSize(5);
    }

    @Test
    void tenureBandsAreCompletedTimeSinceJoining() {
        assertThat(WorkforceBreakdown.tenureBand(AS_OF, AS_OF)).isEqualTo("Under 6 months");
        assertThat(WorkforceBreakdown.tenureBand(LocalDate.of(2026, 4, 7), AS_OF)).isEqualTo("Under 6 months");
        assertThat(WorkforceBreakdown.tenureBand(LocalDate.of(2026, 4, 6), AS_OF)).isEqualTo("6–12 months");
        assertThat(WorkforceBreakdown.tenureBand(LocalDate.of(2025, 10, 6), AS_OF)).isEqualTo("1–3 years");
        assertThat(WorkforceBreakdown.tenureBand(LocalDate.of(2023, 10, 6), AS_OF)).isEqualTo("3–5 years");
        assertThat(WorkforceBreakdown.tenureBand(LocalDate.of(2021, 10, 6), AS_OF)).isEqualTo("5–10 years");
        assertThat(WorkforceBreakdown.tenureBand(LocalDate.of(2016, 10, 6), AS_OF)).isEqualTo("10 years and over");
        assertThat(WorkforceBreakdown.tenureBand(null, AS_OF)).isNull();
        assertThat(WorkforceBreakdown.tenureBand(AS_OF.plusDays(1), AS_OF)).isNull();
    }

    @Test
    void joinersPerMonthEveryMonthUpToToday() {
        List<LocalDate> dates = Arrays.asList(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31), LocalDate.of(2026, 10, 2),
                LocalDate.of(2026, 10, 20), null);
        List<Map<String, Object>> out = WorkforceBreakdown.joinersPerMonth(dates, LocalDate.of(2026, 7, 15), LocalDate.of(2026, 10, 6), AS_OF);
        assertThat(out).extracting(m -> m.get("month")).containsExactly("2026-07", "2026-08", "2026-09", "2026-10");
        // 20 Oct is after today: hired ahead, not a joiner yet.
        assertThat(out).extracting(m -> m.get("joined")).containsExactly(0, 2, 0, 1);
    }

    // ── the queries ─────────────────────────────────────────────────────────

    private JdbcTemplate jdbc;
    private WorkforceBreakdownService service;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(new ArrayList<>());
        service = new WorkforceBreakdownService(jdbc);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @Test
    @SuppressWarnings("unchecked")
    void breakdownIsTheHeadcountReportsPeopleTenantAndCompanyScoped() {
        Breakdown b = service.breakdown(CO, AS_OF, true);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), args.capture());
        String q = sql.getValue();
        assertThat(q).contains(ReportService.STATUS_ON).contains(ReportService.EMPLOYED_ON)
                .contains("e.tenant_id = ?").contains("e.company_id = ?").contains("b.tenant_id = ?").contains("g.tenant_id = ?")
                .contains("AND e.date_of_joining <= ?");
        long tenantClauses = q.split("tenant_id = \\?", -1).length - 1;
        assertThat(Arrays.stream(args.getValue()).filter(TENANT::equals).count()).isEqualTo(tenantClauses);
        assertThat(args.getValue()).containsExactly(TENANT, AS_OF, TENANT, AS_OF, AS_OF, TENANT, TENANT, TENANT, CO, AS_OF, AS_OF);
        assertThat(b.total()).isZero();
        assertThat(b.byAgeBand()).hasSize(5);
    }

    @Test
    @SuppressWarnings("unchecked")
    void joinersReadWholeMonthsOfThisCompanyInThisTenant() {
        service.joiners(CO, LocalDate.of(2025, 11, 1), AS_OF, AS_OF);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), args.capture());
        assertThat(sql.getValue()).contains("e.tenant_id = ?").contains("e.company_id = ?");
        assertThat(args.getValue()).containsExactly(TENANT, CO, LocalDate.of(2025, 11, 1), LocalDate.of(2026, 10, 31));
    }
}
