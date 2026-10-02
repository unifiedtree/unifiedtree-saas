package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.api.workforce.RetirementService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionOperations;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** "Upcoming events" includes retirements (DECISIONS 21): the caller's company, in the window, sorted with the rest. */
class RetirementsSourceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final UUID ME = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 1);

    @Test void retirementsAreTheCallersCompanyInTheWindow() {
        RetirementService retirement = mock(RetirementService.class);
        UUID who = UUID.randomUUID();
        when(retirement.between(TENANT, TODAY, TODAY, TODAY.plusDays(14), COMPANY)).thenReturn(List.of(
                new RetirementService.RetirementDue(who, "E9", "Ravi Kumar", "RK", "Finance", "Manager", COMPANY, "Demo", 60, TODAY.plusDays(9), 9)));
        Employee me = new Employee();
        me.setId(ME);
        me.setCompanyId(COMPANY);
        EmployeeRepository employees = mock(EmployeeRepository.class);
        when(employees.findById(ME)).thenReturn(Optional.of(me));
        TenantModuleLookup modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), any())).thenReturn(true);

        RetirementsSource s = new RetirementsSource(retirement);
        EssCaller caller = new EssCaller(TENANT, ME, Set.of(), null, TODAY);
        assertEquals("RETIREMENT", s.key());
        assertEquals("hrms", s.module());
        assertTrue(s.allowed(caller), "anyone signed in, as the milestones");

        AroundItem.Response r = new AroundMeService(List.of(s), new EssSourceRunner(modules, TransactionOperations.withoutTransaction()), employees)
                .aroundMe(caller, 14);
        assertEquals(List.of("RETIREMENT"), r.included());
        AroundItem item = r.items().get(0);
        assertEquals("Ravi Kumar retires", item.title());
        assertEquals(TODAY.plusDays(9), item.date());
        assertEquals(60, item.years());
        assertEquals("Finance", item.detail());
        assertEquals(who, item.employeeId());
        verify(retirement).between(TENANT, TODAY, TODAY, TODAY.plusDays(14), COMPANY);
    }

    @Test void onTheSameDayRetirementsComeBeforeBirthdays() {
        AroundItem bday = new AroundItem("BIRTHDAY", TODAY, "ON", "A", null, null, null, null, null, null, null);
        AroundItem retire = new AroundItem("RETIREMENT", TODAY, "ON", "Z", null, null, null, null, null, null, null);
        assertEquals(List.of(retire, bday), List.of(bday, retire).stream().sorted(AroundMeService.ORDER).toList());
    }
}
