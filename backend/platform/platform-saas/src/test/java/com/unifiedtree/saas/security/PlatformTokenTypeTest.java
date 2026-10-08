package com.unifiedtree.saas.security;

import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.dto.SaasDtos.PlatformLoginResponse;
import com.unifiedtree.saas.service.SaasService;
import com.unifiedtree.saas.service.SaasWriter;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * F1 (9 Oct 2026): the operator console takes only the operator door's token. The token
 * {@code SaasService.platformLogin} mints, decoded and turned into authorities the way
 * CanonicalProdSecurityConfig does, passes {@code @platformAdmin.check}; a workspace token for the very
 * same operator in the platform tenant (what /v1/canonical-auth/login and refresh used to mint) does not.
 */
class PlatformTokenTypeTest {

    static final UUID PLATFORM = SaasService.PLATFORM_TENANT_ID;
    static final List<String> PERMS = List.of("platform.admin", "platform.tenant.read");

    private final JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef-test-key", "unifiedtree", 720, 7);
    private final NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(jwt.signingKey()).build();
    private final PlatformAdminAccess access = new PlatformAdminAccess();
    private final UUID operator = UUID.randomUUID();

    /** Same authorities as CanonicalProdSecurityConfig.jwtAuthenticationConverter. */
    private JwtAuthenticationToken authenticate(String token) {
        Jwt decoded = decoder.decode(token);
        List<GrantedAuthority> authorities = new ArrayList<>();
        decoded.getClaimAsStringList("roles").forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
        decoded.getClaimAsStringList("permissions").forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
        return new JwtAuthenticationToken(decoded, authorities, decoded.getSubject());
    }

    @SuppressWarnings("unchecked")
    @Test
    void theOperatorDoorsTokenOpensTheConsole() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PasswordService passwords = mock(PasswordService.class);
        when(jdbc.queryForObject(contains("FROM auth.user_credentials"), any(RowMapper.class), eq(PLATFORM), eq("ops@unifiedtree.test")))
                .thenReturn(new Object[] {operator, "hash", true});
        when(passwords.matches("right", "hash")).thenReturn(true);
        when(jdbc.queryForList(contains("SELECT r.code"), eq(String.class), eq(PLATFORM), eq(operator)))
                .thenReturn(List.of("PLATFORM_SUPER_ADMIN"));
        when(jdbc.queryForList(contains("permission_code"), eq(String.class), eq(PLATFORM), eq(operator))).thenReturn(PERMS);
        when(jdbc.query(contains("display_name"), any(ResultSetExtractor.class), eq(PLATFORM))).thenReturn("UnifiedTree Platform");
        SaasService saas = new SaasService(jdbc, mock(SaasWriter.class), jwt, passwords, "unifiedtree.com",
                null, null, null, null, null);

        PlatformLoginResponse out = saas.platformLogin("ops@unifiedtree.test", "right");

        Jwt decoded = decoder.decode(out.accessToken());
        assertThat(decoded.getClaimAsString("token_type")).isEqualTo(JwtService.PLATFORM_TOKEN_TYPE);
        assertThat(decoded.getClaimAsString("tenant_id")).isEqualTo(PLATFORM.toString());
        assertThat(decoded.getClaimAsString("sid")).isNull();
        assertThat(access.check(authenticate(out.accessToken()))).isTrue();
    }

    @Test
    void aWorkspaceTokenForTheSameOperatorIsRefused() {
        String workspace = jwt.issueAccessToken(operator, PLATFORM, "ops@unifiedtree.test",
                List.of("PLATFORM_SUPER_ADMIN"), PERMS, null, UUID.randomUUID()).token();
        assertThat(decoder.decode(workspace).getClaimAsString("token_type")).isNull();
        assertThat(access.check(authenticate(workspace))).isFalse();
    }

    @Test
    void anAccountOrStationTokenIsRefused() {
        assertThat(access.check(authenticate(jwt.issueAccountToken(UUID.randomUUID(), "a@b.test").token()))).isFalse();
        assertThat(access.check(authenticate(jwt.issueStationToken(UUID.randomUUID(), PLATFORM,
                java.time.Duration.ofMinutes(5)).token()))).isFalse();
    }

    @Test
    void aPlatformTokenWithoutThePlatformRoleIsRefused() {
        String token = jwt.issuePlatformToken(operator, PLATFORM, "ops@unifiedtree.test", List.of("SUPER_ADMIN"), PERMS).token();
        assertThat(access.check(authenticate(token))).isFalse();
    }

    @Test
    void aPlatformTokenTypeForABusinessIsRefused() {
        String token = jwt.issuePlatformToken(operator, UUID.randomUUID(), "ops@unifiedtree.test",
                List.of("PLATFORM_SUPER_ADMIN"), PERMS).token();
        assertThat(access.check(authenticate(token))).isFalse();
    }
}
