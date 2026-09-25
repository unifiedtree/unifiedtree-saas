package com.hrms.app.reports;

import com.hrms.api.audit.AuditRecordNames;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceFilter;
import com.hrms.employee.workforce.service.MilestoneWindow;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Audit record names and the "who" filter, the audit CSV escaping, the
 * directory's milestone and no-department filters, and the scheduled email's
 * text (white-label: the company's name, never the product's).
 */
class ReportsAuditAndDirectoryTest {

    private static final UUID EMP = UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");

    @Test
    void auditEntityTypesMatchIgnoringCaseAndSeparators() {
        assertThat(AuditRecordNames.knows("Employee")).isTrue();
        assertThat(AuditRecordNames.knows("LEAVE_REQUEST")).isTrue();
        assertThat(AuditRecordNames.knows("payroll-run")).isTrue();
        assertThat(AuditRecordNames.knows("report_schedule")).isTrue();
        assertThat(AuditRecordNames.knows("spaceship")).isFalse();
        assertThat(AuditRecordNames.key("Leave Request", EMP)).isEqualTo("leaverequest:" + EMP);
    }

    @Test
    void auditRecordNamesResolveInOneQueryPerTypeAndSkipUnknownTypes() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            ResultSet rs = mock(ResultSet.class);
            when(rs.getObject(1, UUID.class)).thenReturn(EMP);
            when(rs.getString(2)).thenReturn("Rahul Verma");
            h.processRow(rs);
            return null;
        }).when(jdbc).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
        AuditRecordNames names = new AuditRecordNames(jdbc);

        Map<String, AuditRecordNames.Named> out = names.resolve(List.of(
                new AuditRecordNames.Ref("EMPLOYEE", EMP), new AuditRecordNames.Ref("employee", EMP),
                new AuditRecordNames.Ref("spaceship", UUID.randomUUID()), new AuditRecordNames.Ref("employee", null)));

        assertThat(out.get(AuditRecordNames.key("Employee", EMP)))
                .isEqualTo(new AuditRecordNames.Named("Rahul Verma", "/hrms/employees/" + EMP));
        verify(jdbc, org.mockito.Mockito.times(1)).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
    }

    @Test
    void theWhoFilterTakesAnIdOrAnEmailAndAnUnknownEmailMatchesNothing() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(UUID.class), eq("hr@acme.in"))).thenReturn(List.of(EMP));
        when(jdbc.queryForList(anyString(), eq(UUID.class), eq("nobody@acme.in"))).thenReturn(List.of());
        AuditRecordNames names = new AuditRecordNames(jdbc);

        assertThat(names.actor(" ").any()).isTrue();
        assertThat(names.actor(EMP.toString()).userId()).isEqualTo(EMP);
        assertThat(names.actor("hr@acme.in").userId()).isEqualTo(EMP);
        assertThat(names.actor("nobody@acme.in").matchesNothing()).isTrue();
    }

    @Test
    void auditCsvCellsAreQuotedAndFormulasDefused() {
        assertThat(AuditExportController.cell(null)).isEmpty();
        assertThat(AuditExportController.cell("plain")).isEqualTo("plain");
        assertThat(AuditExportController.cell("a,b")).isEqualTo("\"a,b\"");
        assertThat(AuditExportController.cell("say \"hi\"")).isEqualTo("\"say \"\"hi\"\"\"");
        assertThat(AuditExportController.cell("=HYPERLINK(1)")).isEqualTo("\"'=HYPERLINK(1)\"");
        assertThat(AuditExportController.cell("line\nbreak")).isEqualTo("\"line\nbreak\"");
    }

    @Test
    void milestoneFiltersMatchTheDashboardWindows() {
        assertThat(MilestoneWindow.Kind.parse("birthday")).isEqualTo(MilestoneWindow.Kind.BIRTHDAY);
        assertThat(MilestoneWindow.Kind.parse("Birthdays")).isEqualTo(MilestoneWindow.Kind.BIRTHDAY);
        assertThat(MilestoneWindow.Kind.parse("anniversary")).isEqualTo(MilestoneWindow.Kind.ANNIVERSARY);
        assertThat(MilestoneWindow.Kind.parse("retirement")).isEqualTo(MilestoneWindow.Kind.RETIREMENT);
        assertThat(MilestoneWindow.Kind.parse("holiday")).isNull();
        assertThat(MilestoneWindow.Kind.BIRTHDAY.clamp(null)).isEqualTo(14);
        assertThat(MilestoneWindow.Kind.ANNIVERSARY.clamp(null)).isEqualTo(31);
        assertThat(MilestoneWindow.Kind.RETIREMENT.clamp(null)).isEqualTo(6);
        assertThat(MilestoneWindow.Kind.BIRTHDAY.clamp(5000)).isEqualTo(366);
        assertThat(MilestoneWindow.Kind.RETIREMENT.clamp(0)).isEqualTo(1);
        assertThat(MilestoneWindow.idsSql(MilestoneWindow.Kind.RETIREMENT)).contains("years => 60").contains("months => ?");
        assertThat(MilestoneWindow.idsSql(MilestoneWindow.Kind.ANNIVERSARY)).contains(">= 1").contains("days => ?");
        assertThat(MilestoneWindow.idsSql(MilestoneWindow.Kind.BIRTHDAY)).contains("date_of_birth").contains("is_active");
    }

    @Test
    void theOldDirectoryFilterStillWorksWithoutTheNewOptions() {
        WorkforceFilter f = new WorkforceFilter(null, null, null, null, "x", -1, 999);
        assertThat(f.noDepartment()).isFalse();
        assertThat(f.milestone()).isNull();
        assertThat(f.page()).isZero();
        assertThat(f.pageSize()).isEqualTo(200);
    }

    @Test
    void scheduledEmailsNameTheCompanyNotTheProduct() {
        ReportScheduleService.Recipient to = new ReportScheduleService.Recipient(EMP, "Asha <Rao>", "asha@acme.in", Set.of());
        ReportScheduleService.Recipient owner = new ReportScheduleService.Recipient(UUID.randomUUID(), "Vikram", "v@acme.in", Set.of());
        ReportPeriods.Period p = new ReportPeriods.Period(java.time.LocalDate.of(2026, 9, 1), java.time.LocalDate.of(2026, 9, 30));
        String subject = ReportScheduleService.subject(ReportKind.HEADCOUNT, "Acme Retail", p);
        String body = ReportScheduleService.body(ReportKind.HEADCOUNT, "Acme Retail", p, to, owner, "monthly");
        assertThat(subject).isEqualTo("Headcount report · Acme Retail · 1 Sep 2026 – 30 Sep 2026");
        assertThat(body).contains("Acme Retail", "Asha &lt;Rao&gt;", "Vikram", "monthly");
        assertThat((subject + body).toLowerCase()).doesNotContain("unifiedtree").doesNotContain("unified tree");
    }

    @Test
    void exportsAreNotLoggedWithoutATenant() {
        // ReportExportLog skips logging without a tenant instead of writing a tenant-less row.
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        com.unifiedtree.security.tenant.TenantContext.clear();
        ReportExportLog exportLog = new ReportExportLog(jdbc, new com.fasterxml.jackson.databind.ObjectMapper(),
                mock(org.springframework.transaction.PlatformTransactionManager.class));
        UUID id = exportLog.record(new ReportExportLog.Entry(ReportKind.HEADCOUNT, "CSV", "SERVER", "f.csv", null, null,
                Map.of(), 1, 10L, null, null));
        assertThat(id).isNull();
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
