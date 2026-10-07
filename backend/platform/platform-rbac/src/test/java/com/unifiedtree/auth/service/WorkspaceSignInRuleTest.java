package com.unifiedtree.auth.service;

import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

/** The one rule that lets a workspace user into HRMS and into Marketing. */
class WorkspaceSignInRuleTest {

    static final OffsetDateTime NOW = OffsetDateTime.of(2026, 10, 7, 12, 0, 0, 0, ZoneOffset.UTC);

    @Test
    void anActiveUnlockedUserMaySignIn() {
        assertThat(WorkspaceSignInRule.refusal(true, null, NOW)).isEmpty();
        assertThat(WorkspaceSignInRule.refusal(true, NOW.minusMinutes(1), NOW)).isEmpty();
    }

    @Test
    void aDeactivatedUserIsRefusedEvenWhenAlsoLocked() {
        assertThat(WorkspaceSignInRule.refusal(false, null, NOW)).contains(WorkspaceSignInRule.ACCOUNT_INACTIVE);
        assertThat(WorkspaceSignInRule.refusal(false, NOW.plusHours(1), NOW))
                .contains(WorkspaceSignInRule.ACCOUNT_INACTIVE);
    }

    @Test
    void aLockedUserIsRefusedUntilTheLockEnds() {
        assertThat(WorkspaceSignInRule.refusal(true, NOW.plusMinutes(5), NOW)).contains(WorkspaceSignInRule.ACCOUNT_LOCKED);
        assertThat(WorkspaceSignInRule.refusal(true, NOW, NOW)).isEmpty();
    }
}
