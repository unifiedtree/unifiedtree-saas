package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The tasks of my own onboarding checklist that are mine to do: owned by the
 * EMPLOYEE role, still pending, on a checklist in progress. People outside HR
 * can complete tasks only on their own checklist (OnboardingController), so
 * that is all this looks at. Needs {@code hrms.onboarding.task.complete} (to do
 * them) and {@code hrms.onboarding.instance.read} (to open the checklist); hrms
 * module. A task past its due date is red.
 */
@Component
class OnboardingTasksSource implements NeedsYouSource {

    private final JdbcTemplate jdbc;

    OnboardingTasksSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "ONBOARDING_TASK"; }
    @Override public String module() { return "hrms"; }

    @Override
    public boolean allowed(EssCaller caller) {
        return caller.has("hrms.onboarding.task.complete") && caller.has("hrms.onboarding.instance.read");
    }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        return jdbc.query("""
                SELECT t.id, t.title, t.due_on, t.is_required
                  FROM hrms.onboarding_instance_tasks t
                  JOIN hrms.onboarding_instances i ON i.id = t.instance_id AND i.tenant_id = t.tenant_id
                 WHERE t.tenant_id = ? AND i.employee_id = ? AND i.status = 'IN_PROGRESS'
                   AND t.owner_role = 'EMPLOYEE' AND t.status = 'PENDING'
                 ORDER BY t.due_on NULLS LAST, t.sequence_no
                """, (rs, i) -> {
                    LocalDate due = rs.getObject("due_on", LocalDate.class);
                    boolean late = due != null && due.isBefore(caller.today());
                    String title = rs.getString("title");
                    return new NeedsYouItem("ONBOARDING_TASK", title == null || title.isBlank() ? "Onboarding task" : title.trim(),
                            rs.getBoolean("is_required") ? "Onboarding · required" : "Onboarding",
                            null, due, late ? NeedsYouItem.BAD : NeedsYouItem.BRAND, rs.getObject("id", UUID.class), 1,
                            "/hrms/onboarding/instances?view=hires");
                }, caller.tenantId(), caller.employeeId());
    }
}
