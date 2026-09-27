package com.hrms.api.workforce;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * My time entries (/me, and the Timesheet tab). Since V143_65 (redesign BW-36):
 * an optional project on an entry (a description alone still works, as before),
 * the person's submitted weeks and "Submit week", and entries in a submitted or
 * approved week are locked. Without V143_65 every existing call behaves exactly
 * as before; the new parts answer FEATURE_NOT_READY. Approving weeks lives in
 * {@link TimesheetController} (/v1/timesheets), not here: this class keeps its
 * self-service guard.
 */
@RestController
@RequestMapping("/v1/ess/timesheets")
@PreAuthorize("hasAuthority('attendance.checkin.self')")
public class TimeEntryController {
    private static final Logger log = LoggerFactory.getLogger(TimeEntryController.class);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private final JdbcTemplate jdbc;
    private final TimesheetService timesheets;
    @Autowired(required = false)
    private NotificationDispatcher notifications;
    public TimeEntryController(JdbcTemplate jdbc, TimesheetService timesheets) { this.jdbc=jdbc; this.timesheets=timesheets; }
    /** A time entry. The project is optional (V143_65); without one the description is required, as before. */
    public record Input(@NotNull LocalDate workDate, @Size(max=1000) String description, @Min(1) @Max(1440) int minutes, UUID projectId) {}
    private UUID employee(Jwt jwt, boolean lock) {
        String claim=jwt.getClaimAsString("employee_id");
        UUID id=UUID.fromString(claim==null?jwt.getSubject():claim);
        var found=jdbc.queryForList("SELECT id FROM hrms.employees WHERE id=? AND tenant_id=?"+(lock?" FOR UPDATE":""),UUID.class,id,TenantContext.requireTenantId());
        if(found.isEmpty()) throw new BusinessRuleException("Employee profile required","EMPLOYEE_NOT_FOUND");
        return id;
    }
    /** The description was @NotBlank; it still is unless a project is chosen (same 400 and message as before). */
    static void requireDescriptionOrProject(Input input) {
        if(input.projectId()==null&&(input.description()==null||input.description().isBlank()))
            throw new HrmsException("description: must not be blank",HttpStatus.BAD_REQUEST,"VALIDATION_FAILED");
    }
    private static String description(Input input) { return input.description()==null?"":input.description().trim(); }
    @GetMapping
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(@AuthenticationPrincipal Jwt jwt,@RequestParam LocalDate from,@RequestParam LocalDate to) {
        if(to.isBefore(from)||to.isAfter(from.plusDays(366))) throw new BusinessRuleException("Choose a date range of at most one year","TIME_RANGE_INVALID");
        UUID employee=employee(jwt,false);
        List<Map<String,Object>> rows=timesheets.projectsReady()
                ? jdbc.queryForList("SELECT t.id,t.work_date AS \"workDate\",t.description,t.minutes,t.project_id AS \"projectId\",p.name AS \"projectName\",p.code AS \"projectCode\" FROM hrms.time_entries t LEFT JOIN hrms.projects p ON p.id=t.project_id AND p.tenant_id=t.tenant_id WHERE t.tenant_id=? AND t.employee_id=? AND t.work_date BETWEEN ? AND ? ORDER BY t.work_date DESC,t.created_at DESC",TenantContext.requireTenantId(),employee,from,to)
                : jdbc.queryForList("SELECT id,work_date AS \"workDate\",description,minutes FROM hrms.time_entries WHERE tenant_id=? AND employee_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date DESC,created_at DESC",TenantContext.requireTenantId(),employee,from,to);
        if(timesheets.weeksReady()) {
            // Whether each entry sits in a submitted or approved week (it can't be changed).
            Set<LocalDate> locked=timesheets.lockedWeeks(employee,from,to);
            for(Map<String,Object> r:rows) {
                Object d=r.get("workDate");
                LocalDate day=d instanceof java.sql.Date sd?sd.toLocalDate():d instanceof LocalDate ld?ld:null;
                r.put("locked",day!=null&&locked.contains(TimesheetService.monday(day)));
            }
        }
        return rows;
    }
    private void validate(UUID employee,Input input,UUID excluded) {
        if(input.workDate().isAfter(LocalDate.now(ZoneId.of("Asia/Kolkata")))) throw new BusinessRuleException("Time cannot be logged for a future date","TIME_DATE_INVALID");
        Integer total=jdbc.queryForObject("SELECT COALESCE(sum(minutes),0)::integer FROM hrms.time_entries WHERE tenant_id=? AND employee_id=? AND work_date=? AND id<>?",Integer.class,TenantContext.requireTenantId(),employee,input.workDate(),excluded);
        if(total+input.minutes()>1440) throw new BusinessRuleException("Daily entries cannot exceed 24 hours","TIME_LIMIT_EXCEEDED");
    }
    @PostMapping
    @Transactional
    public Map<String,Object> create(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody Input input) {
        requireDescriptionOrProject(input);
        UUID employee=employee(jwt,true); validate(employee,input,new UUID(0,0));
        timesheets.assertWeeksOpen(employee,List.of(input.workDate()));
        if(input.projectId()!=null) {
            if(!timesheets.projectsReady()) throw new FeatureNotReady();
            timesheets.requireProject(employee,input.projectId(),null);
            return jdbc.queryForMap("INSERT INTO hrms.time_entries(tenant_id,employee_id,work_date,description,minutes,project_id) VALUES(?,?,?,?,?,?) RETURNING id",TenantContext.requireTenantId(),employee,input.workDate(),description(input),input.minutes(),input.projectId());
        }
        return jdbc.queryForMap("INSERT INTO hrms.time_entries(tenant_id,employee_id,work_date,description,minutes) VALUES(?,?,?,?,?) RETURNING id",TenantContext.requireTenantId(),employee,input.workDate(),description(input),input.minutes());
    }
    @PutMapping("/{id}")
    @Transactional
    public Map<String,Boolean> update(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id,@Valid @RequestBody Input input) {
        requireDescriptionOrProject(input);
        UUID employee=employee(jwt,true); validate(employee,input,id);
        boolean projects=timesheets.projectsReady();
        List<Map<String,Object>> current=jdbc.queryForList("SELECT work_date"+(projects?",project_id":"")+" FROM hrms.time_entries WHERE id=? AND tenant_id=? AND employee_id=? FOR UPDATE",id,TenantContext.requireTenantId(),employee);
        if(current.isEmpty()) throw new BusinessRuleException("Time entry not found","TIME_ENTRY_NOT_FOUND");
        // Neither the week the entry is in nor the week it moves to may be locked.
        timesheets.assertWeeksOpen(employee,List.of(((java.sql.Date) current.get(0).get("work_date")).toLocalDate(),input.workDate()));
        if(input.projectId()!=null&&!projects) throw new FeatureNotReady();
        int changed;
        if(projects) {
            if(input.projectId()!=null) timesheets.requireProject(employee,input.projectId(),(UUID) current.get(0).get("project_id"));
            changed=jdbc.update("UPDATE hrms.time_entries SET work_date=?,description=?,minutes=?,project_id=?,updated_at=now() WHERE id=? AND tenant_id=? AND employee_id=?",input.workDate(),description(input),input.minutes(),input.projectId(),id,TenantContext.requireTenantId(),employee);
        } else {
            changed=jdbc.update("UPDATE hrms.time_entries SET work_date=?,description=?,minutes=?,updated_at=now() WHERE id=? AND tenant_id=? AND employee_id=?",input.workDate(),description(input),input.minutes(),id,TenantContext.requireTenantId(),employee);
        }
        if(changed!=1) throw new BusinessRuleException("Time entry not found","TIME_ENTRY_NOT_FOUND");
        return Map.of("saved",true);
    }
    @DeleteMapping("/{id}")
    @Transactional
    public Map<String,Boolean> delete(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id) {
        UUID employee=employee(jwt,true);
        timesheets.assertWeeksOpen(employee,jdbc.queryForList("SELECT work_date FROM hrms.time_entries WHERE id=? AND tenant_id=? AND employee_id=?",LocalDate.class,id,TenantContext.requireTenantId(),employee));
        int changed=jdbc.update("DELETE FROM hrms.time_entries WHERE id=? AND tenant_id=? AND employee_id=?",id,TenantContext.requireTenantId(),employee);
        if(changed!=1) throw new BusinessRuleException("Time entry not found","TIME_ENTRY_NOT_FOUND");
        return Map.of("deleted",true);
    }

    // ── V143_65 (redesign BW-36): projects and the week ─────────────────────

    /** My company's active projects, to put time on (name and code only). */
    @GetMapping("/projects")
    public List<Map<String,Object>> projects(@AuthenticationPrincipal Jwt jwt) {
        return timesheets.projects(employee(jwt,false));
    }

    /** My submitted weeks between two days, newest first. */
    @GetMapping("/weeks")
    public List<TimesheetService.Week> weeks(@AuthenticationPrincipal Jwt jwt,@RequestParam LocalDate from,@RequestParam LocalDate to) {
        return timesheets.myWeeks(employee(jwt,false),from,to);
    }

    /** Submit the week starting on {@code monday} to my approver; its entries lock until it is rejected. */
    @PostMapping("/weeks/{monday}/submit")
    public TimesheetService.Week submitWeek(@AuthenticationPrincipal Jwt jwt,@PathVariable LocalDate monday) {
        UUID employee=employee(jwt,false);
        UUID userId=null;
        try { userId=UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        TimesheetService.Week week=timesheets.submit(employee,monday,userId);
        notifyApprover(week);
        return week;
    }

    /** TIMESHEET_SUBMITTED to whoever the week goes to (the notification path). After the commit; best effort. */
    private void notifyApprover(TimesheetService.Week week) {
        if(notifications==null) return;
        try {
            UUID approver=timesheets.approverOf(week.employeeId());
            if(approver==null) { log.warn("No approver found for the timesheet week {} of {}; nobody was told",week.id(),week.employeeId()); return; }
            Map<String,Object> data=new HashMap<>();
            data.put("type","TIMESHEET_SUBMITTED");
            data.put("timesheetWeekId",week.id().toString());
            data.put("weekStart",week.weekStart().toString());
            data.put("route","/requests-tab");
            notifications.dispatch(TenantContext.requireTenantId(),approver,"attendance.timesheet_submitted",Map.of(
                    "employeeName",week.employeeName()==null||week.employeeName().isBlank()?"An employee":week.employeeName(),
                    "weekStart",DAY.format(week.weekStart()),
                    "totalHours",TimesheetService.hours(week.totalMinutes())),data);
        } catch (RuntimeException e) {
            log.warn("Could not send TIMESHEET_SUBMITTED for week {}: {}",week.id(),e.getMessage());
        }
    }
}
