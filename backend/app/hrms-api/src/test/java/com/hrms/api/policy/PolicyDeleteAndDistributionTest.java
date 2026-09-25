package com.hrms.api.policy;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.policy.dto.PolicyRequest;
import com.hrms.policy.entity.HrPolicy;
import com.hrms.policy.enums.PolicyStatus;
import com.hrms.policy.repository.HrPolicyRepository;
import com.hrms.policy.repository.PolicyAcknowledgementRepository;
import com.hrms.policy.service.PolicyService;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Policy delete, optional acknowledgement, email on publish and the reminder setting (V143.23). */
class PolicyDeleteAndDistributionTest {

    private final HrPolicyRepository policies = mock(HrPolicyRepository.class);
    private final PolicyService service = new PolicyService(policies, mock(PolicyAcknowledgementRepository.class));

    private HrPolicy policy(PolicyStatus status) {
        HrPolicy p = new HrPolicy();
        p.setId(UUID.randomUUID());
        p.setStatus(status);
        when(policies.findById(p.getId())).thenReturn(Optional.of(p));
        when(policies.save(any())).thenAnswer(i -> i.getArgument(0));
        return p;
    }

    @Test void aDraftIsDeletedButAPublishedPolicyIsOnlyArchived() {
        HrPolicy draft = policy(PolicyStatus.DRAFT);
        assertEquals(PolicyService.DeleteOutcome.DELETED, service.deletePolicy(draft.getId()));
        verify(policies).delete(draft);

        HrPolicy live = policy(PolicyStatus.ACTIVE);
        assertEquals(PolicyService.DeleteOutcome.ARCHIVED, service.deletePolicy(live.getId()));
        assertEquals(PolicyStatus.ARCHIVED, live.getStatus());
        verify(policies, never()).delete(live);

        HrPolicy archived = policy(PolicyStatus.ARCHIVED);
        assertEquals(PolicyService.DeleteOutcome.ARCHIVED, service.deletePolicy(archived.getId()));
        verify(policies, never()).delete(archived);
    }

    @Test void publishingStampsTheTimeTheAutomaticReminderCountsFrom() {
        HrPolicy draft = policy(PolicyStatus.DRAFT);
        var r = service.publishPolicy(draft.getId());
        assertEquals(PolicyStatus.ACTIVE, r.status());
        assertNotNull(r.publishedAt());
    }

    @Test void distributionSettingsAreKeptWhenAClientLeavesThemOut() {
        HrPolicy p = policy(PolicyStatus.ACTIVE);
        service.updatePolicy(p.getId(), new PolicyRequest(null, "Leave policy", "HR", "Text", "v1", null, null, false, true, 7));
        assertFalse(p.isAcknowledgementRequired());
        assertTrue(p.isNotifyOnPublish());
        assertEquals(7, p.getAutoRemindAfterDays());
        // The pre-V143.23 shape (the kit Manage tab, the mobile app) sends none of them.
        var r = service.updatePolicy(p.getId(), new PolicyRequest(null, "Leave policy", "HR", "Text", "v1", null, null));
        assertFalse(r.acknowledgementRequired());
        assertTrue(r.notifyOnPublish());
        assertEquals(7, r.autoRemindAfterDays());
        // 0 turns the automatic reminder off; more than 90 days is refused.
        service.updatePolicy(p.getId(), new PolicyRequest(null, "Leave policy", "HR", "Text", "v1", null, null, null, null, 0));
        assertNull(p.getAutoRemindAfterDays());
        var e = assertThrows(BusinessRuleException.class, () -> service.updatePolicy(p.getId(),
                new PolicyRequest(null, "Leave policy", "HR", "Text", "v1", null, null, null, null, 91)));
        assertEquals("POLICY_REMIND_DAYS_INVALID", e.getErrorCode());
    }
}
