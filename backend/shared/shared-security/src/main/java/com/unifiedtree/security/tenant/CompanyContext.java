package com.unifiedtree.security.tenant;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The company a request runs in (docs/redesign/COMPANY_ACCESS.md), bound to the
 * thread for the request by {@code CompanyAccessFilter} next to
 * {@link TenantContext}.
 *
 * <ul>
 *   <li>{@link #getCompanyId()}: the current company the client chose with the
 *       {@code X-Company-Id} header, already checked to be one the caller may
 *       access. {@code null} without the header: callers then use the person's
 *       home company, exactly as before company access existed.</li>
 *   <li>{@link #getScope()}: set only when the caller's roles and permissions in
 *       the company the request is about (a {@code /companies/{id}} path, else a
 *       {@code companyId} parameter, else the header) differ from their
 *       session's: a company they reach through a grant. The permission checks,
 *       the JWT claims controllers read and {@code /v1/canonical-auth/me} all use it. {@code null} = the session's own
 *       roles and permissions apply (home company, workspace-wide admins).</li>
 * </ul>
 */
public final class CompanyContext {

    /** The caller's roles and permissions in a company they reach through a grant. */
    public record Scope(UUID companyId, Set<UUID> roleIds, List<String> roleCodes, Set<String> permissions) {}

    private static final ThreadLocal<UUID>  COMPANY_ID = new ThreadLocal<>();
    private static final ThreadLocal<Scope> SCOPE      = new ThreadLocal<>();

    private CompanyContext() { }

    public static void setCompanyId(UUID companyId) { COMPANY_ID.set(companyId); }
    public static UUID getCompanyId() { return COMPANY_ID.get(); }

    /**
     * The company an admin-type view works in: the one the client selected with
     * {@code X-Company-Id} (access already checked), else {@code own} (the
     * caller's own company — exactly the behaviour before company access).
     * Self-service ("my leave", "my expenses") keeps using the caller's own
     * company and never calls this.
     */
    public static UUID currentOr(UUID own) {
        UUID selected = COMPANY_ID.get();
        return selected != null ? selected : own;
    }

    public static void setScope(Scope scope) { SCOPE.set(scope); }
    public static Scope getScope() { return SCOPE.get(); }

    public static void clear() {
        COMPANY_ID.remove();
        SCOPE.remove();
    }
}
