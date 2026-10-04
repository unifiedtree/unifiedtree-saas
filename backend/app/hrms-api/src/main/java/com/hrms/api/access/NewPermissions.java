package com.hrms.api.access;

import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Which permissions are "new" for a role a business made itself (V143.69).
 *
 * <p>Every new permission ships to the built-in roles only: migrations grant it
 * {@code WHERE r.tenant_id IS NULL}. A role a business made (tenant_id set)
 * deliberately gets nothing automatically, because nobody can know what it is
 * for, so its admin is told instead and decides. Pure (no database, no clock):
 * {@link RoleReviewService} loads the rows and these rules pick, so every rule
 * is unit-tested (NewPermissionsTest). A permission is new for a role when:
 * <ul>
 *   <li>the role is business-made ({@code tenant_id} set; built-in roles never
 *       get a notice);</li>
 *   <li>the permission is dated ({@code added_at} set; permissions that existed
 *       before dating began never count) and was added after the role was last
 *       reviewed, or, never reviewed, after the role was made;</li>
 *   <li>the role doesn't hold it;</li>
 *   <li>it isn't a {@code platform} permission (those belong to the people who
 *       run the platform, not to a workspace);</li>
 *   <li>its module is switched on for the workspace, by the rule Users &amp;
 *       access already uses ({@link WorkspaceAccessService#PERM_MODULE_TO_GATED_KEY}:
 *       a permission module listed there needs that key ACTIVE in
 *       {@code platform.tenant_modules}; every other module is always on).</li>
 * </ul>
 */
public final class NewPermissions {

    private NewPermissions() {}

    static final String PLATFORM_MODULE = "platform";

    /** One catalogue row; {@code addedAt} is null for permissions from before V143.69. */
    public record Catalogued(String code, String displayName, String module, String description,
                             String riskLevel, String warning, Instant addedAt) {}

    /** One role; {@code tenantId} is null for a built-in role, {@code reviewedAt} null when never reviewed. */
    public record RoleDates(UUID id, UUID tenantId, Instant createdAt, Instant reviewedAt) {}

    /** The permissions that are new for {@code role}, by module then code; empty for a built-in role. */
    static List<Catalogued> forRole(RoleDates role, Collection<Catalogued> catalogue, Set<String> held,
                                    Set<String> activeModuleKeys) {
        if (role == null || role.tenantId() == null) return List.of();
        Instant since = role.reviewedAt() != null ? role.reviewedAt() : role.createdAt();
        if (since == null) return List.of();
        return catalogue.stream()
                .filter(p -> p.addedAt() != null && p.addedAt().isAfter(since))
                .filter(p -> held == null || !held.contains(p.code()))
                .filter(p -> !PLATFORM_MODULE.equals(p.module()))
                .filter(p -> moduleOn(p.module(), activeModuleKeys))
                .sorted(Comparator.comparing(Catalogued::module, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(Catalogued::code))
                .toList();
    }

    /** Whether a permission's module is on for the workspace (see the class note). */
    static boolean moduleOn(String permissionModule, Set<String> activeModuleKeys) {
        Map<String, String> gated = WorkspaceAccessService.PERM_MODULE_TO_GATED_KEY;
        String key = permissionModule == null ? null : gated.get(permissionModule);
        return key == null || (activeModuleKeys != null && activeModuleKeys.contains(key));
    }
}
