package com.unifiedtree.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {}

    /**
     * Login request. {@code tenantId} is OPTIONAL: when omitted, the server
     * resolves the workspace from the email via {@code auth.resolve_login_tenant}
     * (the mobile app sends only email + password — no workspace field). When
     * present (e.g. subdomain-scoped web login), it is used directly.
     */
    public record LoginRequest(
            UUID tenantId,
            @NotBlank @Email String email,
            @NotBlank String password,
            /**
             * True when the client can show the two-factor step (the web app
             * sends it). When the account needs a two-factor code and this is
             * not set (the mobile app today), sign-in is refused with a message
             * that says how to sign in instead, rather than issuing a session
             * without the code.
             */
            Boolean mfaCapable
    ) {
        public LoginRequest(UUID tenantId, String email, String password) {
            this(tenantId, email, password, null);
        }
        @Override public String toString() { return "LoginRequest[credentials=REDACTED]"; }
    }

    /**
     * Sign-in that stopped at the two-factor step: the password was right and
     * the client now asks for a code ({@code mfaRequired}) or, when the
     * workspace requires two-factor and the person has not set it up yet, walks
     * them through set-up ({@code mfaSetupRequired}). {@code mfaToken} carries
     * the sign-in to POST /v1/canonical-auth/login/mfa and expires in 10 minutes.
     */
    public record MfaChallengeResponse(
            boolean mfaRequired,
            boolean mfaSetupRequired,
            String mfaToken,
            String email
    ) {
        @Override public String toString() { return "MfaChallengeResponse[token=REDACTED]"; }
    }

    public record LoginResponse(
            String accessToken,
            String refreshToken,
            Instant accessTokenExpiresAt,
            UUID userId,
            UUID employeeId,
            UUID tenantId,
            String email,
            String firstName,
            String lastName,
            List<String> roles,
            List<String> permissions
    ) {
        @Override public String toString() { return "LoginResponse[tokens=REDACTED]"; }
    }

    public record RefreshRequest(
            @NotBlank String refreshToken
    ) {
        @Override public String toString() { return "RefreshRequest[token=REDACTED]"; }
    }

    public record MeResponse(
            UUID userId,
            UUID tenantId,
            String email,
            String firstName,
            String lastName,
            List<String> roles,
            List<String> permissions,
            List<String> activeModules
    ) {
        /** Backward-compatible: callers that don't carry modules get an empty list. */
        public MeResponse(UUID userId, UUID tenantId, String email, String firstName, String lastName,
                          List<String> roles, List<String> permissions) {
            this(userId, tenantId, email, firstName, lastName, roles, permissions, List.of());
        }
    }
}
