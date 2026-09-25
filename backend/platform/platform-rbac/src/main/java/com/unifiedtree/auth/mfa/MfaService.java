package com.unifiedtree.auth.mfa;

import com.hrms.core.crypto.FieldEncryptor;
import com.hrms.core.exception.HrmsException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Two-factor sign-in (TOTP) for a sign-in account: set-up, confirmation,
 * recovery codes, turning it off, checking a code at sign-in, and the
 * workspace rule that can make it compulsory.
 *
 * <p>Every method expects the caller's tenant to be bound already (request
 * thread with TenantContext set, inside the caller's transaction or its own),
 * because auth.user_credentials and auth.mfa_recovery_codes are RLS-isolated.
 *
 * <p>Checking a code never throws: it returns a {@link CheckResult}, so the
 * failed-attempt counter and the lock it can set are committed even when the
 * caller then refuses the request.
 */
@Service
public class MfaService {

    /** Wrong codes in a row before the account is locked for {@link #LOCK_MINUTES}. */
    static final int MAX_FAILED_CODES = 5;
    static final int LOCK_MINUTES = 15;
    static final int RECOVERY_CODE_COUNT = 10;
    /** A QR code that was shown but never confirmed stops working after this. */
    static final int PENDING_SETUP_MINUTES = 30;

    /** Roles covered by the "admins" rule (built-in role codes; custom roles are not). */
    public static final Set<String> ADMIN_ROLE_CODES = Set.of("OWNER", "SUPER_ADMIN", "ADMIN", "HR_MANAGER", "FINANCE_LEAD");

    private static final String RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final SecureRandom RNG = new SecureRandom();

    public enum Policy {
        OFF, ADMINS, EVERYONE;

        public static Policy parse(String s) {
            if (s == null) return OFF;
            try { return Policy.valueOf(s.trim().toUpperCase(Locale.ROOT)); } catch (IllegalArgumentException e) { return OFF; }
        }
    }

    /** What a password sign-in still needs. */
    public enum Requirement { NONE, VERIFY, SETUP }

    public enum CheckResult { OK, OK_RECOVERY, INVALID, LOCKED, NOT_ENABLED, NO_PENDING, ALREADY_ENABLED }

    public record Status(boolean enabled, OffsetDateTime enabledAt, int recoveryCodesLeft,
                         Policy workspacePolicy, boolean requiredForYou) {}

    public record SetupInfo(String secret, String otpauthUrl, String qrSvg, String issuer, String account) {}

    public record CodesResult(CheckResult result, List<String> recoveryCodes) {}

    private final JdbcTemplate jdbc;
    private final FieldEncryptor encryptor;
    private final byte[] recoveryKey;

    public MfaService(JdbcTemplate jdbc, FieldEncryptor encryptor,
                      @Value("${app.pii.encryption-key}") String piiKey) {
        this.jdbc = jdbc;
        this.encryptor = encryptor;
        this.recoveryKey = sha256(("ut-mfa-recovery-v1:" + piiKey).getBytes(StandardCharsets.UTF_8));
    }

    // ---- workspace rule -----------------------------------------------------

    @Transactional(readOnly = true)
    public Policy policy(UUID tenantId) {
        List<String> rows = jdbc.queryForList("SELECT mfa_policy FROM platform.tenants WHERE id = ?", String.class, tenantId);
        return rows.isEmpty() ? Policy.OFF : Policy.parse(rows.get(0));
    }

    /** Whether a workspace rule covers someone holding these role codes. */
    public static boolean policyCovers(Policy policy, Collection<String> roleCodes) {
        if (policy == Policy.EVERYONE) return true;
        if (policy == Policy.ADMINS && roleCodes != null) {
            for (String r : roleCodes) if (r != null && ADMIN_ROLE_CODES.contains(r)) return true;
        }
        return false;
    }

    /** What a correct password still needs before a session is issued. */
    @Transactional(readOnly = true)
    public Requirement requirementFor(UUID tenantId, UUID userId, Collection<String> roleCodes) {
        if (isEnabled(userId)) return Requirement.VERIFY;
        return policyCovers(policy(tenantId), roleCodes) ? Requirement.SETUP : Requirement.NONE;
    }

    @Transactional(readOnly = true)
    public boolean isEnabled(UUID userId) {
        List<Boolean> rows = jdbc.queryForList(
                "SELECT is_mfa_enabled FROM auth.user_credentials WHERE id = ?", Boolean.class, userId);
        return !rows.isEmpty() && Boolean.TRUE.equals(rows.get(0));
    }

    @Transactional(readOnly = true)
    public Status status(UUID tenantId, UUID userId, Collection<String> roleCodes) {
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT is_mfa_enabled, mfa_enabled_at FROM auth.user_credentials WHERE id = ?", userId);
        boolean enabled = Boolean.TRUE.equals(row.get("is_mfa_enabled"));
        Integer left = jdbc.queryForObject(
                "SELECT count(*)::int FROM auth.mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL",
                Integer.class, userId);
        Policy p = policy(tenantId);
        return new Status(enabled, toOffset(row.get("mfa_enabled_at")), enabled && left != null ? left : 0,
                p, policyCovers(p, roleCodes));
    }

    // ---- set-up -------------------------------------------------------------

    /** Start set-up: a new secret is kept as "pending" until a code proves the app has it. */
    @Transactional
    public SetupInfo beginSetup(UUID tenantId, UUID userId) {
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT email, is_mfa_enabled FROM auth.user_credentials WHERE id = ?", userId);
        if (Boolean.TRUE.equals(row.get("is_mfa_enabled"))) {
            throw new HrmsException("Two-factor sign-in is already on for this account.", HttpStatus.CONFLICT, "MFA_ALREADY_ENABLED");
        }
        String secret = Totp.newSecret();
        int n = jdbc.update("""
                UPDATE auth.user_credentials
                   SET mfa_pending_secret_enc = ?, mfa_pending_created_at = now(), updated_at = now()
                 WHERE id = ?
                """, encryptor.encrypt(secret), userId);
        if (n != 1) throw new HrmsException("Your account could not be found.", HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
        String issuer = workspaceName(tenantId);
        String account = (String) row.get("email");
        String url = Totp.otpauthUrl(issuer, account, secret);
        return new SetupInfo(secret, url, QrCode.encodeText(url).toSvg(4, "#0f172a", "#ffffff"), issuer, account);
    }

    /** Finish set-up with a code from the app; returns the recovery codes (shown once). */
    @Transactional
    public CodesResult confirmSetup(UUID tenantId, UUID userId, String code) {
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT is_mfa_enabled, mfa_pending_secret_enc, mfa_pending_created_at
                  FROM auth.user_credentials WHERE id = ? FOR UPDATE
                """, userId);
        if (Boolean.TRUE.equals(row.get("is_mfa_enabled"))) return new CodesResult(CheckResult.ALREADY_ENABLED, List.of());
        String pendingEnc = (String) row.get("mfa_pending_secret_enc");
        OffsetDateTime created = toOffset(row.get("mfa_pending_created_at"));
        if (pendingEnc == null || created == null
                || created.isBefore(OffsetDateTime.now().minusMinutes(PENDING_SETUP_MINUTES))) {
            return new CodesResult(CheckResult.NO_PENDING, List.of());
        }
        long step = Totp.matchStep(encryptor.decrypt(pendingEnc), code, Instant.now(), null);
        if (step < 0) return new CodesResult(CheckResult.INVALID, List.of());
        jdbc.update("""
                UPDATE auth.user_credentials
                   SET is_mfa_enabled = true, mfa_secret_enc = mfa_pending_secret_enc, mfa_enabled_at = now(),
                       mfa_pending_secret_enc = NULL, mfa_pending_created_at = NULL,
                       mfa_last_used_step = ?, mfa_failed_count = 0, updated_at = now()
                 WHERE id = ?
                """, step, userId);
        return new CodesResult(CheckResult.OK, replaceRecoveryCodes(tenantId, userId));
    }

    // ---- checking a code ------------------------------------------------------

    /**
     * Check a 6-digit code or a recovery code. Wrong codes count; the fifth in a
     * row locks the account for {@value #LOCK_MINUTES} minutes.
     */
    @Transactional
    public CheckResult verify(UUID tenantId, UUID userId, String code) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT is_mfa_enabled, mfa_secret_enc, mfa_last_used_step, mfa_failed_count, locked_until
                  FROM auth.user_credentials WHERE id = ? FOR UPDATE
                """, userId);
        if (rows.isEmpty()) return CheckResult.NOT_ENABLED;
        Map<String, Object> row = rows.get(0);
        if (!Boolean.TRUE.equals(row.get("is_mfa_enabled")) || row.get("mfa_secret_enc") == null) return CheckResult.NOT_ENABLED;
        OffsetDateTime lockedUntil = toOffset(row.get("locked_until"));
        if (lockedUntil != null && lockedUntil.isAfter(OffsetDateTime.now())) return CheckResult.LOCKED;

        String c = code == null ? "" : code.trim();
        Long last = row.get("mfa_last_used_step") == null ? null : ((Number) row.get("mfa_last_used_step")).longValue();
        long step = Totp.matchStep(encryptor.decrypt((String) row.get("mfa_secret_enc")), c, Instant.now(), last);
        if (step >= 0) {
            jdbc.update("UPDATE auth.user_credentials SET mfa_last_used_step = ?, mfa_failed_count = 0 WHERE id = ?", step, userId);
            return CheckResult.OK;
        }
        if (looksLikeRecoveryCode(c)) {
            int used = jdbc.update("""
                    UPDATE auth.mfa_recovery_codes SET used_at = now()
                     WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
                    """, userId, hashRecoveryCode(c));
            if (used > 0) {
                jdbc.update("UPDATE auth.user_credentials SET mfa_failed_count = 0 WHERE id = ?", userId);
                return CheckResult.OK_RECOVERY;
            }
        }
        int fails = (row.get("mfa_failed_count") == null ? 0 : ((Number) row.get("mfa_failed_count")).intValue()) + 1;
        if (fails >= MAX_FAILED_CODES) {
            jdbc.update("""
                    UPDATE auth.user_credentials
                       SET mfa_failed_count = 0, locked_until = now() + make_interval(mins => ?)
                     WHERE id = ?
                    """, LOCK_MINUTES, userId);
            return CheckResult.LOCKED;
        }
        jdbc.update("UPDATE auth.user_credentials SET mfa_failed_count = ? WHERE id = ?", fails, userId);
        return CheckResult.INVALID;
    }

    /** Turn two-factor off after a correct code. */
    @Transactional
    public CheckResult disable(UUID tenantId, UUID userId, String code) {
        CheckResult r = verify(tenantId, userId, code);
        if (r == CheckResult.OK || r == CheckResult.OK_RECOVERY) clear(userId);
        return r;
    }

    /** New recovery codes after a correct code; the old ones stop working. */
    @Transactional
    public CodesResult regenerateRecoveryCodes(UUID tenantId, UUID userId, String code) {
        CheckResult r = verify(tenantId, userId, code);
        if (r != CheckResult.OK && r != CheckResult.OK_RECOVERY) return new CodesResult(r, List.of());
        return new CodesResult(r, replaceRecoveryCodes(tenantId, userId));
    }

    /** An admin turns someone's two-factor off (lost phone and codes). */
    @Transactional
    public boolean adminReset(UUID userId) {
        return clear(userId) > 0;
    }

    private int clear(UUID userId) {
        jdbc.update("DELETE FROM auth.mfa_recovery_codes WHERE user_id = ?", userId);
        return jdbc.update("""
                UPDATE auth.user_credentials
                   SET is_mfa_enabled = false, mfa_secret_enc = NULL, mfa_enabled_at = NULL,
                       mfa_pending_secret_enc = NULL, mfa_pending_created_at = NULL,
                       mfa_last_used_step = NULL, mfa_failed_count = 0, updated_at = now()
                 WHERE id = ? AND is_mfa_enabled
                """, userId);
    }

    // ---- recovery codes ---------------------------------------------------------

    private List<String> replaceRecoveryCodes(UUID tenantId, UUID userId) {
        jdbc.update("DELETE FROM auth.mfa_recovery_codes WHERE user_id = ?", userId);
        List<String> codes = new ArrayList<>(RECOVERY_CODE_COUNT);
        for (int i = 0; i < RECOVERY_CODE_COUNT; i++) {
            String code = newRecoveryCode();
            codes.add(code);
            jdbc.update("INSERT INTO auth.mfa_recovery_codes (id, tenant_id, user_id, code_hash) VALUES (?, ?, ?, ?)",
                    UUID.randomUUID(), tenantId, userId, hashRecoveryCode(code));
        }
        return codes;
    }

    /** Ten characters from an unambiguous alphabet, shown as XXXXX-XXXXX. */
    static String newRecoveryCode() {
        StringBuilder sb = new StringBuilder(11);
        for (int i = 0; i < 10; i++) {
            if (i == 5) sb.append('-');
            sb.append(RECOVERY_ALPHABET.charAt(RNG.nextInt(RECOVERY_ALPHABET.length())));
        }
        return sb.toString();
    }

    static String normalizeRecoveryCode(String code) {
        return code == null ? "" : code.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }

    static boolean looksLikeRecoveryCode(String code) {
        return normalizeRecoveryCode(code).length() == 10;
    }

    /** Keyed hash so a database copy alone can't be used to guess the codes. */
    String hashRecoveryCode(String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(recoveryKey, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(normalizeRecoveryCode(code).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    // ---- helpers ----------------------------------------------------------------

    private String workspaceName(UUID tenantId) {
        List<String> rows = jdbc.queryForList("SELECT display_name FROM platform.tenants WHERE id = ?", String.class, tenantId);
        return rows.isEmpty() || rows.get(0) == null || rows.get(0).isBlank() ? "Workspace" : rows.get(0).trim();
    }

    private static OffsetDateTime toOffset(Object v) {
        if (v == null) return null;
        if (v instanceof OffsetDateTime o) return o;
        if (v instanceof java.sql.Timestamp t) return t.toInstant().atOffset(java.time.ZoneOffset.UTC);
        if (v instanceof Instant i) return i.atOffset(java.time.ZoneOffset.UTC);
        return null;
    }

    private static byte[] sha256(byte[] in) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(in);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
