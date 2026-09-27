package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.employee.entity.Employee;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/** Colleagues' work anniversaries in the window, from one year on (the milestones' rule; hrms module). */
@Component
class WorkAnniversariesSource implements AroundSource {

    private final JdbcTemplate jdbc;

    WorkAnniversariesSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "WORK_ANNIVERSARY"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return true; }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        return YearlyDates.within(YearlyDates.people(jdbc, "date_of_joining", caller.tenantId(), me.getCompanyId()), from, to)
                .stream()
                .map(o -> {
                    String years = o.years() == 1 ? "1 year" : o.years() + " years";
                    String dept = o.person().department();
                    return new AroundItem("WORK_ANNIVERSARY", o.on(), "ON",
                            YearlyDates.possessive(o.person().name()) + " work anniversary",
                            dept == null || dept.isBlank() ? years : years + " · " + dept,
                            null, o.person().id(), o.person().id(), dept, o.years(), null);
                })
                .toList();
    }
}
