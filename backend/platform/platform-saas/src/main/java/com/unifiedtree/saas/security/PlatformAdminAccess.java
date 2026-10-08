package com.unifiedtree.saas.security;

import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.saas.service.SaasService;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * {@code @platformAdmin.check(authentication)}: is the caller one of UnifiedTree's
 * own platform operators, signed in through {@code POST /v1/platform/auth/login}?
 *
 * <p>A permission code alone is not enough for the platform endpoints: the
 * workspace role SUPER_ADMIN, which every business owner gets at sign-up, held
 * platform.tenant.* until V143_92, so any owner could list every business's
 * contact details. A platform token is the one {@code SaasService.platformLogin}
 * issues ({@code JwtService.issuePlatformToken}): {@code token_type=platform}, its
 * {@code tenant_id} claim is the platform tenant and its roles include
 * PLATFORM_SUPER_ADMIN. A workspace token never has that token type, whatever
 * tenant and permissions it carries, so it is refused even if a grant slips back
 * in, and so is a workspace session in the platform tenant (F1, 9 Oct 2026: the
 * workspace sign-in used to hand operators one, with a refresh token).
 */
@Component("platformAdmin")
public class PlatformAdminAccess {

    static final String PLATFORM_ROLE = "ROLE_PLATFORM_SUPER_ADMIN";

    public boolean check(Authentication authentication) {
        if (!(authentication instanceof JwtAuthenticationToken jwt) || !authentication.isAuthenticated()) {
            return false;
        }
        if (!JwtService.PLATFORM_TOKEN_TYPE.equals(jwt.getToken().getClaimAsString("token_type"))) {
            return false;
        }
        if (!SaasService.PLATFORM_TENANT_ID.toString().equals(jwt.getToken().getClaimAsString("tenant_id"))) {
            return false;
        }
        return authentication.getAuthorities().stream().anyMatch(a -> PLATFORM_ROLE.equals(a.getAuthority()));
    }
}
