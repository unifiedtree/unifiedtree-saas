package com.hrms.api.ess.around;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.ess.EssCaller;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * For team approvers: when someone in their team finishes probation (the
 * design's "Aditya Rao’s probation ends · decide before then"). Read from the
 * existing employee records only.
 *
 * <p>Who: anyone with {@code attendance.team.read} or {@code hrms.leave.approve.l1},
 * Home's rule for team blocks (DECISIONS 12). Whose: their team by the My team
 * rule ({@link TeamEmployeeScope#teamOf}: the departments they head, else their
 * direct reports), people still on probation whose end date is in the window.
 * Managers see these dates (DECISIONS 15); confirming or extending stays with
 * {@code hrms.probation.team.decide}, which this never implies.
 */
@Component
class TeamProbationEndsSource implements AroundSource {

    private final TeamEmployeeScope teamScope;
    private final WorkforceDepartmentRepository departments;

    TeamProbationEndsSource(TeamEmployeeScope teamScope, WorkforceDepartmentRepository departments) {
        this.teamScope = teamScope;
        this.departments = departments;
    }

    @Override public String key() { return "PROBATION_END"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.hasAny("attendance.team.read", "hrms.leave.approve.l1"); }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        List<Employee> ending = teamScope.teamOf(me).stream()
                .filter(e -> e.getEmploymentStatus() == EmploymentStatus.PROBATION)
                .filter(e -> e.getProbationEndDate() != null
                        && !e.getProbationEndDate().isBefore(from) && !e.getProbationEndDate().isAfter(to))
                .toList();
        if (ending.isEmpty()) return List.of();
        Map<UUID, String> deptNames = new HashMap<>();
        List<UUID> deptIds = ending.stream().map(Employee::getDepartmentId).filter(Objects::nonNull).distinct().toList();
        if (!deptIds.isEmpty()) departments.findAllById(deptIds).forEach(d -> deptNames.put(d.getId(), d.getName()));
        return ending.stream().map(e -> {
            String name = ((e.getFirstName() == null ? "" : e.getFirstName().trim()) + " "
                    + (e.getLastName() == null ? "" : e.getLastName().trim())).trim();
            if (name.isEmpty()) name = e.getEmployeeCode();
            String dept = e.getDepartmentId() == null ? null : deptNames.get(e.getDepartmentId());
            String job = e.getJobTitle() == null || e.getJobTitle().isBlank() ? null : e.getJobTitle().trim();
            return new AroundItem("PROBATION_END", e.getProbationEndDate(), "ON", YearlyDates.possessive(name) + " probation ends",
                    job != null ? job : dept, null, e.getId(), e.getId(), dept, null, "/team");
        }).toList();
    }
}
