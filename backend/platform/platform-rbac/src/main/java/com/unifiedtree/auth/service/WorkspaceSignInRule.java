package com.unifiedtree.auth.service;

import com.unifiedtree.security.tenant.TenantContext;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

/**
 * Whether a workspace user ({@code auth.user_credentials}) may be given a session right now. One rule for every way
 * into a workspace: the HRMS session ({@link AuthService#issueWorkspaceSession}) and Marketing sign-in
 * (MarketingAccessService) both ask it, so a person switched off or locked in HRMS is refused everywhere.
 */
public final class WorkspaceSignInRule {

    public static final String ACCOUNT_INACTIVE = "ACCOUNT_INACTIVE";
    public static final String ACCOUNT_LOCKED = "ACCOUNT_LOCKED";

    /** UnifiedTree's own platform operators hold this role, in the platform tenant only. */
    public static final String PLATFORM_OPERATOR_ROLE = "PLATFORM_SUPER_ADMIN";

    private WorkspaceSignInRule() {}

    /** Empty when the user may sign in; otherwise the refusal code. */
    public static Optional<String> refusal(boolean active, OffsetDateTime lockedUntil, OffsetDateTime now) {
        if (!active) return Optional.of(ACCOUNT_INACTIVE);
        if (lockedUntil != null && lockedUntil.isAfter(now)) return Optional.of(ACCOUNT_LOCKED);
        return Optional.empty();
    }

    /**
     * A UnifiedTree platform operator, not a workspace user: a login in the platform tenant
     * ({@link TenantContext#PLATFORM_TENANT_ID}), or one holding PLATFORM_SUPER_ADMIN. Operators sign in only at
     * {@code POST /v1/platform/auth/login} (a short-lived token, no refresh). Every workspace way in (password,
     * two-factor, refresh, phone, Google, account hand-over, invite) refuses them as if the login did not exist
     * (F1, 9 Oct 2026: the workspace door used to hand operators a long-lived workspace session that opened the
     * operator console).
     */
    public static boolean isPlatformOperator(UUID tenantId, Collection<String> roleCodes) {
        if (TenantContext.PLATFORM_TENANT_ID.equals(tenantId)) return true;
        return roleCodes != null && roleCodes.contains(PLATFORM_OPERATOR_ROLE);
    }
}
