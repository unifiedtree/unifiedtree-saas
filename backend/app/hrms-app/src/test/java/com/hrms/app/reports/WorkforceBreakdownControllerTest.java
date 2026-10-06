package com.hrms.app.reports;

import com.unifiedtree.rbac.security.PermissionChecker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The breakdown and joiners routes: gender follows the diversity permission, a future date is today, bad ranges are refused. */
class WorkforceBreakdownControllerTest {

    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private WorkforceBreakdownService service;
    private PermissionChecker perm;
    private WorkforceBreakdownController controller;

    @BeforeEach
    void setUp() {
        service = mock(WorkforceBreakdownService.class);
        perm = mock(PermissionChecker.class);
        controller = new WorkforceBreakdownController(service, perm);
    }

    @Test
    void genderOnlyWithTheDiversityReportAndAFutureDateIsToday() {
        LocalDate today = LocalDate.now(ReportPdfService.IST);
        when(perm.check("hrms.report.diversity")).thenReturn(false);
        controller.breakdown(CO, today.plusDays(30));
        verify(service).breakdown(CO, today, false);

        when(perm.check("hrms.report.diversity")).thenReturn(true);
        controller.breakdown(CO, LocalDate.of(2026, 1, 31));
        verify(service).breakdown(CO, LocalDate.of(2026, 1, 31), true);
    }

    @Test
    void joinersRefuseBackwardsAndOverLongRanges() {
        assertThatThrownBy(() -> controller.joiners(CO, LocalDate.of(2026, 5, 1), LocalDate.of(2026, 4, 1)))
                .hasMessageContaining("start date");
        assertThatThrownBy(() -> controller.joiners(CO, LocalDate.of(2024, 1, 1), LocalDate.of(2026, 1, 1)))
                .hasMessageContaining("24 months");
        verify(service, never()).joiners(any(), any(), any(), any());
        controller.joiners(CO, LocalDate.of(2025, 11, 1), LocalDate.of(2026, 10, 31));
        verify(service).joiners(eq(CO), eq(LocalDate.of(2025, 11, 1)), eq(LocalDate.of(2026, 10, 31)), any());
    }
}
