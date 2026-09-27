package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.employee.entity.Employee;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/** Colleagues' birthdays in the window (the milestones' rule: anyone signed in; hrms module). */
@Component
class BirthdaysSource implements AroundSource {

    private final JdbcTemplate jdbc;

    BirthdaysSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "BIRTHDAY"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return true; }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        return YearlyDates.within(YearlyDates.people(jdbc, "date_of_birth", caller.tenantId(), me.getCompanyId()), from, to)
                .stream()
                .map(o -> new AroundItem("BIRTHDAY", o.on(), "ON", YearlyDates.possessive(o.person().name()) + " birthday",
                        o.person().department(), null, o.person().id(), o.person().id(), o.person().department(), null, null))
                .toList();
    }
}
