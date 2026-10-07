package com.unifiedtree.auth.service;

import java.time.OffsetDateTime;
import java.util.Optional;

/**
 * Whether a workspace user ({@code auth.user_credentials}) may be given a session right now. One rule for every way
 * into a workspace: the HRMS session ({@link AuthService#issueWorkspaceSession}) and Marketing sign-in
 * (MarketingAccessService) both ask it, so a person switched off or locked in HRMS is refused everywhere.
 */
public final class WorkspaceSignInRule {

    public static final String ACCOUNT_INACTIVE = "ACCOUNT_INACTIVE";
    public static final String ACCOUNT_LOCKED = "ACCOUNT_LOCKED";

    private WorkspaceSignInRule() {}

    /** Empty when the user may sign in; otherwise the refusal code. */
    public static Optional<String> refusal(boolean active, OffsetDateTime lockedUntil, OffsetDateTime now) {
        if (!active) return Optional.of(ACCOUNT_INACTIVE);
        if (lockedUntil != null && lockedUntil.isAfter(now)) return Optional.of(ACCOUNT_LOCKED);
        return Optional.empty();
    }
}
