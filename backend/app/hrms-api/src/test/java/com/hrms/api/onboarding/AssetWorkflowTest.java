package com.hrms.api.onboarding;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.OnboardingAsset;
import com.hrms.employee.repository.*;
import com.hrms.employee.service.OnboardingService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.Optional;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AssetWorkflowTest {
    private final OnboardingAssetRepository assets = mock(OnboardingAssetRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final OnboardingService service = new OnboardingService(mock(OnboardingTemplateRepository.class), mock(OnboardingTaskRepository.class), mock(OnboardingInstanceRepository.class), mock(OnboardingInstanceTaskRepository.class), assets, jdbc);
    @AfterEach void clear() { TenantContext.clear(); }
    private OnboardingAsset asset(String status) {
        OnboardingAsset asset = new OnboardingAsset();
        asset.setId(UUID.randomUUID()); asset.setCompanyId(UUID.randomUUID()); asset.setStatus(status);
        when(assets.findById(asset.getId())).thenReturn(Optional.of(asset));
        when(assets.save(asset)).thenReturn(asset);
        return asset;
    }
    @Test void assignedAssetCannotBeAssignedAgain() {
        var asset = asset("ASSIGNED");
        assertThrows(BusinessRuleException.class, () -> service.assignAsset(asset.getId(), UUID.randomUUID(), null, null));
        verify(assets, never()).save(any());
    }
    @Test void employeeFromAnotherCompanyCannotReceiveAsset() {
        TenantContext.setTenantId(UUID.randomUUID());
        var asset = asset("AVAILABLE");
        assertThrows(BusinessRuleException.class, () -> service.assignAsset(asset.getId(), UUID.randomUUID(), null, null));
        verify(assets, never()).save(any());
    }
    @Test void returnRecordsConditionAndCannotBeRepeated() {
        var asset = asset("ASSIGNED");
        service.returnAsset(asset.getId(), "Screen intact");
        assertEquals("RETURNED", asset.getStatus());
        assertNotNull(asset.getReturnedAt());
        assertEquals("Screen intact", asset.getConditionNotes());
        assertThrows(BusinessRuleException.class, () -> service.returnAsset(asset.getId(), "Duplicate"));
    }
}
