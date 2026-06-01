package com.unifiedtree.rbac.security;

import java.util.UUID;

/**
 * Published by RbacService whenever a role is granted or revoked for a user,
 * or when a custom role's permission set changes.
 *
 * <p>PermissionChecker listens for this and drops the affected entry from its
 * Caffeine cache, ensuring revocation takes effect within the next request
 * (not after the 60-second TTL expires).
 */
public record PermissionCacheEvictEvent(UUID tenantId, UUID userId) { }
