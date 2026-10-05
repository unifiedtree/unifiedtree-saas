package com.hrms.api.settings;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * "Show birthdays to colleagues": on unless the company switched it off, on
 * while the table is missing or can't be read, per company and workspace.
 */
class CelebrationSettingServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    private JdbcTemplate jdbc;
    private CelebrationSettingService service;

    @BeforeEach
    void wire() {
        TenantContext.setTenantId(TENANT);
        jdbc = mock(JdbcTemplate.class);
        service = new CelebrationSettingService(jdbc);
        when(jdbc.queryForObject(eq("SELECT to_regclass(?) IS NOT NULL"), eq(Boolean.class), eq("settings.celebration_settings"))).thenReturn(true);
        when(jdbc.queryForObject(contains("FROM org.companies"), eq(Integer.class), eq(COMPANY), eq(TENANT))).thenReturn(1);
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    private void stored(Boolean... rows) {
        when(jdbc.queryForList(contains("SELECT show_birthdays FROM settings.celebration_settings"), eq(Boolean.class), eq(TENANT), eq(COMPANY)))
                .thenReturn(List.of(rows));
    }

    @Test void birthdaysShowUnlessTheCompanyTurnedThemOff() {
        stored();
        assertTrue(service.showBirthdays(TENANT, COMPANY), "no row: on");
        stored(true);
        assertTrue(service.showBirthdays(TENANT, COMPANY));
        stored(false);
        assertFalse(service.showBirthdays(TENANT, COMPANY));
        assertTrue(service.showBirthdays(null, COMPANY));
        assertTrue(service.showBirthdays(TENANT, null));
    }

    @Test void theSettingIsReadForThatCompanyOfThatWorkspaceOnly() {
        stored(false);
        UUID otherTenant = UUID.randomUUID(), otherCompany = UUID.randomUUID();
        when(jdbc.queryForList(anyString(), eq(Boolean.class), eq(otherTenant), eq(COMPANY))).thenReturn(List.of());
        when(jdbc.queryForList(anyString(), eq(Boolean.class), eq(TENANT), eq(otherCompany))).thenReturn(List.of());
        assertFalse(service.showBirthdays(TENANT, COMPANY));
        assertTrue(service.showBirthdays(otherTenant, COMPANY));
        assertTrue(service.showBirthdays(TENANT, otherCompany));
    }

    @Test void withoutTheTableOrWhenItCantBeReadBirthdaysShowAsToday() {
        when(jdbc.queryForObject(eq("SELECT to_regclass(?) IS NOT NULL"), eq(Boolean.class), eq("settings.celebration_settings"))).thenReturn(false);
        assertTrue(service.showBirthdays(TENANT, COMPANY));
        verify(jdbc, never()).queryForList(anyString(), eq(Boolean.class), any(), any());
        assertThrows(FeatureNotReady.class, () -> service.setting(COMPANY));
        assertThrows(FeatureNotReady.class, () -> service.save(COMPANY, new CelebrationSettingService.SaveRequest(false), null, "HR"));

        when(jdbc.queryForObject(eq("SELECT to_regclass(?) IS NOT NULL"), eq(Boolean.class), eq("settings.celebration_settings"))).thenReturn(true);
        when(jdbc.queryForList(anyString(), eq(Boolean.class), any(), any())).thenThrow(new DataAccessResourceFailureException("down"));
        assertTrue(service.showBirthdays(TENANT, COMPANY));
    }

    @Test void aCompanyThatNeverSavedItReadsOn() {
        when(jdbc.query(contains("FROM settings.celebration_settings"), any(RowMapper.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of());
        CelebrationSettingService.Setting s = service.setting(COMPANY);
        assertTrue(s.showBirthdays());
        assertEquals(COMPANY, s.companyId());
        assertNull(s.updatedAt());
    }

    @Test void savingNeedsTheChoiceAndACompanyOfThisWorkspace() {
        assertEquals("CELEBRATION_SETTING_REQUIRED", assertThrows(BusinessRuleException.class,
                () -> service.save(COMPANY, new CelebrationSettingService.SaveRequest(null), null, "HR")).getErrorCode());
        assertEquals("CELEBRATION_SETTING_REQUIRED", assertThrows(BusinessRuleException.class,
                () -> service.save(COMPANY, null, null, "HR")).getErrorCode());
        UUID elsewhere = UUID.randomUUID();
        when(jdbc.queryForObject(contains("FROM org.companies"), eq(Integer.class), eq(elsewhere), eq(TENANT))).thenReturn(0);
        assertThrows(RuntimeException.class, () -> service.save(elsewhere, new CelebrationSettingService.SaveRequest(false), null, "HR"));
        verify(jdbc, never()).update(contains("INSERT INTO settings.celebration_settings"), any(), any(), any(), any(), any());
    }

    @Test void savingWritesThisCompanysRow() {
        when(jdbc.query(contains("FROM settings.celebration_settings"), any(RowMapper.class), eq(TENANT), eq(COMPANY)))
                .thenReturn(List.of(new CelebrationSettingService.Setting(COMPANY, false, "HR Manager", null)));
        UUID user = UUID.randomUUID();
        CelebrationSettingService.Setting s = service.save(COMPANY, new CelebrationSettingService.SaveRequest(false), user, "HR Manager");
        assertFalse(s.showBirthdays());
        verify(jdbc).update(contains("ON CONFLICT (tenant_id, company_id) DO UPDATE"), eq(TENANT), eq(COMPANY), eq(false), eq(user), eq("HR Manager"));
    }
}
