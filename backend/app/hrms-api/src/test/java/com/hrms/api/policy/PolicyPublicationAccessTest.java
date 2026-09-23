package com.hrms.api.policy;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.policy.dto.PolicyResponse;
import com.hrms.policy.entity.HrPolicy;
import com.hrms.policy.entity.PolicyAcknowledgement;
import com.hrms.policy.enums.PolicyStatus;
import com.hrms.policy.repository.HrPolicyRepository;
import com.hrms.policy.repository.PolicyAcknowledgementRepository;
import com.hrms.policy.service.PolicyService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PolicyPublicationAccessTest {
    private Jwt caller(boolean author) {
        return Jwt.withTokenValue("test").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("permissions", author ? List.of("hrms.policy.read", "hrms.policy.write") : List.of("hrms.policy.read"))
                .build();
    }

    @Test void directUrlsPreserveAuthorPreviewsButHideUnpublishedTextFromEmployees() {
        var service = mock(PolicyService.class);
        var controller = new PolicyController(service, mock(EmployeeRepository.class));
        UUID id = UUID.randomUUID();
        for (PolicyStatus status : PolicyStatus.values()) {
            var policy = new PolicyResponse(id, UUID.randomUUID(), "Policy", "GENERAL", "Unpublished content",
                    "v1.0", null, status, 0, null);
            when(service.getPolicy(id)).thenReturn(policy);
            assertEquals(policy, controller.getPolicy(id, caller(true)).getBody());
            if (status == PolicyStatus.ACTIVE) assertEquals(policy, controller.getPolicy(id, caller(false)).getBody());
            else assertThrows(AccessDeniedException.class, () -> controller.getPolicy(id, caller(false)));
        }
    }

    @Test void draftAndArchivedPoliciesCannotAcquireAcknowledgements() {
        var policies = mock(HrPolicyRepository.class);
        var acknowledgements = mock(PolicyAcknowledgementRepository.class);
        var service = new PolicyService(policies, acknowledgements);
        UUID id = UUID.randomUUID();
        for (PolicyStatus status : List.of(PolicyStatus.DRAFT, PolicyStatus.ARCHIVED)) {
            var policy = new HrPolicy();
            policy.setId(id); policy.setStatus(status);
            when(policies.findById(id)).thenReturn(Optional.of(policy));
            var error = assertThrows(BusinessRuleException.class, () -> service.acknowledge(id, UUID.randomUUID()));
            assertEquals("POLICY_NOT_ACTIVE", error.getErrorCode());
        }
        verifyNoInteractions(acknowledgements);
    }

    @Test void activePolicyNewVersionNeedsItsOwnAcknowledgementWithoutDuplicatingCurrentVersion() {
        var policies = mock(HrPolicyRepository.class);
        var acknowledgements = mock(PolicyAcknowledgementRepository.class);
        var service = new PolicyService(policies, acknowledgements);
        UUID id = UUID.randomUUID(), employee = UUID.randomUUID();
        var policy = new HrPolicy();
        policy.setId(id); policy.setStatus(PolicyStatus.ACTIVE); policy.setPolicyVersion("v2.0");
        var previous = new PolicyAcknowledgement();
        previous.setPolicyId(id); previous.setEmployeeId(employee); previous.setPolicyVersion("v1.0");
        when(policies.findById(id)).thenReturn(Optional.of(policy));
        when(acknowledgements.findByEmployeeId(employee)).thenReturn(List.of(previous));
        com.hrms.core.tenant.TenantContext.setTenantId(UUID.randomUUID());
        try {
            service.acknowledge(id, employee);
            var captured = ArgumentCaptor.forClass(PolicyAcknowledgement.class);
            verify(acknowledgements).save(captured.capture());
            assertEquals("v2.0", captured.getValue().getPolicyVersion());
            assertEquals(employee, captured.getValue().getEmployeeId());
            when(acknowledgements.findByEmployeeId(employee)).thenReturn(List.of(previous, captured.getValue()));
            service.acknowledge(id, employee);
            verify(acknowledgements, times(1)).save(any());
        } finally { com.hrms.core.tenant.TenantContext.clear(); }
    }
}
