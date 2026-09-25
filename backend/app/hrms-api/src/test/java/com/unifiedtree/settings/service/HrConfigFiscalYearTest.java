package com.unifiedtree.settings.service;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.settings.dto.SettingsDtos.UpdateHrConfigRequest;
import com.unifiedtree.settings.entity.HrConfiguration;
import com.unifiedtree.settings.repository.HrConfigurationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** One fiscal year per company (D2): HR Configuration reads and writes the company record. */
class HrConfigFiscalYearTest {

    private final UUID company = UUID.randomUUID();
    private HrConfigurationRepository repo;
    private JdbcTemplate jdbc;
    private HrConfigurationService service;

    @BeforeEach void setUp() {
        repo = mock(HrConfigurationRepository.class);
        jdbc = mock(JdbcTemplate.class);
        when(repo.findByCompanyId(company)).thenReturn(Optional.empty());
        when(repo.save(any(HrConfiguration.class))).thenAnswer(i -> i.getArgument(0));
        service = new HrConfigurationService(repo, jdbc);
    }

    @SuppressWarnings("unchecked")
    private void companyHas(String month) {
        when(jdbc.query(contains("FROM org.companies"), any(ResultSetExtractor.class), eq(company))).thenReturn(month);
    }

    private static UpdateHrConfigRequest fiscal(String month) {
        return new UpdateHrConfigRequest(month, null, null, null, null, null, null, null, null, null, null, null, null);
    }

    @Test void readsTheCompanyRecord() {
        companyHas("JANUARY");
        assertEquals("JANUARY", service.getOrDefault(company).fiscalYearStart());
        assertEquals("JANUARY", service.fiscalYearStart(company));
    }

    @Test void aCompanyWithoutOneGetsTheIndianFinancialYear() {
        companyHas(null);
        assertEquals("APRIL", service.fiscalYearStart(company));
        companyHas("not a month");
        assertEquals("APRIL", service.getOrDefault(company).fiscalYearStart());
        assertEquals("APRIL", service.fiscalYearStart(null));
    }

    @Test void savingWritesTheCompanyRecordNotTheHrCopy() {
        companyHas("JULY");
        when(jdbc.update(contains("UPDATE org.companies SET fiscal_year_start"), eq("JULY"), eq(company))).thenReturn(1);
        assertEquals("JULY", service.update(company, fiscal(" july ")).fiscalYearStart());
        verify(jdbc).update(contains("UPDATE org.companies SET fiscal_year_start"), eq("JULY"), eq(company));
    }

    @Test void aMonthNameIsRequired() {
        BusinessRuleException ex = assertThrows(BusinessRuleException.class, () -> service.update(company, fiscal("Q2")));
        assertTrue(ex.getMessage().contains("month"));
        verify(jdbc, never()).update(contains("UPDATE org.companies"), any(), any());
    }

    @Test void otherSettingsDontTouchTheCompany() {
        companyHas("APRIL");
        service.update(company, new UpdateHrConfigRequest(null, 30, 3, 58, null, null, null, null, null, null, null, null, null));
        verify(jdbc, never()).update(contains("UPDATE org.companies"), any(), any());
    }
}
