package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.settings.CelebrationSettingService;
import com.hrms.employee.entity.Employee;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * Colleagues' birthdays in the window (the milestones' rule: anyone signed in; hrms module),
 * none when the caller's company hides birthdays from colleagues ({@link CelebrationSettingService}).
 */
@Component
class BirthdaysSource implements AroundSource {

    private final JdbcTemplate jdbc;
    /** Null in tests that don't care: birthdays then always show. */
    private final CelebrationSettingService settings;

    BirthdaysSource(JdbcTemplate jdbc, CelebrationSettingService settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    @Override public String key() { return "BIRTHDAY"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return true; }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        if (settings != null && !settings.showBirthdays(caller.tenantId(), me.getCompanyId())) return List.of();
        return YearlyDates.within(YearlyDates.people(jdbc, "date_of_birth", caller.tenantId(), me.getCompanyId()), from, to)
                .stream()
                .map(o -> new AroundItem("BIRTHDAY", o.on(), "ON", YearlyDates.possessive(o.person().name()) + " birthday",
                        o.person().department(), null, o.person().id(), o.person().id(), o.person().department(), null, null))
                .toList();
    }
}
