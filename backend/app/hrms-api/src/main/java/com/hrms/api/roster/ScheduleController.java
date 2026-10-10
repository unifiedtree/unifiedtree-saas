package com.hrms.api.roster;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.roster.RosterContract.MySchedule;
import com.hrms.api.roster.RosterContract.ScheduleDay;
import com.hrms.api.roster.plan.RosterPlanner;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The effective schedule (design §1.5, endpoints 18–19; {@link EffectiveSchedule}): each day's
 * published roster day, else the person's usual shift and weekly off, with holidays and approved leave
 * on top. At most 62 days per call.
 * <pre>
 *   GET /v1/schedule/me?from=&amp;to=                     attendance.checkin.self: the caller's own days
 *   GET /v1/schedule/team?from=&amp;to=&amp;departmentId=      attendance.team.read: the caller's team (company for HR/Admin)
 * </pre>
 * Read only. Answers 503 FEATURE_NOT_READY while V143.106 is not applied.
 */
@RestController
@RequestMapping("/v1/schedule")
@Tag(name = "Shift planning: schedule", description = "Each person's planned days: published roster, else their usual shift")
@SecurityRequirement(name = "bearerAuth")
public class ScheduleController {


    private final EffectiveSchedule schedule;
    private final RosterTables tables;
    private final TeamEmployeeScope team;

    public ScheduleController(EffectiveSchedule schedule, RosterTables tables, TeamEmployeeScope team) {
        this.schedule = schedule;
        this.tables = tables;
        this.team = team;
    }

    @Operation(summary = "My planned days: the published roster, else my usual shift and weekly off")
    @GetMapping("/me")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public MySchedule me(@AuthenticationPrincipal Jwt jwt, @RequestParam LocalDate from, @RequestParam LocalDate to) {
        range(from, to);
        tables.require();
        UUID me = RosterAuth.employeeId(jwt);
        if (me == null) throw new ResourceNotFoundException("Your employee record wasn't found.");
        return new MySchedule(me, schedule.days(TenantContext.requireTenantId(), List.of(new EffectiveSchedule.Person(me, null)), from, to));
    }

    @Operation(summary = "My team's planned days (the whole company for HR and admins)")
    @GetMapping("/team")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public List<ScheduleDay> team(@AuthenticationPrincipal Jwt jwt, @RequestParam LocalDate from, @RequestParam LocalDate to,
                                  @RequestParam(required = false) UUID departmentId) {
        range(from, to);
        tables.require();
        boolean companyWide = RosterAuth.has(jwt, RosterAuth.WORKFORCE_ADMIN);
        List<Employee> people;
        try {
            people = team.resolve(jwt, departmentId, null, companyWide);
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
        List<EffectiveSchedule.Person> list = people.stream()
                .map(e -> new EffectiveSchedule.Person(e.getId(), name(e)))
                .sorted(java.util.Comparator.comparing(p -> p.name() == null ? "" : p.name().toLowerCase(java.util.Locale.ROOT)))
                .toList();
        return schedule.days(TenantContext.requireTenantId(), list, from, to);
    }

    /** At most 62 days: the planner's one range rule ({@link RosterPlanner#requireValidRange}). */
    static void range(LocalDate from, LocalDate to) {
        RosterPlanner.requireValidRange(from, to);
    }

    private static String name(Employee e) {
        String first = e.getFirstName() == null ? "" : e.getFirstName().trim();
        String last = e.getLastName() == null ? "" : e.getLastName().trim();
        return (first + " " + last).trim();
    }
}
