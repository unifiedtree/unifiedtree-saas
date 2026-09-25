package com.hrms.app.reports;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

/**
 * Data for the dashboard's "Export headcount" workbook (the browser writes the
 * .xlsx from it with the shared workbook writer).
 *
 * <p>Needs {@code hrms.report.headcount}, like the headcount report. What else
 * the file carries depends on the caller:
 * <ul>
 *   <li>the Employees list (names, work email, manager…) only with
 *       {@code hrms.employee.read}: the export can't be a wider door than the
 *       directory;</li>
 *   <li>the gender breakdown only with {@code hrms.report.diversity}, the
 *       permission of the diversity report.</li>
 * </ul>
 * A date after today (India time) is treated as today.
 */
@RestController
@RequestMapping("/v1/reports/headcount")
@Tag(name = "Reports")
@SecurityRequirement(name = "bearerAuth")
public class HeadcountWorkbookController {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final HeadcountWorkbookService service;

    public HeadcountWorkbookController(HeadcountWorkbookService service) {
        this.service = service;
    }

    @GetMapping("/workbook")
    @Operation(summary = "Headcount workbook data: summary, breakdowns and (with employee read) the employee list")
    @PreAuthorize("hasAuthority('hrms.report.headcount')")
    public HeadcountWorkbook.Workbook workbook(
            @RequestParam UUID companyId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        LocalDate today = LocalDate.now(IST);
        LocalDate date = asOf == null || asOf.isAfter(today) ? today : asOf;
        return service.build(companyId, date, today, has("hrms.employee.read"), has("hrms.report.diversity"));
    }

    private static boolean has(String authority) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }
}
