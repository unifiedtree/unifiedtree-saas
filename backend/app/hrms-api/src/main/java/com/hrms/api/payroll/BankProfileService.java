package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Bank profiles used to seed NEFT/RTGS disbursement batches. Wave 2
 * (2026-08-11). One row per (tenant, company, profile_name); optional
 * `is_default` flag with a partial UNIQUE index on
 * (tenant_id, company_id) WHERE is_default.
 *
 * <p>All mutation goes through this service — the controller never touches
 * JdbcTemplate directly, so the RLS/tenant discipline is centralised.
 */
@Service
public class BankProfileService {

    /** Indian NEFT/RTGS IFSC — 4 letters + 0 + 6 alnum. */
    private static final Pattern IFSC = Pattern.compile("^[A-Z]{4}0[A-Z0-9]{6}$");

    private static final List<String> ALLOWED_FORMATS =
            List.of("GENERIC_CSV", "HDFC_FIXED", "ICICI_CIB", "SBI_CORP");

    private final JdbcTemplate jdbc;

    public BankProfileService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record BankProfileDto(
            UUID id, UUID companyId, String profileName, String bankFormat,
            String corporateId, String debitAccountNo, String ifsc,
            boolean isDefault, boolean isActive,
            String createdAt, String updatedAt) {}

    public record CreateBankProfileRequest(
            @jakarta.validation.constraints.NotNull UUID companyId,
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 120) String profileName,
            @jakarta.validation.constraints.NotBlank String bankFormat,
            @jakarta.validation.constraints.Size(max = 60) String corporateId,
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 60) String debitAccountNo,
            @jakarta.validation.constraints.NotBlank String ifsc,
            Boolean isDefault) {}

    public record UpdateBankProfileRequest(
            @jakarta.validation.constraints.Size(max = 120) String profileName,
            String bankFormat,
            @jakarta.validation.constraints.Size(max = 60) String corporateId,
            @jakarta.validation.constraints.Size(max = 60) String debitAccountNo,
            String ifsc,
            Boolean isDefault,
            Boolean isActive) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public List<BankProfileDto> list(UUID tenantId, UUID companyId, Boolean activeOnly) {
        bindTenant(tenantId);
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM payroll.bank_profiles WHERE 1=1");
        List<Object> args = new java.util.ArrayList<>();
        if (companyId != null) { sql.append(" AND company_id = ?"); args.add(companyId); }
        if (Boolean.TRUE.equals(activeOnly)) sql.append(" AND is_active = TRUE");
        sql.append(" ORDER BY is_default DESC, profile_name ASC");
        return jdbc.query(sql.toString(), (rs, i) -> toDto(rs), args.toArray());
    }

    @Transactional
    public BankProfileDto get(UUID tenantId, UUID id) {
        bindTenant(tenantId);
        List<BankProfileDto> rows = jdbc.query(
                "SELECT * FROM payroll.bank_profiles WHERE id = ?",
                (rs, i) -> toDto(rs), id);
        if (rows.isEmpty()) throw new BusinessRuleException("Bank profile not found", "BANK_PROFILE_NOT_FOUND");
        return rows.get(0);
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    @Transactional
    public BankProfileDto create(UUID tenantId, CreateBankProfileRequest req, UUID actorId) {
        bindTenant(tenantId);
        validateIfsc(req.ifsc());
        validateFormat(req.bankFormat());
        boolean shouldBeDefault = Boolean.TRUE.equals(req.isDefault());
        // If asked to be default, clear the existing default for the same
        // (tenant, company). Partial-UNIQUE index enforces at DB level too.
        if (shouldBeDefault) clearDefaults(req.companyId());

        UUID id = jdbc.queryForObject("""
                INSERT INTO payroll.bank_profiles
                    (tenant_id, company_id, profile_name, bank_format,
                     corporate_id, debit_account_no, ifsc, is_default,
                     is_active, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)
                RETURNING id
                """, UUID.class,
                tenantId, req.companyId(), req.profileName(), req.bankFormat(),
                req.corporateId(), req.debitAccountNo(), req.ifsc(), shouldBeDefault,
                actorId == null ? null : actorId.toString(),
                actorId == null ? null : actorId.toString());
        return get(tenantId, id);
    }

    @Transactional
    public BankProfileDto update(UUID tenantId, UUID id, UpdateBankProfileRequest req, UUID actorId) {
        bindTenant(tenantId);
        BankProfileDto existing = get(tenantId, id);   // 404 if missing
        if (req.ifsc() != null) validateIfsc(req.ifsc());
        if (req.bankFormat() != null) validateFormat(req.bankFormat());

        // If flipping to default, clear other defaults for the same company.
        if (Boolean.TRUE.equals(req.isDefault()) && !existing.isDefault()) {
            clearDefaults(existing.companyId(), id);
        }

        // Build the UPDATE dynamically — only fields the caller provided change.
        StringBuilder sql = new StringBuilder("UPDATE payroll.bank_profiles SET updated_at = now()");
        List<Object> args = new java.util.ArrayList<>();
        if (req.profileName()    != null) { sql.append(", profile_name = ?");     args.add(req.profileName()); }
        if (req.bankFormat()     != null) { sql.append(", bank_format = ?");      args.add(req.bankFormat()); }
        if (req.corporateId()    != null) { sql.append(", corporate_id = ?");     args.add(req.corporateId()); }
        if (req.debitAccountNo() != null) { sql.append(", debit_account_no = ?"); args.add(req.debitAccountNo()); }
        if (req.ifsc()           != null) { sql.append(", ifsc = ?");             args.add(req.ifsc()); }
        if (req.isDefault()      != null) { sql.append(", is_default = ?");       args.add(req.isDefault()); }
        if (req.isActive()       != null) { sql.append(", is_active = ?");        args.add(req.isActive()); }
        if (actorId != null)              { sql.append(", updated_by = ?");       args.add(actorId.toString()); }
        sql.append(", version = version + 1 WHERE id = ?");
        args.add(id);

        int rows = jdbc.update(sql.toString(), args.toArray());
        if (rows == 0) throw new BusinessRuleException("Bank profile not found", "BANK_PROFILE_NOT_FOUND");
        return get(tenantId, id);
    }

    @Transactional
    public void delete(UUID tenantId, UUID id) {
        bindTenant(tenantId);
        // Refuse to hard-delete if any disbursement batch references it —
        // preserves audit trail. Callers should is_active=false instead.
        Integer refs = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.disbursement_batches WHERE bank_profile_id = ?",
                Integer.class, id);
        if (refs != null && refs > 0) {
            throw new BusinessRuleException(
                    "This bank profile has " + refs + " disbursement batch(es) — deactivate instead of deleting",
                    "BANK_PROFILE_IN_USE");
        }
        int rows = jdbc.update("DELETE FROM payroll.bank_profiles WHERE id = ?", id);
        if (rows == 0) throw new BusinessRuleException("Bank profile not found", "BANK_PROFILE_NOT_FOUND");
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private void clearDefaults(UUID companyId) {
        clearDefaults(companyId, null);
    }

    private void clearDefaults(UUID companyId, UUID exceptId) {
        if (exceptId == null) {
            jdbc.update("UPDATE payroll.bank_profiles SET is_default = FALSE WHERE company_id = ? AND is_default = TRUE",
                    companyId);
        } else {
            jdbc.update("UPDATE payroll.bank_profiles SET is_default = FALSE WHERE company_id = ? AND is_default = TRUE AND id <> ?",
                    companyId, exceptId);
        }
    }

    private static void validateIfsc(String ifsc) {
        if (ifsc == null || !IFSC.matcher(ifsc).matches()) {
            throw new BusinessRuleException(
                    "IFSC must be 11 characters: 4 letters + '0' + 6 alphanumeric (e.g. HDFC0001234)",
                    "INVALID_IFSC");
        }
    }

    private static void validateFormat(String fmt) {
        if (!ALLOWED_FORMATS.contains(fmt)) {
            throw new BusinessRuleException(
                    "bankFormat must be one of " + ALLOWED_FORMATS,
                    "INVALID_BANK_FORMAT");
        }
    }

    private BankProfileDto toDto(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new BankProfileDto(
                rs.getObject("id", UUID.class),
                rs.getObject("company_id", UUID.class),
                rs.getString("profile_name"),
                rs.getString("bank_format"),
                rs.getString("corporate_id"),
                rs.getString("debit_account_no"),
                rs.getString("ifsc"),
                rs.getBoolean("is_default"),
                rs.getBoolean("is_active"),
                ts(rs.getTimestamp("created_at")),
                ts(rs.getTimestamp("updated_at")));
    }

    private static String ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
