package com.unifiedtree.auth.session;

import java.util.UUID;

/**
 * Someone signed in: a NEW session was issued (password, two-factor step,
 * phone code, invitation activation or a workspace switch). A refresh, which
 * continues a session, is not a sign-in and publishes nothing.
 *
 * <p>Published by {@code AuthService} inside the sign-in transaction; listeners
 * that write elsewhere (the audit log) should run after commit, so a sign-in
 * that rolls back is never recorded.
 */
public record SignedInEvent(UUID tenantId, UUID userId, String email, UUID sessionId,
                            String userAgent, String ipAddress) {}
