package com.unifiedtree.saas.payment.subscription;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Owner, Q-26 (9 Oct 2026): the plan endpoints follow "Can buy and manage plans and billing", not role names. */
class BillingPermissionTest {

    @Test
    void theBillingPermissionAloneManagesThePlan() {
        // A custom role (or one person) the owner gave only billing.
        assertThat(WorkspacePlanController.canManageBilling(List.of("workspace.billing.manage", "hrms.leave.read"))).isTrue();
    }

    @Test
    void theOwnersOlderPermissionStillPasses() {
        assertThat(WorkspacePlanController.canManageBilling(List.of("tenant.settings.write"))).isTrue();
        assertThat(WorkspacePlanController.canManageBilling(List.of("*"))).isTrue();
    }

    @Test
    void anHrManagerOrAdminWithoutItCannot() {
        assertThat(WorkspacePlanController.canManageBilling(List.of("hrms.employee.write", "workspace.users.manage", "rbac.role.write"))).isFalse();
        assertThat(WorkspacePlanController.canManageBilling(List.of())).isFalse();
        assertThat(WorkspacePlanController.canManageBilling(null)).isFalse();
    }
}
