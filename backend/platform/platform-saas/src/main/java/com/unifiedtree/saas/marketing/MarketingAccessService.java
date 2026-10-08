package com.unifiedtree.saas.marketing;

import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyAccessView;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyEntry;
import com.unifiedtree.rbac.company.CompanyAccessService.RoleEntry;
import com.unifiedtree.rbac.company.CompanyAccess;
import com.unifiedtree.auth.service.WorkspaceSignInRule;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.Entitlement;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * UnifiedTree's answers for Marketing Automation: may this account work in this
 * company, as what, and has the company bought Marketing?
 *
 * <p>Company access is the HRMS team's {@link CompanyAccessService} (rbac.user_company_access
 * + workspace-wide roles), run inside the account's workspace so its row-level
 * security applies — Marketing does not get its own idea of who belongs where.
 * Entitlement is {@link CompanyEntitlementService} for module {@value #MODULE}.
 *
 * <p>Also mints and redeems the single-use SSO handoff tickets (V144.105). A ticket is
 * 32 random bytes; only its SHA-256 is stored, it lives {@link #TICKET_TTL}, and
 * redeeming it is one atomic UPDATE, so it cannot be used twice. Access and
 * entitlement are checked again at redemption, not only when it was minted.
 */
@Service
public class MarketingAccessService {

    /** Catalogue module that is Marketing Automation (V035; linked to plan `marketing` in V144.105). */
    public static final String MODULE = CompanyEntitlementService.MARKETING_MODULE;
    public static final String AUDIENCE = "marketing";
    public static final Duration TICKET_TTL = Duration.ofSeconds(60);

    /** Why a ticket was refused (401), in the body's {@code code}: unknown or malformed, already redeemed, past its minute */
    public static final String TICKET_INVALID = "TICKET_INVALID";
    public static final String TICKET_USED = "TICKET_USED";
    public static final String TICKET_EXPIRED = "TICKET_EXPIRED";

    /** Roles that make someone an administrator of the company's Marketing (owner principal). */
    static final Set<String> MARKETING_ADMIN_ROLES = Set.of("OWNER", "SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN");
    static final Set<String> MARKETING_ADMIN_WORKSPACE_ROLES = Set.of("OWNER", "ADMIN");

    private final JdbcTemplate jdbc;
    private final TenantScopedReader scoped;
    private final CompanyAccessService companyAccess;
    private final CompanyEntitlementService entitlements;
    private final ObjectMapper json;
    private final TransactionTemplate consumeTx;
    private final SecureRandom random = new SecureRandom();

    public MarketingAccessService(JdbcTemplate jdbc, TenantScopedReader scoped, CompanyAccessService companyAccess,
                                  CompanyEntitlementService entitlements, ObjectMapper json,
                                  PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.scoped = scoped;
        this.companyAccess = companyAccess;
        this.entitlements = entitlements;
        this.json = json;
        // Consuming a ticket commits on its own, so a refused re-verify cannot roll it back into a redeemable state.
        this.consumeTx = new TransactionTemplate(transactionManager);
        this.consumeTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    // ── DTOs (the versioned contract Marketing consumes) ────────────────────

    /** Contract version of every DTO below; bump on a breaking change. */
    public static final int CONTRACT_VERSION = 1;

    public record MarketingEntitlement(int contractVersion, UUID tenantId, UUID companyId, boolean entitled,
                                       String source, String status, Instant endsAt, String planKey,
                                       String planName, Map<String, Object> limits, boolean limitsDefined,
                                       String billingMode, long version, Instant checkedAt) {}

    public record MarketingIdentity(int contractVersion, UUID accountId, String email, String displayName,
                                    UUID tenantId, String workspaceSubdomain, String workspaceName,
                                    String workspaceRole, UUID companyId, String companyName, String access,
                                    List<String> companyRoles, boolean marketingAdmin, UUID authUserId,
                                    MarketingEntitlement entitlement, PrincipalMapping principal) {}

    /** Which Mongo users already stand for this company and person (null = not mapped yet). */
    public record PrincipalMapping(String companyOwnerLegacyUserId, String memberLegacyUserId) {}

    public record CompanyChoice(UUID companyId, String name, String logoUrl, boolean home, String access,
                                List<String> roles, boolean marketingEntitled) {}

    public record WorkspaceChoice(UUID tenantId, String subdomain, String displayName, String workspaceRole,
                                  List<CompanyChoice> companies) {}

    public record Handoff(String ticket, Instant expiresAt) {}

    // ── Entitlement ─────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public MarketingEntitlement entitlement(UUID tenantId, UUID companyId) {
        // A company-level row says "entitled" whatever tenant is passed, so the pair is checked first: the company
        // must be visible under that workspace's RLS binding. Writes are covered by composite FKs; this is the read.
        Boolean active = scoped.read(tenantId, () -> jdbc.query(
                "SELECT is_active FROM org.companies WHERE id = ?", (rs, i) -> rs.getBoolean(1), companyId)
                .stream().findFirst().orElse(null));
        if (active == null) {
            throw new MarketingRefusal(HttpStatus.NOT_FOUND, "COMPANY_NOT_FOUND",
                    "COMPANY_NOT_FOUND: That company is not in that workspace");
        }
        if (!active) throw forbidden("COMPANY_INACTIVE", "That company has been archived");
        Entitlement e = entitlements.resolve(tenantId, companyId, MODULE);
        Map<String, Object> plan = marketingPlan(e.subscriptionId());
        Map<String, Object> limits = new LinkedHashMap<>(parse((String) (plan == null ? null : plan.get("limits"))));
        if (e.limits() != null) limits.putAll(e.limits());   // a company's negotiated limits win over its plan's
        String mode = jdbc.query("""
                SELECT billing_mode FROM platform.marketing_channel_accounts
                 WHERE company_id = ? AND status = 'ACTIVE' ORDER BY created_at LIMIT 1
                """, (rs, i) -> rs.getString(1), companyId).stream().findFirst().orElse("DIRECT_CUSTOMER");
        return new MarketingEntitlement(CONTRACT_VERSION, tenantId, companyId, e.entitled(), e.source(), e.status(),
                e.endsAt(), plan == null ? null : (String) plan.get("key"),
                plan == null ? null : (String) plan.get("display_name"), limits, !limits.isEmpty(), mode,
                e.version(), Instant.now());
    }

    // ── Access ──────────────────────────────────────────────────────────────

    /**
     * Verify that the account may work in the company in Marketing, and describe them.
     * 403 with a specific code when not: not a member, workspace not active, the workspace
     * user is switched off or locked in HRMS ({@link WorkspaceSignInRule}, the same rule as
     * the HRMS session), no access to the company, or the company has not bought Marketing.
     */
    public MarketingIdentity verify(UUID accountId, UUID tenantId, UUID companyId) {
        Map<String, Object> m = membership(accountId, tenantId);
        UUID authUserId = (UUID) m.get("auth_user_id");
        requireWorkspaceSignIn(tenantId, authUserId);
        CompanyAccessCheck check = companyAccessCheck(tenantId, authUserId, companyId);
        CompanyEntry company = check.company();
        if (company == null) {
            throw forbidden("COMPANY_ACCESS_DENIED", "You do not have access to that company");
        }
        MarketingEntitlement ent = entitlement(tenantId, companyId);
        if (!ent.entitled()) {
            throw forbidden("MARKETING_NOT_ENTITLED", "This company does not have Marketing Automation");
        }
        String workspaceRole = (String) m.get("role");
        List<String> roles = company.roles().stream().map(RoleEntry::code).distinct().toList();
        // Only BUILT-IN roles count: a workspace can create a custom role coded "ADMIN", which must not make its
        // holders the company's Marketing owner (same rule as CompanyAccess.Profile.workspaceWide()).
        boolean admin = MARKETING_ADMIN_WORKSPACE_ROLES.contains(workspaceRole) || check.systemAdmin();
        return new MarketingIdentity(CONTRACT_VERSION, accountId, (String) m.get("email"),
                (String) m.get("display_name"), tenantId, (String) m.get("subdomain"), (String) m.get("ws_name"),
                workspaceRole, companyId, company.name(), company.access(), roles, admin, authUserId, ent,
                principal(accountId, companyId));
    }

    /** Every workspace and company the account could enter Marketing with. */
    public List<WorkspaceChoice> choices(UUID accountId) {
        List<Map<String, Object>> memberships = jdbc.queryForList("""
                SELECT aw.tenant_id, aw.auth_user_id, aw.role::text AS role, t.subdomain, t.display_name
                  FROM platform.account_workspaces aw JOIN platform.tenants t ON t.id = aw.tenant_id
                 WHERE aw.account_id = ? AND aw.status = 'ACTIVE' AND t.status = 'ACTIVE'
                 ORDER BY aw.default_workspace DESC, t.subdomain
                """, accountId);
        List<WorkspaceChoice> out = new ArrayList<>();
        for (Map<String, Object> m : memberships) {
            UUID tenantId = (UUID) m.get("tenant_id");
            CompanyAccessView view = scoped.read(tenantId,
                    () -> companyAccess.view(companyAccess.profile((UUID) m.get("auth_user_id")), false));
            Map<UUID, UUID> toTenant = new LinkedHashMap<>();
            view.companies().forEach(c -> toTenant.put(c.companyId(), tenantId));
            Map<UUID, List<String>> products = entitlements.effectiveModules(toTenant);
            List<CompanyChoice> companies = view.companies().stream().map(c -> new CompanyChoice(c.companyId(),
                    c.name(), c.logoUrl(), c.home(), c.access(), c.roles().stream().map(RoleEntry::code).distinct().toList(),
                    products.getOrDefault(c.companyId(), List.of()).contains(MODULE))).toList();
            out.add(new WorkspaceChoice(tenantId, (String) m.get("subdomain"), (String) m.get("display_name"),
                    (String) m.get("role"), companies));
        }
        return out;
    }

    // ── SSO tickets ─────────────────────────────────────────────────────────

    /** Check everything now, then mint a single-use ticket for Marketing to redeem. */
    @Transactional
    public Handoff mint(UUID accountId, UUID tenantId, UUID companyId, String ip, String userAgent) {
        MarketingIdentity id = verify(accountId, tenantId, companyId);
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String ticket = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        Instant now = jdbc.queryForObject("SELECT now()", Timestamp.class).toInstant();
        Instant expires = now.plus(TICKET_TTL);
        jdbc.update("""
                INSERT INTO platform.sso_handoff_tickets
                       (ticket_hash, audience, account_id, tenant_id, company_id, auth_user_id, created_at,
                        expires_at, created_ip, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, sha256(ticket), AUDIENCE, accountId, tenantId, companyId, id.authUserId(), Timestamp.from(now),
                Timestamp.from(expires), clip(ip, 45), clip(userAgent, 300));
        // Expired tickets have no use after their minute; keep the table small.
        jdbc.update("DELETE FROM platform.sso_handoff_tickets WHERE expires_at < now() - interval '1 day'");
        return new Handoff(ticket, expires);
    }

    /**
     * Redeem a ticket once, then re-verify the account, company and entitlement.
     * 401 when the ticket is unknown ({@value #TICKET_INVALID}), already used ({@value #TICKET_USED}) or expired
     * ({@value #TICKET_EXPIRED}). The ticket is consumed in its own committed transaction first: a re-verify that
     * refuses (403) leaves it used, not redeemable again.
     */
    public MarketingIdentity redeem(String ticket) {
        if (ticket == null || ticket.length() < 20 || ticket.length() > 100) {
            throw new MarketingRefusal(HttpStatus.UNAUTHORIZED, TICKET_INVALID, "Invalid handoff ticket");
        }
        String hash = sha256(ticket);
        List<Map<String, Object>> used = consumeTx.execute(status -> jdbc.queryForList("""
                UPDATE platform.sso_handoff_tickets SET consumed_at = now()
                 WHERE ticket_hash = ? AND audience = ? AND consumed_at IS NULL AND expires_at > now()
                RETURNING account_id, tenant_id, company_id
                """, hash, AUDIENCE));
        if (used.isEmpty()) {
            // One message for all three, as before; the code says which
            throw new MarketingRefusal(HttpStatus.UNAUTHORIZED, whyNotRedeemable(hash),
                    "Handoff ticket is invalid, expired or already used");
        }
        Map<String, Object> t = used.get(0);
        return verify((UUID) t.get("account_id"), (UUID) t.get("tenant_id"), (UUID) t.get("company_id"));
    }

    // ── Identity map ────────────────────────────────────────────────────────

    /** Record which Mongo user stands for a company (COMPANY_OWNER) or a person in it (MEMBER). */
    @Transactional
    public PrincipalMapping recordPrincipal(String kind, String legacyUserId, UUID accountId, UUID tenantId,
                                            UUID companyId, String legacyRole, String legacyEmail) {
        String k = kind == null ? "" : kind.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("COMPANY_OWNER", "MEMBER").contains(k)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "kind must be COMPANY_OWNER or MEMBER");
        }
        if (legacyUserId == null || !legacyUserId.matches("^[0-9a-f]{24}$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "legacyMarketingUserId must be a Mongo ObjectId");
        }
        if ("MEMBER".equals(k) && accountId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A MEMBER mapping needs accountId");
        }
        if ("MEMBER".equals(k) && actorUserId(accountId, tenantId) == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That account is not a member of the workspace");
        }
        int written;
        try {
            // Only a PENDING row (found by the backfill) or this company's own MAPPED row may be (re)written. A Mongo
            // user MAPPED to another company, or QUARANTINED/RETIRED by an operator, is never re-pointed by the
            // service: the WHERE makes the upsert a no-op, reported as a conflict below.
            written = jdbc.update("""
                    INSERT INTO platform.marketing_identity_map
                           (kind, legacy_marketing_user_id, legacy_role, legacy_email, account_id, tenant_id,
                            company_id, status, source, mapped_at, mapped_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'MAPPED', 'SSO', now(), 'marketing-service')
                    ON CONFLICT (legacy_marketing_user_id) DO UPDATE
                       SET kind = EXCLUDED.kind, account_id = EXCLUDED.account_id, tenant_id = EXCLUDED.tenant_id,
                           company_id = EXCLUDED.company_id, legacy_role = EXCLUDED.legacy_role,
                           legacy_email = EXCLUDED.legacy_email, status = 'MAPPED', mapped_at = now(),
                           updated_at = now()
                     WHERE platform.marketing_identity_map.status = 'PENDING'
                        OR (platform.marketing_identity_map.status = 'MAPPED'
                            AND platform.marketing_identity_map.company_id IS NOT DISTINCT FROM EXCLUDED.company_id)
                    """, k, legacyUserId, legacyRole, legacyEmail, accountId, tenantId, companyId);
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            // Unique: one owner principal per company, one member principal per (account, company).
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "PRINCIPAL_CONFLICT: That company or person already has a different Marketing principal");
        }
        if (written == 0) {
            String held = jdbc.query("SELECT status FROM platform.marketing_identity_map WHERE legacy_marketing_user_id = ?",
                    (rs, i) -> rs.getString(1), legacyUserId).stream().findFirst().orElse(null);
            throw new ResponseStatusException(HttpStatus.CONFLICT, "QUARANTINED".equals(held) || "RETIRED".equals(held)
                    ? "PRINCIPAL_HELD: That Marketing user is " + held.toLowerCase(Locale.ROOT) + " by an operator"
                    : "PRINCIPAL_CONFLICT: That Marketing user is already mapped to a different company");
        }
        return principal(accountId, companyId);
    }

    /**
     * Retire an identity mapping (operator action). Returns the retired row's kind, Mongo user and company; 404 when
     * the mapping does not exist, 409 when it is already retired.
     */
    @Transactional
    public Map<String, Object> retireMapping(UUID mappingId) {
        List<Map<String, Object>> retired = jdbc.queryForList("""
                UPDATE platform.marketing_identity_map SET status = 'RETIRED', updated_at = now()
                 WHERE id = ? AND status <> 'RETIRED'
                RETURNING kind, legacy_marketing_user_id, company_id
                """, mappingId);
        if (!retired.isEmpty()) return retired.get(0);
        Integer exists = jdbc.queryForObject(
                "SELECT count(*) FROM platform.marketing_identity_map WHERE id = ?", Integer.class, mappingId);
        throw exists != null && exists > 0
                ? new ResponseStatusException(HttpStatus.CONFLICT, "That mapping is already retired")
                : new ResponseStatusException(HttpStatus.NOT_FOUND, "Mapping not found");
    }

    /**
     * The workspace user an account acts as in one workspace (audit.events records actors by that id), or null when
     * the account is not an active member there. platform.account_workspaces has no RLS.
     */
    /** The account's sign-in email, or null */
    public String accountEmail(UUID accountId) {
        if (accountId == null) return null;
        return jdbc.query("SELECT email FROM platform.accounts WHERE id = ?", (rs, i) -> rs.getString(1), accountId)
                .stream().findFirst().orElse(null);
    }

    public UUID actorUserId(UUID accountId, UUID tenantId) {
        if (accountId == null || tenantId == null) return null;
        return jdbc.query("""
                SELECT auth_user_id FROM platform.account_workspaces
                 WHERE account_id = ? AND tenant_id = ? AND status = 'ACTIVE'
                """, (rs, i) -> (UUID) rs.getObject(1), accountId, tenantId).stream().findFirst().orElse(null);
    }

    public PrincipalMapping principal(UUID accountId, UUID companyId) {
        String owner = jdbc.query("""
                SELECT legacy_marketing_user_id FROM platform.marketing_identity_map
                 WHERE kind = 'COMPANY_OWNER' AND status = 'MAPPED' AND company_id = ?
                """, (rs, i) -> rs.getString(1), companyId).stream().findFirst().orElse(null);
        String member = accountId == null ? null : jdbc.query("""
                SELECT legacy_marketing_user_id FROM platform.marketing_identity_map
                 WHERE kind = 'MEMBER' AND status = 'MAPPED' AND account_id = ? AND company_id = ?
                """, (rs, i) -> rs.getString(1), accountId, companyId).stream().findFirst().orElse(null);
        return new PrincipalMapping(owner, member);
    }

    // ── internals ───────────────────────────────────────────────────────────

    /**
     * Why a ticket could not be consumed, read after the refused UPDATE: used wins over expired; no row (never minted,
     * another audience, or expired over a day ago and cleaned up) is invalid. Only the hash is looked up.
     */
    private String whyNotRedeemable(String hash) {
        Map<String, Object> row = jdbc.queryForList("""
                SELECT consumed_at IS NOT NULL AS used, expires_at <= now() AS expired
                  FROM platform.sso_handoff_tickets WHERE ticket_hash = ? AND audience = ?
                """, hash, AUDIENCE).stream().findFirst().orElse(null);
        if (row == null) return TICKET_INVALID;
        if (Boolean.TRUE.equals(row.get("used"))) return TICKET_USED;
        return Boolean.TRUE.equals(row.get("expired")) ? TICKET_EXPIRED : TICKET_INVALID;
    }

    private Map<String, Object> membership(UUID accountId, UUID tenantId) {
        List<Map<String, Object>> m = jdbc.queryForList("""
                SELECT aw.auth_user_id, aw.role::text AS role, a.email, a.display_name, a.status::text AS acct_status,
                       t.subdomain, t.display_name AS ws_name, t.status AS ws_status
                  FROM platform.account_workspaces aw
                  JOIN platform.accounts a ON a.id = aw.account_id
                  JOIN platform.tenants t ON t.id = aw.tenant_id
                 WHERE aw.account_id = ? AND aw.tenant_id = ? AND aw.status = 'ACTIVE'
                """, accountId, tenantId);
        if (m.isEmpty()) throw forbidden("NOT_A_MEMBER", "You are not a member of that workspace");
        Map<String, Object> row = m.get(0);
        if (!"ACTIVE".equals(row.get("acct_status"))) throw forbidden("ACCOUNT_INACTIVE", "This account is not active");
        if (!"ACTIVE".equals(row.get("ws_status"))) throw forbidden("WORKSPACE_INACTIVE", "That workspace is not active");
        return row;
    }

    /**
     * The workspace user behind the membership must be allowed in right now: the same {@link WorkspaceSignInRule} as
     * {@code AuthService.issueWorkspaceSession}. auth.user_credentials is FORCE RLS, so it is read inside the workspace.
     */
    private void requireWorkspaceSignIn(UUID tenantId, UUID authUserId) {
        Map<String, Object> creds = authUserId == null ? null : scoped.read(tenantId, () -> jdbc.queryForList(
                "SELECT is_active, locked_until FROM auth.user_credentials WHERE id = ?", authUserId)
                .stream().findFirst().orElse(null));
        if (creds == null) throw forbidden(WorkspaceSignInRule.ACCOUNT_INACTIVE, "This workspace user no longer exists");
        Timestamp lockedUntil = (Timestamp) creds.get("locked_until");
        WorkspaceSignInRule.refusal(Boolean.TRUE.equals(creds.get("is_active")),
                lockedUntil == null ? null : lockedUntil.toInstant().atOffset(ZoneOffset.UTC),
                OffsetDateTime.now(ZoneOffset.UTC)).ifPresent(code -> {
            throw forbidden(code, WorkspaceSignInRule.ACCOUNT_INACTIVE.equals(code)
                    ? "This user has been deactivated in the workspace" : "This user is temporarily locked");
        });
    }

    /** One person in one company: the company entry (null = no access) and whether a built-in admin role applies. */
    private record CompanyAccessCheck(CompanyEntry company, boolean systemAdmin) {}

    private CompanyAccessCheck companyAccessCheck(UUID tenantId, UUID authUserId, UUID companyId) {
        return scoped.read(tenantId, () -> {
            CompanyAccess.Profile profile = companyAccess.profile(authUserId);
            CompanyEntry entry = companyAccess.view(profile, false).companies().stream()
                    .filter(c -> c.companyId().equals(companyId) && c.active()).findFirst().orElse(null);
            boolean systemAdmin = profile.roles().stream()
                    .anyMatch(r -> r.system() && MARKETING_ADMIN_ROLES.contains(r.code()))
                    || profile.grants().stream().anyMatch(g -> companyId.equals(g.companyId()) && g.role().system()
                            && MARKETING_ADMIN_ROLES.contains(g.role().code()));
            return new CompanyAccessCheck(entry, systemAdmin);
        });
    }

    /** The plan behind Marketing: the subscription's plan if any, else the catalogue's Marketing plan. */
    private Map<String, Object> marketingPlan(UUID subscriptionId) {
        if (subscriptionId != null) {
            List<Map<String, Object>> viaSub = jdbc.queryForList("""
                    SELECT p.key, p.display_name, p.limits::text AS limits
                      FROM platform.subscriptions s JOIN platform.module_plans p ON p.key = ANY (s.plan_keys)
                     WHERE s.id = ? AND ? = ANY (p.included_modules)
                     ORDER BY p.sort_order LIMIT 1
                    """, subscriptionId, MODULE);
            if (!viaSub.isEmpty()) return viaSub.get(0);
        }
        return jdbc.queryForList("""
                SELECT key, display_name, limits::text AS limits FROM platform.module_plans
                 WHERE ? = ANY (included_modules) AND status <> 'RETIRED'
                 ORDER BY sort_order LIMIT 1
                """, MODULE).stream().findFirst().orElse(null);
    }

    private Map<String, Object> parse(String raw) {
        if (raw == null || raw.isBlank()) return Map.of();
        try {
            return json.readValue(raw, new TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseStatusException forbidden(String code, String message) {
        return new MarketingRefusal(HttpStatus.FORBIDDEN, code, code + ": " + message);
    }

    private static String clip(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
