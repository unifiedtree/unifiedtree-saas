package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.workforce.RetirementService;
import com.hrms.employee.entity.Employee;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * Colleagues who retire in the window, in the caller's company: the dashboard
 * milestones' retirement list ({@code GET /v1/hrms/milestones}, open to anyone
 * signed in), worked out by {@link RetirementService} at each company's
 * retirement age. "Upcoming events" covers retirements (DECISIONS 21); hrms module.
 */
@Component
class RetirementsSource implements AroundSource {

    private final RetirementService retirements;

    RetirementsSource(RetirementService retirements) {
        this.retirements = retirements;
    }

    @Override public String key() { return "RETIREMENT"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return true; }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        return retirements.between(caller.tenantId(), caller.today(), from, to, me.getCompanyId()).stream()
                .map(r -> new AroundItem("RETIREMENT", r.retirementDate(), "ON", r.name() + " retires",
                        r.department(), null, r.employeeId(), r.employeeId(), r.department(), r.retirementAge(), null))
                .toList();
    }
}
