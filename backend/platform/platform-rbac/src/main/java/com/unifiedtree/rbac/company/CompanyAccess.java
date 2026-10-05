package com.unifiedtree.rbac.company;

import java.time.OffsetDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The company-access rules (docs/redesign/COMPANY_ACCESS.md). Pure: no
 * database, so every rule is unit-tested on its own. {@link CompanyAccessService}
 * loads a person's {@link Profile} and applies these.
 *
 * <ol>
 *   <li>A person's <b>home company</b> is the company of their employee record.
 *       Their roles there are their normal roles ({@code rbac.user_roles}).</li>
 *   <li>Holding a <b>workspace-wide role</b> (built-in OWNER, SUPER_ADMIN, ADMIN,
 *       COMPANY_ADMIN, HR_MANAGER, FINANCE_LEAD) means every company, with the
 *       same permissions everywhere — what everyone had before company access.</li>
 *   <li>A login with <b>no employee record</b> also keeps every company: it has
 *       no home company to be scoped to (today's behaviour).</li>
 *   <li>Everyone else reaches their home company plus the companies they hold a
 *       <b>grant</b> for ({@code rbac.user_company_access}), with the granted
 *       roles there.</li>
 * </ol>
 */
public final class CompanyAccess {

    private CompanyAccess() {}

    /** Built-in roles that cover every company of the workspace. */
    public static final Set<String> WORKSPACE_WIDE_ROLES =
            Set.of("OWNER", "SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "HR_MANAGER", "FINANCE_LEAD");

    /** Roles that cover the whole business, so they are given as roles, never per company. */
    public static final Set<String> NOT_GRANTABLE_PER_COMPANY = Set.of("OWNER", "SUPER_ADMIN", "ADMIN");

    /** How a person reaches a company. */
    public static final String VIA_WORKSPACE = "WORKSPACE";
    public static final String VIA_HOME = "HOME";
    public static final String VIA_GRANT = "GRANT";

    /** A role; {@code system} = built-in ({@code rbac.roles.tenant_id IS NULL}). */
    public record RoleRef(UUID id, String code, String name, boolean system) {}

    /** One role granted in one company. */
    public record Grant(UUID companyId, RoleRef role, UUID grantedBy, OffsetDateTime grantedAt) {}

    /**
     * Everything the rules need about one person.
     *
     * @param known      false when the login was not found in this workspace
     * @param employeeId their employee record, or null
     * @param homeCompanyId the company of that record, or null
     * @param roles      their normal roles ({@code rbac.user_roles})
     * @param grants     their company grants (empty before V143.93 is applied)
     */
    public record Profile(UUID userId, boolean known, UUID employeeId, UUID homeCompanyId,
                          List<RoleRef> roles, List<Grant> grants) {

        public Profile {
            roles = roles == null ? List.of() : List.copyOf(roles);
            grants = grants == null ? List.of() : List.copyOf(grants);
        }

        /** Holds a built-in workspace-wide role. */
        public boolean workspaceWide() {
            return roles.stream().anyMatch(r -> r.system() && WORKSPACE_WIDE_ROLES.contains(r.code()));
        }

        /** Reaches every company of the workspace with the session's own permissions. */
        public boolean allCompanies() {
            if (!known) return false;
            return workspaceWide() || homeCompanyId == null;
        }

        /** May this person work in this company? (Existence is checked separately for all-companies people.) */
        public boolean canAccess(UUID companyId) {
            if (companyId == null) return false;
            if (allCompanies()) return true;
            if (companyId.equals(homeCompanyId)) return true;
            return grants.stream().anyMatch(g -> g.companyId().equals(companyId));
        }

        /**
         * Whether a request in this company runs with permissions other than the
         * session's: only a granted company of a company-scoped person.
         */
        public boolean needsScope(UUID companyId) {
            return companyId != null && !allCompanies() && !companyId.equals(homeCompanyId) && canAccess(companyId);
        }

        /** The roles granted in one company (de-duplicated, in grant order). */
        public List<RoleRef> grantedRoles(UUID companyId) {
            LinkedHashSet<RoleRef> out = new LinkedHashSet<>();
            for (Grant g : grants) if (g.companyId().equals(companyId)) out.add(g.role());
            return List.copyOf(out);
        }

        /** Companies this person may access, or {@code null} when that is every company. */
        public Set<UUID> accessibleCompanyIds() {
            if (allCompanies()) return null;
            LinkedHashSet<UUID> out = new LinkedHashSet<>();
            if (homeCompanyId != null) out.add(homeCompanyId);
            for (Grant g : grants) out.add(g.companyId());
            return out;
        }
    }
}
