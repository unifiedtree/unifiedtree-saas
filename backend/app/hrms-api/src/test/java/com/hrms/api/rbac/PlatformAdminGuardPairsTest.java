package com.hrms.api.rbac;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.expression.EvaluationContext;
import org.springframework.expression.Expression;
import org.springframework.security.access.expression.ExpressionUtils;
import org.springframework.security.access.expression.method.DefaultMethodSecurityExpressionHandler;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.util.SimpleMethodInvocation;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V143_92 takes platform.* off the workspace role SUPER_ADMIN. Many workspace
 * screens are guarded "workspace code OR platform.admin" (roles, permissions,
 * users, companies, branches, departments, designations, contractors), so a
 * SUPER_ADMIN or OWNER must still get in through the workspace code alone.
 *
 * <p>Every such guard in the API is found by scanning, and evaluated with
 * Spring's own expression handler for a workspace SUPER_ADMIN and OWNER who
 * hold exactly the codes V143_92 makes sure SUPER_ADMIN has (read from the
 * migration itself) and no platform.* at all. A new "or platform.admin" guard
 * whose workspace code is not in that list fails here.
 */
class PlatformAdminGuardPairsTest {

    private static final Path MIGRATION = Path.of(
            "../hrms-app/src/main/resources/db/canonical/V143_92__platform_permissions_only_for_platform_admin.sql");

    private static final DefaultMethodSecurityExpressionHandler HANDLER = new DefaultMethodSecurityExpressionHandler();

    private static Set<String> ensuredForSuperAdmin;
    private static Map<Method, String> platformAdminGuards;

    @BeforeAll
    static void load() throws Exception {
        String sql = Files.readString(MIGRATION);
        Matcher in = Pattern.compile("ON p\\.code IN \\(([^)]*)\\)").matcher(sql);
        assertTrue(in.find(), "V143_92 lists the codes it grants SUPER_ADMIN");
        ensuredForSuperAdmin = new LinkedHashSet<>();
        Matcher code = Pattern.compile("'([^']+)'").matcher(in.group(1));
        while (code.find()) ensuredForSuperAdmin.add(code.group(1));

        platformAdminGuards = new LinkedHashMap<>();
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        for (BeanDefinition def : scanner.findCandidateComponents("com.hrms.api")) {
            Class<?> type = Class.forName(def.getBeanClassName(), false, PlatformAdminGuardPairsTest.class.getClassLoader());
            for (Method m : type.getDeclaredMethods()) {
                PreAuthorize guard = m.getAnnotation(PreAuthorize.class);
                if (guard != null && guard.value().contains("'platform.admin'")) platformAdminGuards.put(m, guard.value());
            }
        }
    }

    private static Authentication workspaceUser(List<String> roles, Set<String> permissions) {
        Jwt jwt = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", UUID.randomUUID().toString(), "tenant_id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
        List<GrantedAuthority> authorities = new ArrayList<>();
        roles.forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
        permissions.forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
        return new JwtAuthenticationToken(jwt, authorities);
    }

    private static boolean allows(Method method, String guard, Authentication who) {
        Expression expression = HANDLER.getExpressionParser().parseExpression(guard);
        EvaluationContext context = HANDLER.createEvaluationContext(() -> who,
                new SimpleMethodInvocation(new Object(), method, new Object[method.getParameterCount()]));
        return ExpressionUtils.evaluateAsBoolean(expression, context);
    }

    @Test
    void theScanFindsTheKnownGuards() {
        // RbacController (6), PlatformUserController (2), WorkforceController (6) at the time of V143_92.
        assertTrue(platformAdminGuards.size() >= 14, "found " + platformAdminGuards.size() + ": " + platformAdminGuards.keySet());
        assertFalse(ensuredForSuperAdmin.stream().anyMatch(c -> c.startsWith("platform.")));
    }

    @Test
    void superAdminAndOwnerGetThroughEveryGuardWithoutPlatformCodes() {
        Authentication superAdmin = workspaceUser(List.of("SUPER_ADMIN"), ensuredForSuperAdmin);
        Authentication owner = workspaceUser(List.of("OWNER", "SUPER_ADMIN"), ensuredForSuperAdmin);
        List<String> shut = new ArrayList<>();
        platformAdminGuards.forEach((m, guard) -> {
            if (!allows(m, guard, superAdmin) || !allows(m, guard, owner)) {
                shut.add(m.getDeclaringClass().getSimpleName() + "." + m.getName() + " [" + guard + "]");
            }
        });
        assertTrue(shut.isEmpty(), "Add the workspace code of these guards to V143_92's SUPER_ADMIN list: " + shut);
    }

    @Test
    void someoneWithNoneOfTheCodesIsStillRefused() {
        Authentication nobody = workspaceUser(List.of("EMPLOYEE"), Set.of("attendance.checkin.self"));
        platformAdminGuards.forEach((m, guard) ->
                assertFalse(allows(m, guard, nobody), m.getName() + " let in a caller with none of its codes"));
    }
}
